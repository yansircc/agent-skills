from __future__ import annotations

import argparse
import sys
import uuid
from copy import deepcopy
from pathlib import Path

from .common import DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, utc_now
from .contracts import (
    ROLE_SYSTEM_INSTRUCTIONS,
    build_delegate_prompt,
    build_system_prompt,
    deep_merge,
    ensure_completion_contract,
    normalize_task_packet,
    normalize_workflow_roles,
    read_json_input,
    split_csv,
)
from .ledger import find_routable_session
from .runtime_profiles import resolve_runtime_request
from .workspace_identity import build_workspace_identity


def _resolve_session_routing(request: dict, artifacts_root: str) -> dict:
    routing_mode = request.get("session_routing") or "new"
    lineage = request.get("lineage") or {}

    if lineage.get("action") == "resume":
        request["routing"] = {
            "mode": routing_mode,
            "decision": "lineage_resume",
            "matched_session_id": request.get("resume_session_id"),
            "matched_job_path": lineage.get("parent_job_path"),
            "reason": "Lineage resume reuses the parent Claude session.",
        }
        return request

    if lineage.get("action") in {"fork", "retry"}:
        request["routing"] = {
            "mode": routing_mode,
            "decision": f"lineage_{lineage['action']}",
            "matched_session_id": None,
            "matched_job_path": lineage.get("parent_job_path"),
            "reason": f"Lineage {lineage['action']} starts a fresh Claude session.",
        }
        return request

    if request.get("resume_session_id"):
        request["routing"] = {
            "mode": routing_mode,
            "decision": "explicit_reuse",
            "matched_session_id": request.get("resume_session_id"),
            "matched_job_path": None,
            "reason": "Explicit --resume-session-id.",
        }
        return request

    if request.get("session_id"):
        request["routing"] = {
            "mode": routing_mode,
            "decision": "explicit_session",
            "matched_session_id": request.get("session_id"),
            "matched_job_path": None,
            "reason": "Explicit --session-id.",
        }
        return request

    if routing_mode == "auto":
        routing_candidate = find_routable_session(
            artifacts_root,
            cwd=request["cwd"],
            workspace_id=((request.get("workspace_identity") or {}).get("workspace_id")),
            runtime=request["runtime"],
            assistant_role=request["assistant_role"],
            task_type=request["task_type"],
            provider=request.get("provider"),
            model=request["model"],
        )
        matched = routing_candidate["matched_session"]
        if matched is not None:
            matched_health = matched.get("session_health")
            request["session_id"] = matched["session_id"]
            request["resume_session_id"] = matched["session_id"]
            request["routing"] = {
                "mode": routing_mode,
                "decision": "matched_resumable",
                "matched_session_id": matched["session_id"],
                "matched_job_path": matched.get("last_job_path"),
                "candidate_count": routing_candidate["candidate_count"],
                "session_health": matched_health,
                "reason": "Matched the latest resumable session by workspace boundary, runtime, assistant_role, task_type, provider, and model.",
            }
            return request

        active = routing_candidate["active_session"]
        if active is not None:
            request["routing"] = {
                "mode": routing_mode,
                "decision": "matching_session_active",
                "matched_session_id": active["session_id"],
                "matched_job_path": active.get("last_job_path"),
                "candidate_count": routing_candidate["candidate_count"],
                "session_health": active.get("session_health"),
                "reason": "A matching session is active and cannot be reused.",
            }
            return request

        request["routing"] = {
            "mode": routing_mode,
            "decision": "new_session",
            "matched_session_id": None,
            "matched_job_path": None,
            "candidate_count": 0,
            "reason": "No matching resumable session found.",
        }
        return request

    request["routing"] = {
        "mode": routing_mode,
        "decision": "new_session",
        "matched_session_id": None,
        "matched_job_path": None,
        "reason": "Routing mode new always starts a fresh Claude session.",
    }
    return request


