from __future__ import annotations

import fcntl
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .common import TERMINAL_JOB_STATES, artifact_paths, read_json
from .session_health import accumulate_session_health, finalize_session_health, initialize_session_health
from .workspace_identity import build_workspace_identity


def ledger_paths(root: str | Path) -> dict[str, Path]:
    root_path = Path(root)
    root_path.mkdir(parents=True, exist_ok=True)
    return {
        "root": root_path,
        "ledger": root_path / "ledger.jsonl",
        "lock": root_path / "ledger.lock",
    }


def append_ledger_entry(artifacts_root: str | Path, artifacts_dir: Path, request: dict) -> Path:
    paths = ledger_paths(artifacts_root)
    if request.get("skip_ledger"):
        return paths["ledger"]

    entry = {
        "assistant_role": request.get("assistant_role"),
        "created_at": request["created_at"],
        "cwd": request["cwd"],
        "job_id": artifacts_dir.name,
        "job_path": str(artifacts_dir),
        "model": request["model"],
        "provider": request.get("provider"),
        "runtime": request.get("runtime"),
        "session_id": request["session_id"],
        "task_type": request.get("task_type"),
        "workspace_id": ((request.get("workspace_identity") or {}).get("workspace_id")),
    }

    paths["lock"].touch()
    with paths["lock"].open("r+") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        with paths["ledger"].open("a") as ledger_file:
            ledger_file.write(json.dumps(entry, sort_keys=True))
            ledger_file.write("\n")

    return paths["ledger"]


def summarize_job(job_path: str | Path) -> dict | None:
    artifacts_dir = Path(job_path)
    paths = artifact_paths(artifacts_dir)
    request = read_json(paths["request"])
    job = read_json(paths["job"])
    delegate = read_json(paths["normalized"])

    if request is None or job is None:
        return None

    delegate = delegate or {}
    completion = delegate.get("completion") or delegate.get("structured_output") or {}
    lineage = request.get("lineage") or {}
    workspace_identity = request.get("workspace_identity")
    if not isinstance(workspace_identity, dict):
        workspace_identity = build_workspace_identity(
            cwd=request["cwd"],
            execution_policy=(request.get("task_packet") or {}).get("execution_policy"),
        )
    return {
        "assistant_role": job.get("assistant_role") or request.get("assistant_role"),
        "boundary_status": (delegate.get("boundary") or {}).get("status"),
        "created_at": request["created_at"],
        "cwd": request["cwd"],
        "duration_ms": delegate.get("duration_ms"),
        "error_message": delegate.get("error_message"),
        "error_type": delegate.get("error_type"),
        "event_count": job.get("event_count"),
        "finished_at": job.get("finished_at"),
        "job_id": job.get("job_id"),
        "job_path": str(artifacts_dir),
        "last_event_at": job.get("last_event_at"),
        "last_event_type": job.get("last_event_type"),
        "lineage_action": lineage.get("action"),
        "model": request["model"],
        "model_usage": delegate.get("model_usage"),
        "num_turns": delegate.get("num_turns"),
        "ok": delegate.get("ok"),
        "provider": request.get("provider"),
        "runtime": request.get("runtime"),
        "session_id": request["session_id"],
        "summary": completion.get("summary") or delegate.get("result"),
        "started_at": job.get("started_at"),
        "state": job.get("state"),
        "task_type": job.get("task_type") or request.get("task_type") or request.get("task_packet", {}).get("task_type"),
        "total_cost_usd": delegate.get("total_cost_usd"),
        "verification_status": (delegate.get("verification") or {}).get("status"),
        "workflow_roles": job.get("workflow_roles") or request.get("workflow_roles"),
        "workspace_id": workspace_identity.get("workspace_id"),
        "workspace_identity": workspace_identity,
    }


