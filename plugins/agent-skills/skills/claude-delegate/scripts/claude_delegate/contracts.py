from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

from .common import DEFAULT_SYSTEM_PROMPT
from .prompt_context import compact_prior_step, prompt_literal, render_structured_items
from .workspace_identity import normalize_scope_paths


ROLE_SYSTEM_INSTRUCTIONS = {
    "supervisor": "You coordinate bounded work. Keep the contract explicit.",
    "implementer": "You make bounded changes. Respect write scope and verification bounds.",
    "explorer": "You gather context. Avoid edits unless the contract allows them.",
    "critic": "You review for correctness, regressions, and boundary violations. Do not edit files.",
}

SHELL_EXECUTION_INSTRUCTIONS = (
    "Shell commands must be non-interactive and alias-safe. "
    "Do not wait for prompts. If input is unavoidable, provide it explicitly."
)


def read_json_input(value: str | None, file_path: str | None, label: str) -> dict | None:
    if value is not None:
        return json.loads(value)
    if file_path is not None:
        return json.loads(Path(file_path).read_text())
    return None


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def split_csv(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def deep_merge(base: object, override: object) -> object:
    if isinstance(base, dict) and isinstance(override, dict):
        merged = dict(base)
        for key, value in override.items():
            merged[key] = deep_merge(base.get(key), value) if key in base else value
        return merged
    return deepcopy(override)


def default_verification_contract(role: str) -> dict:
    return {
        "auto": role == "implementer",
        "commands": [],
        "fail_on_error": role == "implementer",
    }


def default_execution_policy(role: str, cwd: str, max_budget_usd: float | None) -> dict:
    return {
        "allow_edits": role == "implementer",
        "allowed_write_paths": [cwd] if role == "implementer" else [],
        "command_allowlist": [],
        "exclude_globs": ["**/__pycache__/**", "**/*.pyc", "**/*.pyo"],
        "max_budget_usd": max_budget_usd,
        "max_changed_files": None,
        "max_turns": None,
        "observe_roots": [cwd] if role == "implementer" else [],
        "workspace_mode": "auto" if role == "implementer" else "shared",
    }


def default_task_packet(
    *,
    goal: str,
    cwd: str,
    role: str,
    task_type: str,
    workflow_roles: list[str],
    tools: str | None,
    max_budget_usd: float | None,
) -> dict:
    return {
        "goal": goal,
        "task_type": task_type,
        "constraints": [],
        "context": [],
        "expected_artifacts": [],
        "operator_notes": [],
        "review_focus": [],
        "verification_contract": default_verification_contract(role),
        "execution_policy": default_execution_policy(role, cwd, max_budget_usd),
        "allowed_tools": split_csv(tools),
        "assistant_role": role,
        "workflow_roles": workflow_roles,
    }


def default_completion_contract(role: str) -> dict:
    base_completion = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {
                "type": "string",
                "enum": ["completed", "blocked", "failed", "needs_review", "no_findings"],
            },
            "summary": {"type": "string"},
            "changed_files": {"type": "array", "items": {"type": "string"}},
            "diff_summary": {"type": "array", "items": {"type": "string"}},
            "test_commands": {"type": "array", "items": {"type": "string"}},
            "open_risks": {"type": "array", "items": {"type": "string"}},
            "files_examined": {"type": "array", "items": {"type": "string"}},
            "suggested_actions": {"type": "array", "items": {"type": "string"}},
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "severity": {
                            "type": "string",
                            "enum": ["critical", "high", "medium", "low"],
                        },
                        "file": {"type": "string"},
                        "line": {"type": "integer"},
                        "issue": {"type": "string"},
                    },
                    "required": ["severity", "issue"],
                },
            },
        },
        "required": ["status", "summary"],
    }

    if role == "explorer":
        base_completion["required"] = ["status", "summary", "files_examined", "findings", "suggested_actions"]
    elif role == "critic":
        base_completion["required"] = ["status", "summary", "findings", "open_risks"]
    elif role == "supervisor":
        base_completion["properties"]["steps"] = {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "role": {"type": "string"},
                    "job_path": {"type": "string"},
                    "ok": {"type": "boolean"},
                    "summary": {"type": "string"},
                },
                "required": ["role", "job_path", "ok", "summary"],
            },
        }
        base_completion["required"] = ["status", "summary", "steps", "open_risks"]
    else:
        base_completion["required"] = ["status", "summary", "changed_files", "diff_summary", "test_commands", "open_risks"]

    return {
        "name": f"{role}-completion-v1",
        "role": role,
        "schema": base_completion,
    }