def read_text(value: str | None, file_path: str | None, label: str) -> str | None:
    if value is not None:
        return value
    if file_path is not None:
        return Path(file_path).read_text()
    if label == "prompt" and not sys.stdin.isatty():
        data = sys.stdin.read()
        return data if data else None
    return None


def resolve_session_fields(session_id: str | None, resume_session_id: str | None) -> tuple[str, str | None]:
    if session_id and resume_session_id and session_id != resume_session_id:
        raise ValueError("Use either --session-id or --resume-session-id, not both.")
    if resume_session_id:
        return resume_session_id, resume_session_id
    if session_id:
        return session_id, None
    return str(uuid.uuid4()), None




def _validate_role(role: str) -> str:
    if role not in ROLE_SYSTEM_INSTRUCTIONS:
        raise ValueError(f"Unsupported assistant role: {role}")
    return role


def _lineage_action(args: argparse.Namespace) -> tuple[str | None, str | None]:
    actions = {
        "resume": args.resume_job,
        "fork": args.fork_job,
        "retry": args.retry_job,
    }
    selected = [(action, job_path) for action, job_path in actions.items() if job_path]
    if len(selected) > 1:
        raise ValueError("Use only one of --resume-job, --fork-job, or --retry-job.")
    if not selected:
        return None, None
    return selected[0]


def _apply_cli_overrides(
    request: dict,
    args: argparse.Namespace,
    *,
    prompt_text: str | None,
    delta_prompt: str | None,
    raw_task_packet: dict | None,
    raw_completion_contract: dict | None,
) -> dict:
    updated = deepcopy(request)

    if getattr(args, "runtime", None) is not None:
        updated["runtime"] = args.runtime
    if getattr(args, "runtime_bin", None) is not None:
        updated["runtime_bin"] = args.runtime_bin
    if getattr(args, "runtime_config", None) is not None:
        updated["runtime_config"] = args.runtime_config
    if args.ccc_bin is not None:
        updated["runtime_bin"] = args.ccc_bin
    if args.cwd is not None:
        updated["cwd"] = args.cwd
    if args.provider is not None:
        updated["provider"] = args.provider
    if args.model is not None:
        updated["model"] = args.model
    if args.tools is not None:
        updated["tools"] = args.tools
    if args.system_prompt is not None:
        updated["base_system_prompt"] = args.system_prompt
    if args.settings is not None:
        updated["settings"] = args.settings
    if args.timeout_seconds is not None:
        updated["timeout_seconds"] = args.timeout_seconds
    if args.assistant_role is not None:
        updated["assistant_role"] = args.assistant_role
    if args.workflow_roles is not None:
        updated["workflow_roles"] = split_csv(args.workflow_roles)
    if args.task_type is not None:
        updated["task_type"] = args.task_type
    if args.max_budget_usd is not None:
        updated["max_budget_usd"] = args.max_budget_usd
    if args.artifacts_root is not None:
        updated["artifacts_root"] = args.artifacts_root
    if args.session_id is not None:
        updated["session_id"] = args.session_id
    if args.resume_session_id is not None:
        updated["resume_session_id"] = args.resume_session_id
    if args.session_routing is not None:
        updated["session_routing"] = args.session_routing
    if prompt_text is not None:
        updated["goal"] = prompt_text
    if delta_prompt is not None:
        updated["delta_prompt"] = delta_prompt
    if raw_task_packet is not None:
        updated["task_packet"] = deep_merge(updated.get("task_packet"), raw_task_packet)
    if raw_completion_contract is not None:
        updated["completion_contract"] = raw_completion_contract
    return updated


