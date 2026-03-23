from __future__ import annotations

import copy
import os
import uuid
from pathlib import Path

from .common import artifact_paths, read_json, utc_now, write_json
from .contracts import build_delegate_prompt, build_system_prompt, default_completion_contract
from .delegate import base_envelope, write_failure_envelope
from .job_state import finalize_job_state, initialize_job, update_job
from .pipeline import execute_request_pipeline
from .request import finalize_request


def _step_summary(envelope: dict, role: str, job_path: str) -> dict:
    completion = envelope.get("completion", {})
    return {
        "role": role,
        "job_path": job_path,
        "ok": envelope.get("ok", False),
        "session_id": envelope.get("session_id"),
        "summary": completion.get("summary") or envelope.get("result") or "",
        "error_type": envelope.get("error_type"),
        "boundary_status": (envelope.get("boundary") or {}).get("status"),
        "findings": envelope.get("findings", []),
        "open_risks": envelope.get("open_risks", []),
        "changed_files": envelope.get("changed_files", []),
        "diff_summary": envelope.get("diff_summary", []),
        "files_examined": envelope.get("files_examined", []),
        "test_commands": envelope.get("test_commands", []),
        "suggested_actions": envelope.get("suggested_actions", []),
        "verification_status": (envelope.get("verification") or {}).get("status"),
    }


def _dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


# Inheritance policy: explicit specification of workflow child request inheritance
# Defines which fields from parent task_packet are inherited by child roles
EXECUTION_POLICY_INHERITANCE_SPEC = {
    # Fields inherited by all roles if explicitly set in parent (preserving exact values)
    "all_roles": ["command_allowlist", "exclude_globs", "max_budget_usd", "max_changed_files", "max_turns", "observe_roots"],
    # Fields inherited only by implementer role
    "implementer_only": ["allowed_write_paths"],
}

VERIFICATION_CONTRACT_INHERITANCE_SPEC = {
    # Fields inherited by all roles if explicitly set in parent
    "all_roles": ["commands"],
    # Fields inherited only by implementer role
    "implementer_only": ["auto", "fail_on_error"],
    # Fields inherited by non-implementer roles (critic, explorer)
    "non_implementer_only": ["fail_on_error"],
}


def _inherit_child_task_packet(parent_request: dict, role: str) -> dict:
    """Inherit child task packet from parent using explicit inheritance specs.

    Preserves exact values (including empty lists, false, and zero) for fields
    specified in inheritance specs. Absent fields in parent do not add inherited fields.
    """
    packet = copy.deepcopy(parent_request["task_packet"])
    policy = copy.deepcopy(packet.pop("execution_policy", {}))
    verification = copy.deepcopy(packet.pop("verification_contract", {}))
    packet.pop("assistant_role", None)
    packet.pop("workflow_roles", None)

    inherited_policy: dict = {}
    # Inherit execution_policy fields that are explicitly present in parent,
    # preserving exact values including empty lists and false/zero values.
    for key in EXECUTION_POLICY_INHERITANCE_SPEC["all_roles"]:
        if key in policy:
            inherited_policy[key] = policy[key]
    # allowed_write_paths is implementer-specific.
    if role == "implementer":
        for key in EXECUTION_POLICY_INHERITANCE_SPEC["implementer_only"]:
            if key in policy:
                inherited_policy[key] = policy[key]
    if inherited_policy:
        packet["execution_policy"] = inherited_policy

    inherited_verification: dict = {}
    # commands apply to all roles if explicitly set in parent.
    for key in VERIFICATION_CONTRACT_INHERITANCE_SPEC["all_roles"]:
        if key in verification:
            inherited_verification[key] = verification[key]
    if role == "implementer":
        # auto and fail_on_error apply to implementer if explicitly set in parent.
        for key in VERIFICATION_CONTRACT_INHERITANCE_SPEC["implementer_only"]:
            if key in verification:
                inherited_verification[key] = verification[key]
    else:
        # fail_on_error applies to non-implementer roles if explicitly set in parent.
        for key in VERIFICATION_CONTRACT_INHERITANCE_SPEC["non_implementer_only"]:
            if key in verification:
                inherited_verification[key] = verification[key]
    if inherited_verification:
        packet["verification_contract"] = inherited_verification

    return packet


def _prepare_role_request(parent_request: dict, role: str, prior_steps: list[dict], parent_job_path: str) -> dict:
    child_request = copy.deepcopy(parent_request)
    child_request["assistant_role"] = role
    child_request["workflow_roles"] = [role]
    child_request["session_id"] = str(uuid.uuid4())
    child_request["resume_session_id"] = None
    child_request["completion_contract"] = default_completion_contract(role)
    child_request["task_packet"] = _inherit_child_task_packet(parent_request, role)
    child_request["lineage"] = {
        "action": "workflow_step",
        "parent_job_path": parent_job_path,
        "workflow_root_session_id": parent_request["session_id"],
    }
    child_request["skip_ledger"] = True
    child_request = finalize_request(child_request)
    child_request["system_prompt"] = build_system_prompt(parent_request["base_system_prompt"], role)
    child_request["prompt"] = build_delegate_prompt(
        child_request["task_packet"],
        assistant_role=role,
        completion_contract=child_request["completion_contract"],
        delta_prompt=child_request.get("delta_prompt"),
        prior_steps=prior_steps,
    )
    return child_request