def ensure_completion_contract(raw_contract: dict | None, role: str) -> dict:
    if raw_contract is None:
        return default_completion_contract(role)
    if "schema" in raw_contract:
        contract = deepcopy(raw_contract)
        contract.setdefault("name", f"{role}-completion-custom")
        contract.setdefault("role", role)
        return contract
    if raw_contract.get("type") == "object":
        return {
            "name": f"{role}-completion-custom",
            "role": role,
            "schema": deepcopy(raw_contract),
        }
    raise ValueError("Completion contract must be a JSON schema object or an object with a 'schema' field.")


def normalize_workflow_roles(raw_roles: list[str], assistant_role: str) -> list[str]:
    roles = dedupe_strings(raw_roles)
    if not roles:
        return [assistant_role]
    return roles


def build_system_prompt(base_prompt: str | None, role: str) -> str:
    prefix = (base_prompt or DEFAULT_SYSTEM_PROMPT).strip()
    return f"{prefix}\n\n{ROLE_SYSTEM_INSTRUCTIONS[role]}\n\n{SHELL_EXECUTION_INSTRUCTIONS}"


def _append_literal_section(lines: list[str], title: str, value: object) -> None:
    if value in (None, "", [], {}):
        return
    lines.append(title)
    lines.append(f"- {prompt_literal(value)}")


# Render policy: request context fields specification
# Maps field names to their prompt labels for consistent structured rendering
# Labels include trailing colons to match render_structured_items output format
REQUEST_CONTEXT_FIELD_SPECS = [
    ("constraints", "Constraints:"),
    ("context", "Context:"),
    ("expected_artifacts", "Expected artifacts:"),
    ("review_focus", "Review focus:"),
    ("operator_notes", "Operator notes:"),
]


def _render_request_context(
    lines: list[str],
    task_packet: dict,
    delta_prompt: str | None = None,
) -> None:
    """Render request context section using structured literal rendering.

    Consolidates constraints, context, expected_artifacts, review_focus, and
    operator_notes into structured literal rendering consistent with parent_handoff.
    Uses render_structured_items for uniform formatting across all context fields.

    Schema consolidation opportunity (deferred):
    These five fields could be merged into a single typed request_context dict with
    structured sub-fields while maintaining backward compatibility in normalize_task_packet.
    This would be a schema-level consolidation, not just render-layer deduplication.
    See also: task_packet schema design - constraints, context, expected_artifacts,
    review_focus, and operator_notes are independent in the current schema but logically
    form a "request context" group that could be unified in a future batch.
    """
    for field_name, field_label in REQUEST_CONTEXT_FIELD_SPECS:
        value = task_packet.get(field_name, [])
        if value:
            lines.extend(render_structured_items(field_label, value))

    if delta_prompt:
        lines.extend(render_structured_items("Continuation:", [delta_prompt]))


def _append_mapping_section(
    lines: list[str],
    title: str,
    values: dict,
    field_specs: list[tuple[str, str, bool]],
) -> None:
    section_lines: list[str] = []
    for key, label, always_render in field_specs:
        if not always_render and key not in values:
            continue
        value = values.get(key)
        if value is None and not always_render:
            continue
        section_lines.append(f"- {label}: {prompt_literal(value)}")
    if section_lines:
        lines.append(title)
        lines.extend(section_lines)