def finalize_request(request: dict) -> dict:
    resolved = deepcopy(request)
    resolved["created_at"] = utc_now()
    resolved["cwd"] = str(Path(resolved.get("cwd") or Path.cwd()).resolve())
    raw_provider = resolved.get("provider")
    if raw_provider is None:
        resolved["provider"] = None
    else:
        provider = str(raw_provider).strip()
        resolved["provider"] = provider or None

    raw_model = resolved.get("model")
    if raw_model is None:
        resolved["model"] = DEFAULT_MODEL if resolved["provider"] is None else None
    else:
        model = str(raw_model).strip()
        resolved["model"] = model or None
    resolved["settings"] = resolved.get("settings")
    raw_timeout = resolved.get("timeout_seconds")
    if raw_timeout is None:
        resolved["timeout_seconds"] = None
    else:
        timeout_seconds = int(raw_timeout)
        resolved["timeout_seconds"] = timeout_seconds if timeout_seconds > 0 else None
    resolved["skip_ledger"] = bool(resolved.get("skip_ledger", False))

    raw_roles = resolved.get("workflow_roles")
    if isinstance(raw_roles, str):
        raw_roles = split_csv(raw_roles)
    elif raw_roles is None:
        raw_roles = []

    assistant_role = resolved.get("assistant_role")
    if len(raw_roles) > 1:
        assistant_role = "supervisor"
    elif assistant_role is None and len(raw_roles) == 1:
        assistant_role = raw_roles[0]
    assistant_role = _validate_role(assistant_role or "implementer")
    workflow_roles = normalize_workflow_roles(list(raw_roles), assistant_role)

    task_type = resolved.get("task_type") or "general"
    resolved["assistant_role"] = assistant_role
    resolved["task_type"] = task_type

    goal_text = resolved.get("goal")
    if goal_text is None and "task_packet" not in resolved:
        goal_text = resolved.get("prompt")

    completion_contract = ensure_completion_contract(
        resolved.get("completion_contract") or resolved.get("schema"),
        assistant_role,
    )

    tools = resolved.get("tools")
    raw_task_packet = resolved.get("task_packet") or {}
    if tools is None and resolved.get("task_packet") is not None and "allowed_tools" in raw_task_packet:
        tools = ",".join(raw_task_packet.get("allowed_tools") or [])

    task_packet = normalize_task_packet(
        resolved.get("task_packet"),
        prompt_text=goal_text,
        cwd=resolved["cwd"],
        assistant_role=assistant_role,
        task_type=task_type,
        workflow_roles=workflow_roles,
        tools=tools,
        max_budget_usd=resolved.get("max_budget_usd"),
        delta_prompt=resolved.get("delta_prompt") or ((resolved.get("lineage") or {}).get("delta_prompt")),
    )
    if not task_packet.get("goal"):
        raise ValueError("Provide --prompt, --prompt-file, stdin, or a task packet with a non-empty goal.")
    resolved["task_packet"] = task_packet
    resolved["workspace_identity"] = build_workspace_identity(
        cwd=resolved["cwd"],
        execution_policy=task_packet.get("execution_policy"),
    )
    resolved["runtime_resolution"] = resolve_runtime_request(resolved)
    resolved["runtime"] = resolved["runtime_resolution"]["name"]
    resolved["runtime_bin"] = resolved["runtime_resolution"]["bin"]

    resolved["session_routing"] = resolved.get("session_routing") or "new"
    resolved = _resolve_session_routing(
        resolved,
        resolved.get("artifacts_root") or "/tmp/claude-delegate-runs",
    )
    session_id, resume_session_id = resolve_session_fields(
        resolved.get("session_id"),
        resolved.get("resume_session_id"),
    )

    base_system_prompt = resolved.get("base_system_prompt") or resolved.get("system_prompt") or DEFAULT_SYSTEM_PROMPT
    parent_handoff = resolved.get("parent_handoff")
    if parent_handoff is None:
        lineage = resolved.get("lineage") or {}
        parent_job_path = lineage.get("parent_job_path")
        if parent_job_path:
            from .handoff import load_parent_handoff

            parent_handoff = load_parent_handoff(parent_job_path)
    prompt = build_delegate_prompt(
        task_packet,
        assistant_role=assistant_role,
        completion_contract=completion_contract,
        delta_prompt=resolved.get("delta_prompt") or ((resolved.get("lineage") or {}).get("delta_prompt")),
        parent_handoff=parent_handoff,
    )
    system_prompt = build_system_prompt(base_system_prompt, assistant_role)

    finalized = {
        "assistant_role": assistant_role,
        "base_system_prompt": base_system_prompt,
        "completion_contract": completion_contract,
        "created_at": resolved["created_at"],
        "cwd": resolved["cwd"],
        "delta_prompt": resolved.get("delta_prompt"),
        "lineage": resolved.get("lineage"),
        "model": resolved["model"],
        "provider": resolved["provider"],
        "prompt": prompt,
        "resume_session_id": resume_session_id,
        "routing": resolved.get("routing"),
        "runtime": resolved["runtime"],
        "runtime_bin": resolved["runtime_bin"],
        "runtime_config": resolved.get("runtime_config"),
        "runtime_resolution": resolved["runtime_resolution"],
        "schema": completion_contract["schema"],
        "session_id": session_id,
        "session_routing": resolved.get("session_routing"),
        "settings": resolved["settings"],
        "skip_ledger": resolved["skip_ledger"],
        "system_prompt": system_prompt,
        "task_packet": task_packet,
        "task_type": task_type,
        "timeout_seconds": resolved["timeout_seconds"],
        "tools": tools,
        "workflow_roles": workflow_roles,
        "workspace_identity": resolved["workspace_identity"],
    }
    return finalized