def collect_summaries(
    artifacts_root: str | Path,
    *,
    limit: int | None,
    session_id: str | None,
    runtime: str | None,
    provider: str | None,
    state: str | None,
) -> tuple[list[dict], dict[str, Path]]:
    paths = ledger_paths(artifacts_root)
    if not paths["ledger"].exists():
        return [], paths

    items: list[dict] = []
    seen: set[str] = set()
    paths["lock"].touch()
    with paths["lock"].open("r+") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_SH)
        lines = paths["ledger"].read_text().splitlines()
        fcntl.flock(lock_file, fcntl.LOCK_UN)

    for line in reversed(lines):
        if not line.strip():
            continue
        entry = json.loads(line)
        job_path = entry["job_path"]
        if job_path in seen:
            continue
        seen.add(job_path)

        summary = summarize_job(job_path)
        if summary is None:
            continue
        if session_id is not None and summary["session_id"] != session_id:
            continue
        if runtime is not None and summary.get("runtime") != runtime:
            continue
        if provider is not None and summary.get("provider") != provider:
            continue
        if state is not None and summary["state"] != state:
            continue

        items.append(summary)
        if limit is not None and len(items) >= limit:
            break

    return items, paths


def list_ledger(
    artifacts_root: str | Path,
    *,
    limit: int,
    session_id: str | None,
    runtime: str | None,
    provider: str | None,
    state: str | None,
) -> dict:
    items, paths = collect_summaries(
        artifacts_root,
        limit=limit,
        session_id=session_id,
        runtime=runtime,
        provider=provider,
        state=state,
    )

    return {
        "ok": True,
        "count": len(items),
        "items": items,
        "ledger_path": str(paths["ledger"]),
    }