def _append_step_job_path(parent_job_paths: list[str], job_path: str) -> list[str]:
    if job_path in parent_job_paths:
        return list(parent_job_paths)
    return [*parent_job_paths, job_path]


def _execute_child_step(
    child_request: dict,
    child_dir: Path,
    *,
    role: str,
    workflow_step: int,
    update_parent_job,
    parent_paths: dict[str, Path],
    parent_event_count: int,
) -> tuple[dict, int]:
    child_paths = artifact_paths(child_dir)
    child_paths["lock"].touch()
    write_json(child_paths["request"], child_request)
    initialize_job(child_paths, child_request)
    update_job(
        child_paths,
        state="running",
        started_at=utc_now(),
        pid=os.getpid(),
        current_role=role,
        last_error=None,
    )

    parent_job = read_json(parent_paths["job"]) or {}
    step_job_paths = _append_step_job_path(parent_job.get("step_job_paths", []), str(child_dir))
    update_parent_job(
        current_role=role,
        current_step_job_path=str(child_dir),
        step_job_paths=step_job_paths,
        workflow_step=workflow_step,
    )

    def on_spawn(delegate_pid: int) -> None:
        update_job(child_paths, delegate_pid=delegate_pid)
        update_parent_job(delegate_pid=delegate_pid, current_step_job_path=str(child_dir))

    def on_event(event: dict, event_count: int) -> None:
        nonlocal parent_event_count
        parent_event_count += 1
        timestamp = utc_now()
        update_job(
            child_paths,
            event_count=event_count,
            last_event_at=timestamp,
            last_event_type=event.get("type"),
        )
        update_parent_job(
            event_count=parent_event_count,
            last_event_at=timestamp,
            last_event_type=event.get("type"),
            current_step_job_path=str(child_dir),
        )

    try:
        envelope = execute_request_pipeline(
            child_request,
            child_dir,
            on_spawn=on_spawn,
            on_event=on_event,
        )
    except Exception as exc:
        write_failure_envelope(
            child_request,
            child_dir,
            "workflow_step_error",
            str(exc),
            exit_code=1,
        )
        update_job(
            child_paths,
            state="failed",
            finished_at=utc_now(),
            current_role=None,
            delegate_pid=None,
            last_error=str(exc),
        )
        update_parent_job(delegate_pid=None, current_step_job_path=None)
        raise

    update_job(
        child_paths,
        state=finalize_job_state(envelope),
        finished_at=utc_now(),
        assistant_role=envelope.get("assistant_role", child_request.get("assistant_role")),
        current_role=None,
        delegate_pid=None,
        last_error=envelope.get("error_message"),
        task_type=envelope.get("task_type") or child_request.get("task_type"),
        workflow_roles=envelope.get("workflow_roles", child_request.get("workflow_roles")),
        workflow_step=1,
        workflow_total_steps=1,
    )
    update_parent_job(delegate_pid=None, current_step_job_path=None)
    return envelope, parent_event_count


def _aggregate_boundary(step_envelopes: list[dict]) -> dict:
    violations: list[dict] = []
    for envelope in step_envelopes:
        violations.extend((envelope.get("boundary") or {}).get("violations", []))
    return {
        "status": "violated" if violations else "passed",
        "violations": violations,
    }


def _aggregate_verification(step_envelopes: list[dict]) -> dict:
    statuses = [(envelope.get("verification") or {}).get("status") for envelope in step_envelopes]
    commands: list[str] = []
    results: list[dict] = []
    fail_on_error = False

    for envelope in step_envelopes:
        verification = envelope.get("verification") or {}
        commands.extend(verification.get("commands", []))
        results.extend(verification.get("results", []))
        fail_on_error = fail_on_error or verification.get("fail_on_error", False)

    if any(status == "failed" for status in statuses):
        status = "failed"
    elif any(status == "passed" for status in statuses):
        status = "passed"
    else:
        status = "skipped"

    return {
        "status": status,
        "fail_on_error": fail_on_error,
        "commands": _dedupe_strings(commands),
        "results": results,
    }


