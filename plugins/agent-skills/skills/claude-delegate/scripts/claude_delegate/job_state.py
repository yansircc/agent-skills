from __future__ import annotations

from pathlib import Path

from .common import read_json, utc_now, write_json


def build_job_record(paths: dict[str, Path], request: dict) -> dict:
    workflow_roles = request.get("workflow_roles", [request.get("assistant_role")])
    return {
        "assistant_role": request.get("assistant_role"),
        "cancel_requested_at": None,
        "completed_roles": [],
        "created_at": request["created_at"],
        "current_role": None if len(workflow_roles) > 1 else request.get("assistant_role"),
        "current_step_job_path": None,
        "delegate_pid": None,
        "event_count": 0,
        "events_path": str(paths["events"]),
        "finished_at": None,
        "job_id": paths["artifacts_dir"].name,
        "job_path": str(paths["artifacts_dir"]),
        "last_error": None,
        "last_event_at": None,
        "last_event_type": None,
        "lock_path": str(paths["lock"]),
        "normalized_path": str(paths["normalized"]),
        "artifact_lifecycle": None,
        "pause_requested_at": None,
        "pid": None,
        "request_path": str(paths["request"]),
        "routing": request.get("routing"),
        "started_at": None,
        "state": "submitted",
        "step_job_paths": [],
        "stderr_path": str(paths["stderr"]),
        "stdout_path": str(paths["stdout"]),
        "task_type": request.get("task_type") or request.get("task_packet", {}).get("task_type"),
        "termination_intent": None,
        "updated_at": request["created_at"],
        "workflow_roles": workflow_roles,
        "workflow_step": 0,
        "workflow_total_steps": len(workflow_roles),
    }


def initialize_job(paths: dict[str, Path], request: dict, *, ledger_path: str | None = None) -> dict:
    record = build_job_record(paths, request)
    if ledger_path is not None:
        record["ledger_path"] = ledger_path
    write_json(paths["job"], record)
    return record


def update_job(paths: dict[str, Path], **changes: object) -> dict:
    job = read_json(paths["job"]) or {}
    job.update(changes)
    job["updated_at"] = utc_now()
    write_json(paths["job"], job)
    return job


def finalize_job_state(envelope: dict) -> str:
    if envelope.get("ok"):
        return "finished"
    if envelope.get("error_type") == "paused":
        return "paused"
    if envelope.get("error_type") == "cancelled":
        return "cancelled"
    return "failed"