def normalize_task_packet(
    raw_packet: dict | None,
    *,
    prompt_text: str | None,
    cwd: str,
    assistant_role: str,
    task_type: str,
    workflow_roles: list[str],
    tools: str | None,
    max_budget_usd: float | None,
    delta_prompt: str | None,
) -> dict:
    raw_goal = (raw_packet or {}).get("goal")
    if prompt_text and raw_goal and prompt_text != raw_goal:
        raise ValueError("Conflicting goals: --prompt and task_packet.goal must match.")

    packet = default_task_packet(
        goal=prompt_text or (raw_packet or {}).get("goal") or "",
        cwd=cwd,
        role=assistant_role,
        task_type=task_type,
        workflow_roles=workflow_roles,
        tools=tools,
        max_budget_usd=max_budget_usd,
    )

    if raw_packet is not None:
        packet = deep_merge(packet, raw_packet)

    execution_policy = dict(packet.get("execution_policy") or {})
    execution_policy["allowed_write_paths"] = normalize_scope_paths(execution_policy.get("allowed_write_paths"), cwd)
    execution_policy["observe_roots"] = normalize_scope_paths(execution_policy.get("observe_roots"), cwd)
    workspace_mode = execution_policy.get("workspace_mode")
    if workspace_mode is not None:
        execution_policy["workspace_mode"] = str(workspace_mode).strip().lower()
    packet["execution_policy"] = execution_policy

    packet["assistant_role"] = assistant_role
    packet["workflow_roles"] = workflow_roles
    packet["task_type"] = task_type
    packet["allowed_tools"] = dedupe_strings(packet.get("allowed_tools", []))
    packet["constraints"] = dedupe_strings(packet.get("constraints", []))
    packet["context"] = dedupe_strings(packet.get("context", []))
    packet["expected_artifacts"] = dedupe_strings(packet.get("expected_artifacts", []))
    packet["operator_notes"] = dedupe_strings(packet.get("operator_notes", []))
    packet["review_focus"] = dedupe_strings(packet.get("review_focus", []))
    return packet


def render_prior_steps(prior_steps: list[dict]) -> list[str]:
    return render_structured_items(
        "Prior steps:",
        [compact_prior_step(step) for step in prior_steps],
    )


def build_delegate_prompt(
    task_packet: dict,
    *,
    assistant_role: str,
    completion_contract: dict,
    delta_prompt: str | None = None,
    prior_steps: list[dict] | None = None,
    parent_handoff: dict | None = None,
) -> str:
    """Build the delegate prompt from task packet and completion contract.

    Prompt structure (render policy):
    1. Header: Role, Task type, Goal (prose format; future refactoring target)
    2. Request context: Constraints, Context, Expected artifacts, Review focus,
                       Operator notes, Continuation (structured literal format)
    3. Boundaries: Execution policy fields (structured mapping format)
    4. Verification: Verification contract fields (structured mapping format)
    5. Prior steps: Compact summaries of prior assistant work (structured format)
    6. Parent handoff: Context from lineage actions (resume/fork/retry)
    7. Output contract: Schema name and return format (prose format; future refactoring target)

    Render policy notes:
    - Header and output are currently prose to match established prompt format.
    - They could be refactored to use _append_mapping_section in a future batch.
    - Request context uses render_structured_items for consistent structured rendering.
    - Boundaries and Verification use _append_mapping_section for explicit field specs.
    """
    lines = [
        f"Role: {assistant_role}",
        f"Task type: {task_packet['task_type']}",
        f"Goal: {task_packet['goal']}",
    ]

    # Request context: unified structured rendering
    _render_request_context(lines, task_packet, delta_prompt)

    policy = task_packet["execution_policy"]
    _append_mapping_section(
        lines,
        "Boundaries:",
        policy,
        [
            ("allow_edits", "allow_edits", True),
            ("allowed_write_paths", "allowed_write_paths", False),
            ("command_allowlist", "command_allowlist", False),
            ("exclude_globs", "exclude_globs", False),
            ("observe_roots", "observe_roots", False),
            ("workspace_mode", "workspace_mode", False),
            ("max_changed_files", "max_changed_files", False),
            ("max_turns", "max_turns", False),
            ("max_budget_usd", "max_budget_usd", False),
        ],
    )

    verification = task_packet["verification_contract"]
    _append_mapping_section(
        lines,
        "Verification:",
        verification,
        [
            ("auto", "auto", False),
            ("fail_on_error", "fail_on_error", False),
            ("commands", "commands", False),
        ],
    )

    lines.extend(render_prior_steps(prior_steps or []))

    # Render parent handoff from lineage actions (resume/fork/retry)
    if parent_handoff:
        from .handoff import render_parent_handoff
        lines.extend(render_parent_handoff(parent_handoff))

    lines.append(f"Output schema: {completion_contract['name']}")
    lines.append("Return only JSON that matches the provided schema.")
    return "\n".join(lines)