def build_request(args: argparse.Namespace) -> dict:
    prompt_text = read_text(args.prompt, args.prompt_file, "prompt")
    delta_prompt = read_text(args.delta_prompt, args.delta_prompt_file, "delta")
    raw_task_packet = read_json_input(args.task_packet_json, args.task_packet_file, "task packet")

    if args.schema_json and args.completion_contract_json:
        raise ValueError("Use either --schema-json or --completion-contract-json, not both.")
    if args.schema_file and args.completion_contract_file:
        raise ValueError("Use either --schema-file or --completion-contract-file, not both.")

    raw_completion_contract = read_json_input(
        args.completion_contract_json or args.schema_json,
        args.completion_contract_file or args.schema_file,
        "completion contract",
    )

    action, source_job_path = _lineage_action(args)
    if action is not None:
        if args.session_id and args.resume_session_id:
            raise ValueError("Use either --session-id or --resume-session-id, not both.")
        from .lineage import derive_request_from_job

        request = derive_request_from_job(
            source_job_path,
            action=action,
            delta_prompt=delta_prompt,
        )
        request = _apply_cli_overrides(
            request,
            args,
            prompt_text=prompt_text,
            delta_prompt=delta_prompt,
            raw_task_packet=raw_task_packet,
            raw_completion_contract=raw_completion_contract,
        )
        return finalize_request(request)

    request = {
        "assistant_role": args.assistant_role,
        "artifacts_root": args.artifacts_root,
        "base_system_prompt": args.system_prompt,
        "completion_contract": raw_completion_contract,
        "cwd": args.cwd,
        "delta_prompt": delta_prompt,
        "goal": prompt_text,
        "lineage": None,
        "max_budget_usd": args.max_budget_usd,
        "model": args.model,
        "runtime": getattr(args, "runtime", None),
        "runtime_bin": getattr(args, "runtime_bin", None) or args.ccc_bin,
        "runtime_config": getattr(args, "runtime_config", None),
        "provider": args.provider,
        "resume_session_id": args.resume_session_id,
        "session_routing": args.session_routing,
        "session_id": args.session_id,
        "settings": args.settings,
        "skip_ledger": False,
        "task_packet": raw_task_packet,
        "task_type": args.task_type,
        "timeout_seconds": args.timeout_seconds,
        "tools": args.tools,
        "workflow_roles": split_csv(args.workflow_roles) if args.workflow_roles else [],
    }
    return finalize_request(request)