def ledger_stats(
    artifacts_root: str | Path,
    *,
    session_id: str | None,
    runtime: str | None,
    provider: str | None,
    state: str | None,
) -> dict:
    items, paths = collect_summaries(
        artifacts_root,
        limit=None,
        session_id=session_id,
        runtime=runtime,
        provider=provider,
        state=state,
    )

    states: dict[str, int] = {}
    models: dict[str, dict[str, float | int]] = {}
    providers: dict[str, int] = {}
    roles: dict[str, int] = {}
    task_types: dict[str, int] = {}
    verification_statuses: dict[str, int] = {}
    boundary_statuses: dict[str, int] = {}
    lineage_actions: dict[str, int] = {}
    ok_count = 0
    error_count = 0
    total_cost_usd = 0.0
    duration_total_ms = 0
    duration_count = 0

    for item in items:
        item_state = item["state"] or "unknown"
        states[item_state] = states.get(item_state, 0) + 1
        role = item.get("assistant_role") or "unknown"
        roles[role] = roles.get(role, 0) + 1
        task_type = item.get("task_type") or "unknown"
        task_types[task_type] = task_types.get(task_type, 0) + 1
        provider_name = item.get("provider") or "default"
        providers[provider_name] = providers.get(provider_name, 0) + 1
        verification = item.get("verification_status") or "unknown"
        verification_statuses[verification] = verification_statuses.get(verification, 0) + 1
        boundary = item.get("boundary_status") or "unknown"
        boundary_statuses[boundary] = boundary_statuses.get(boundary, 0) + 1
        lineage_action = item.get("lineage_action") or "none"
        lineage_actions[lineage_action] = lineage_actions.get(lineage_action, 0) + 1

        model_name = _provider_model_label(item.get("provider"), item.get("model"))
        model_bucket = models.setdefault(
            model_name,
            {"count": 0, "ok_count": 0, "total_cost_usd": 0.0},
        )
        model_bucket["count"] += 1

        if item.get("ok") is True:
            ok_count += 1
            model_bucket["ok_count"] += 1
        elif item_state in {"failed", "cancelled"}:
            error_count += 1

        cost = item.get("total_cost_usd")
        if isinstance(cost, (int, float)):
            total_cost_usd += float(cost)
            model_bucket["total_cost_usd"] += float(cost)

        duration_ms = item.get("duration_ms")
        if isinstance(duration_ms, int):
            duration_total_ms += duration_ms
            duration_count += 1

    return {
        "ok": True,
        "count": len(items),
        "ok_count": ok_count,
        "error_count": error_count,
        "providers": providers,
        "states": states,
        "models": models,
        "roles": roles,
        "task_types": task_types,
        "verification_statuses": verification_statuses,
        "boundary_statuses": boundary_statuses,
        "lineage_actions": lineage_actions,
        "total_cost_usd": total_cost_usd,
        "average_duration_ms": (duration_total_ms / duration_count) if duration_count else None,
        "ledger_path": str(paths["ledger"]),
    }


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def list_sessions(
    artifacts_root: str | Path,
    *,
    limit: int | None = None,
    session_id: str | None = None,
    cwd: str | None = None,
    workspace_id: str | None = None,
    runtime: str | None = None,
    provider: str | None = None,
    state: str | None = None,
    assistant_role: str | None = None,
    task_type: str | None = None,
) -> dict:
    """
    List sessions aggregated by session_id with metadata to decide reuse.

    Each session record contains:
    - session_id: The unique session identifier
    - cwd: Working directory for this session
    - assistant_role: Assistant role from the most recent job in the session
    - task_type: Task type from the most recent job in the session
    - provider: The provider used, or null when the CLI default provider was used
    - model: The model used, or null when the CLI/provider default model was used
    - job_count: Number of jobs in this session
    - first_created_at: Timestamp of the first (chronologically earliest) job in the session
    - last_created_at: Timestamp of the most recent job in the session
    - last_job_path: Path to the most recent job
    - last_state: State of the most recent job
    - started_at: When the last job started (if applicable)
    - finished_at: When the last job finished (if applicable)
    - last_event_at: When the last event occurred in the last job (if applicable)
    - resumable: True if the last job is not 'running' (can use --resume-session-id)
    - active: True if the last job is in 'running' state
    - summary: Completion summary from the most recent job when available
    - boundary_status: Boundary status of the last job
    - verification_status: Verification status of the last job
    - lineage_action: Lineage action of the last job (resume/fork/retry/none)
    """
    items, paths = collect_summaries(
        artifacts_root,
        limit=None,
        session_id=None,
        runtime=None,
        provider=None,
        state=None,
    )

    # Aggregate by session_id, collecting all jobs for each session
    sessions_dict: dict[str, dict[str, object]] = {}

    sorted_items = sorted(
        items,
        key=lambda item: parse_timestamp(item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    for item in sorted_items:
        sid = item["session_id"]
        if sid not in sessions_dict:
            sessions_dict[sid] = {
                "session_id": sid,
                "cwd": item["cwd"],
                "assistant_role": item.get("assistant_role"),
                "task_type": item.get("task_type"),
                "model": item["model"],
                "provider": item.get("provider"),
                "runtime": item.get("runtime"),
                "job_count": 0,
                "first_created_at": item["created_at"],
                "last_created_at": item["created_at"],
                "last_job_path": item["job_path"],
                "last_state": item["state"],
                "started_at": item.get("started_at"),
                "finished_at": item.get("finished_at"),
                "last_event_at": item.get("last_event_at"),
                "summary": item.get("summary"),
                "boundary_status": item.get("boundary_status"),
                "verification_status": item.get("verification_status"),
                "lineage_action": item.get("lineage_action") or "none",
                "session_health": initialize_session_health(item),
                "workspace_id": item.get("workspace_id"),
                "workspace_identity": item.get("workspace_identity"),
            }
        else:
            accumulate_session_health(sessions_dict[sid]["session_health"], item)

        sess = sessions_dict[sid]
        sess["job_count"] += 1

        first_ts = parse_timestamp(sess["first_created_at"])
        this_ts = parse_timestamp(item["created_at"])
        if first_ts and this_ts and this_ts < first_ts:
            sess["first_created_at"] = item["created_at"]

    # Filter and add computed fields
    result_sessions: list[dict] = []
    for sid, sess in sessions_dict.items():
        if session_id is not None and sid != session_id:
            continue
        if cwd is not None and sess["cwd"] != cwd:
            continue
        if workspace_id is not None and sess.get("workspace_id") != workspace_id:
            continue
        if runtime is not None and sess.get("runtime") != runtime:
            continue
        if provider is not None and sess.get("provider") != provider:
            continue
        if state is not None and sess["last_state"] != state:
            continue
        if assistant_role is not None and sess["assistant_role"] != assistant_role:
            continue
        if task_type is not None and sess["task_type"] != task_type:
            continue

        sess["session_health"] = finalize_session_health(sess["session_health"])
        # resumable: non-active sessions (not running) can be resumed via --resume-session-id
        sess["resumable"] = sess["last_state"] != "running"
        sess["active"] = sess["last_state"] == "running"
        result_sessions.append(sess)

        if limit is not None and len(result_sessions) >= limit:
            break

    return {
        "ok": True,
        "count": len(result_sessions),
        "items": result_sessions,
        "ledger_path": str(paths["ledger"]),
    }


def find_routable_session(
    artifacts_root: str | Path,
    *,
    cwd: str,
    workspace_id: str | None,
    runtime: str,
    assistant_role: str,
    task_type: str,
    provider: str | None,
    model: str | None,
) -> dict:
    listing = list_sessions(
        artifacts_root,
        limit=None,
        session_id=None,
        cwd=cwd,
        workspace_id=workspace_id,
        runtime=runtime,
        provider=provider,
        state=None,
        assistant_role=assistant_role,
        task_type=task_type,
    )
    items = [
        item
        for item in listing["items"]
        if item.get("runtime") == runtime and item.get("provider") == provider and item.get("model") == model
    ]
    matched_session = next((item for item in items if item.get("resumable")), None)
    active_session = next((item for item in items if item.get("active")), None)
    return {
        "candidate_count": len(items),
        "matched_session": matched_session,
        "active_session": active_session,
    }


def _provider_model_label(provider: str | None, model: str | None) -> str:
    if provider and model:
        return f"{provider}/{model}"
    if provider:
        return f"{provider}/default"
    if model:
        return model
    return "default"


def prune_terminal_jobs(
    artifacts_root: str | Path,
    *,
    older_than_hours: float,
) -> dict:
    paths = ledger_paths(artifacts_root)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=older_than_hours)
    if not paths["ledger"].exists():
        return {
            "ok": True,
            "deleted_count": 0,
            "stale_entry_count": 0,
            "kept_count": 0,
            "ledger_path": str(paths["ledger"]),
            "cutoff": cutoff.isoformat(),
        }

    deleted_job_paths: list[str] = []
    stale_job_paths: list[str] = []
    kept_lines: list[str] = []
    decision_cache: dict[str, str] = {}

    paths["lock"].touch()
    with paths["lock"].open("r+") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        lines = paths["ledger"].read_text().splitlines()
        for line in lines:
            if not line.strip():
                continue
            entry = json.loads(line)
            job_path = entry["job_path"]

            decision = decision_cache.get(job_path)
            if decision is None:
                job_dir = Path(job_path)
                if not job_dir.exists():
                    decision = "stale"
                else:
                    summary = summarize_job(job_path)
                    finished_at = parse_timestamp(summary["finished_at"]) if summary is not None else None
                    if (
                        summary is not None
                        and summary["state"] in TERMINAL_JOB_STATES
                        and finished_at is not None
                        and finished_at <= cutoff
                    ):
                        decision = "delete"
                    else:
                        decision = "keep"
                decision_cache[job_path] = decision

            if decision == "delete":
                if job_path not in deleted_job_paths:
                    deleted_job_paths.append(job_path)
                continue
            if decision == "stale":
                if job_path not in stale_job_paths:
                    stale_job_paths.append(job_path)
                continue

            kept_lines.append(line)

        with paths["ledger"].open("w") as ledger_file:
            if kept_lines:
                ledger_file.write("\n".join(kept_lines))
                ledger_file.write("\n")

    for job_path in deleted_job_paths:
        shutil.rmtree(job_path)

    return {
        "ok": True,
        "deleted_count": len(deleted_job_paths),
        "deleted_job_paths": deleted_job_paths,
        "stale_entry_count": len(stale_job_paths),
        "stale_job_paths": stale_job_paths,
        "kept_count": len(kept_lines),
        "ledger_path": str(paths["ledger"]),
        "cutoff": cutoff.isoformat(),
    }