def execute_workflow(
    request: dict,
    artifacts_dir: Path,
    *,
    update_parent_job,
) -> dict:
    paths = artifact_paths(artifacts_dir)
    workflow_envelope = base_envelope(paths, request)
    workflow_envelope["assistant_role"] = "supervisor"
    workflow_envelope["task_type"] = request["task_packet"]["task_type"]
    workflow_envelope["workflow_roles"] = request["workflow_roles"]
    workflow_envelope["lineage"] = request.get("lineage")
    workflow_envelope["completion_contract"] = {
        "name": request["completion_contract"]["name"],
        "role": request["completion_contract"]["role"],
    }

    step_artifacts = artifacts_dir / "steps"
    step_artifacts.mkdir(parents=True, exist_ok=True)
    workflow_envelope["artifacts"]["steps_dir"] = str(step_artifacts)
    prior_steps: list[dict] = []
    step_summaries: list[dict] = []
    step_envelopes: list[dict] = []
    parent_event_count = 0

    for index, role in enumerate(request["workflow_roles"], start=1):
        update_parent_job(
            current_role=role,
            workflow_step=index,
            workflow_total_steps=len(request["workflow_roles"]),
            completed_roles=[step["role"] for step in step_summaries],
        )
        child_dir = step_artifacts / f"{index:02d}-{role}"
        child_dir.mkdir(parents=True, exist_ok=True)
        child_request = _prepare_role_request(request, role, prior_steps, str(paths["artifacts_dir"]))
        child_envelope, parent_event_count = _execute_child_step(
            child_request,
            child_dir,
            role=role,
            workflow_step=index,
            update_parent_job=update_parent_job,
            parent_paths=paths,
            parent_event_count=parent_event_count,
        )
        step_envelopes.append(child_envelope)
        summary = _step_summary(child_envelope, role, str(child_dir))
        step_summaries.append(summary)
        prior_steps.append(summary)

        if role != "critic" and not child_envelope.get("ok", False):
            break

    final_child = step_envelopes[-1] if step_envelopes else {}
    all_findings = []
    critic_findings = []
    open_risks = []
    total_cost_usd = 0.0
    total_cost_seen = False
    duration_ms = 0
    duration_seen = False
    num_turns = 0
    turns_seen = False
    permission_denials: list[dict] = []
    tool_uses: list[dict] = []
    tool_use_count = 0

    for summary in step_summaries:
        all_findings.extend(summary.get("findings", []))
        if summary["role"] == "critic":
            critic_findings.extend(summary.get("findings", []))
        open_risks.extend(summary.get("open_risks", []))
    for envelope in step_envelopes:
        cost = envelope.get("total_cost_usd")
        if isinstance(cost, (int, float)):
            total_cost_seen = True
            total_cost_usd += float(cost)
        child_duration = envelope.get("duration_ms")
        if isinstance(child_duration, int):
            duration_seen = True
            duration_ms += child_duration
        child_turns = envelope.get("num_turns")
        if isinstance(child_turns, int):
            turns_seen = True
            num_turns += child_turns
        permission_denials.extend(envelope.get("permission_denials", []))
        tool_uses.extend(envelope.get("tool_uses", []))
        tool_use_count += int(envelope.get("tool_use_count") or len(envelope.get("tool_uses", [])))

    steps_failed = any(not envelope.get("ok", False) for envelope in step_envelopes)
    boundary = _aggregate_boundary(step_envelopes)
    verification = _aggregate_verification(step_envelopes)
    status = "failed" if steps_failed else "needs_review" if critic_findings else "completed"

    workflow_envelope["workflow"] = {
        "roles": request["workflow_roles"],
        "steps": step_summaries,
    }
    workflow_envelope["structured_output"] = {
        "status": status,
        "summary": final_child.get("completion", {}).get("summary") or final_child.get("result") or "workflow finished",
        "steps": [
            {
                "role": item["role"],
                "job_path": item["job_path"],
                "ok": item["ok"],
                "summary": item["summary"],
            }
            for item in step_summaries
        ],
        "open_risks": _dedupe_strings(open_risks),
    }
    workflow_envelope["completion"] = workflow_envelope["structured_output"]
    workflow_envelope["findings"] = all_findings
    workflow_envelope["open_risks"] = _dedupe_strings(open_risks)
    workflow_envelope["result"] = final_child.get("result")
    workflow_envelope["total_cost_usd"] = total_cost_usd if total_cost_seen else None
    workflow_envelope["duration_ms"] = duration_ms if duration_seen else None
    workflow_envelope["num_turns"] = num_turns if turns_seen else None
    workflow_envelope["permission_denials"] = permission_denials
    workflow_envelope["tool_use_count"] = tool_use_count
    workflow_envelope["tool_uses"] = tool_uses
    workflow_envelope["boundary"] = boundary
    workflow_envelope["verification"] = verification
    workflow_envelope["session_id"] = request["session_id"]
    workflow_envelope["ok"] = not steps_failed and not critic_findings

    if steps_failed:
        failed_step = next((item for item in step_envelopes if not item.get("ok", False)), {})
        workflow_envelope["error_type"] = failed_step.get("error_type") or "workflow_step_failed"
        workflow_envelope["error_message"] = failed_step.get("error_message") or "workflow step failed"
    elif critic_findings:
        workflow_envelope["ok"] = False
        workflow_envelope["error_type"] = "critic_findings"
        workflow_envelope["error_message"] = "critic found issues"

    update_parent_job(
        completed_roles=[step["role"] for step in step_summaries],
        current_role=None,
        workflow_step=len(step_summaries),
    )
    write_json(paths["normalized"], workflow_envelope)
    from .handoff import shape_handoff

    write_json(paths["handoff"], shape_handoff(workflow_envelope))
    return workflow_envelope
