from __future__ import annotations

import fcntl
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path

from .common import TERMINAL_JOB_STATES, artifact_paths, read_json, utc_now, write_json
from .delegate import write_failure_envelope
from .job_state import finalize_job_state, initialize_job, update_job
from .pipeline import execute_request_pipeline
from .workflow import execute_workflow


def request_view(request: dict) -> dict:
    return {
        "assistant_role": request.get("assistant_role"),
        "cwd": request["cwd"],
        "lineage": request.get("lineage"),
        "max_budget_usd": ((request.get("task_packet") or {}).get("execution_policy") or {}).get("max_budget_usd"),
        "model": request["model"],
        "provider": request.get("provider"),
        "runtime": request.get("runtime"),
        "resume_session_id": request["resume_session_id"],
        "routing": request.get("routing"),
        "session_id": request["session_id"],
        "task_type": request.get("task_type") or request.get("task_packet", {}).get("task_type"),
        "tools": request["tools"],
        "workflow_roles": request.get("workflow_roles", [request.get("assistant_role")]),
    }


def _summarize_step_job(job_path: str) -> dict | None:
    artifacts_dir = Path(job_path)
    paths = artifact_paths(artifacts_dir)
    job = read_json(paths["job"])
    request = read_json(paths["request"])
    delegate = read_json(paths["normalized"]) or {}
    if job is None or request is None:
        return None

    completion = delegate.get("completion") or delegate.get("structured_output") or {}
    return {
        "assistant_role": job.get("assistant_role") or request.get("assistant_role"),
        "boundary_status": (delegate.get("boundary") or {}).get("status"),
        "error_type": delegate.get("error_type"),
        "event_count": job.get("event_count"),
        "finished_at": job.get("finished_at"),
        "job_path": str(artifacts_dir),
        "last_event_at": job.get("last_event_at"),
        "last_event_type": job.get("last_event_type"),
        "ok": delegate.get("ok"),
        "ready": job.get("state") in TERMINAL_JOB_STATES,
        "session_id": request.get("session_id"),
        "started_at": job.get("started_at"),
        "state": job.get("state"),
        "summary": completion.get("summary") or delegate.get("result"),
        "task_type": job.get("task_type") or request.get("task_type") or request.get("task_packet", {}).get("task_type"),
        "verification_status": (delegate.get("verification") or {}).get("status"),
    }


def workflow_step_views(job: dict) -> list[dict]:
    items: list[dict] = []
    for job_path in job.get("step_job_paths", []):
        summary = _summarize_step_job(job_path)
        if summary is not None:
            items.append(summary)
    return items


def render_job_view(job_path: str, *, require_terminal: bool = False) -> dict:
    artifacts_dir = Path(job_path)
    paths = artifact_paths(artifacts_dir)
    job = read_json(paths["job"])
    request = read_json(paths["request"])
    delegate = read_json(paths["normalized"])

    if job is None or request is None:
        return {
            "ok": False,
            "error_type": "missing_job_state",
            "error_message": "job metadata is incomplete",
        }

    ready = job["state"] in TERMINAL_JOB_STATES
    if require_terminal and not ready:
        return {
            "ok": False,
            "error_type": "worker_state_error",
            "error_message": "wait returned before the job reached a terminal state",
            "job": job,
            "request": request_view(request),
            "delegate": delegate,
            "ready": False,
            "workflow_steps": workflow_step_views(job),
        }

    return {
        "ok": True,
        "job": job,
        "request": request_view(request),
        "delegate": delegate,
        "ready": ready,
        "workflow_steps": workflow_step_views(job),
    }


def submit_request(request: dict, artifacts_dir: Path, entrypoint: str) -> tuple[dict, int]:
    paths = artifact_paths(artifacts_dir)
    paths["lock"].touch()
    write_json(paths["request"], request)

    read_fd, write_fd = os.pipe()
    worker_command = [
        sys.executable,
        entrypoint,
        "--job-worker",
        "--job-path",
        str(artifacts_dir),
        "--startup-fd",
        str(write_fd),
    ]

    try:
        subprocess.Popen(
            worker_command,
            cwd=request["cwd"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            pass_fds=(write_fd,),
        )
    finally:
        os.close(write_fd)

    started = os.read(read_fd, 32)
    os.close(read_fd)

    if started != b"started\n":
        view = render_job_view(str(artifacts_dir))
        return (
            {
                "ok": False,
                "error_type": "submit_error",
                "error_message": "worker failed to start cleanly",
                "job": view.get("job"),
                "request": view.get("request"),
                "delegate": view.get("delegate"),
                "ready": view.get("ready"),
            },
            1,
        )

    return render_job_view(str(artifacts_dir)), 0


def run_worker(job_path: str, startup_fd: int | None) -> int:
    artifacts_dir = Path(job_path)
    paths = artifact_paths(artifacts_dir)
    request = read_json(paths["request"])
    if request is None:
        return 2

    with paths["lock"].open("r+") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        try:
            update_lock = threading.Lock()

            def safe_update(**changes: object) -> dict:
                with update_lock:
                    return update_job(paths, **changes)

            def acknowledge_startup() -> None:
                nonlocal startup_fd
                if startup_fd is None:
                    return
                os.write(startup_fd, b"started\n")
                os.close(startup_fd)
                startup_fd = None

            def on_spawn(delegate_pid: int) -> None:
                safe_update(delegate_pid=delegate_pid)

            def on_event(event: dict, event_count: int) -> None:
                safe_update(
                    event_count=event_count,
                    last_event_at=utc_now(),
                    last_event_type=event.get("type"),
                )

            safe_update(
                state="running",
                started_at=utc_now(),
                pid=os.getpid(),
                delegate_pid=None,
                current_role=None if len(request.get("workflow_roles", [])) > 1 else request.get("assistant_role"),
                last_error=None,
                completed_roles=[],
                termination_intent=None,
                workflow_step=0,
            )
            acknowledge_startup()

            if len(request.get("workflow_roles", [])) > 1:
                envelope = execute_workflow(
                    request,
                    artifacts_dir,
                    update_parent_job=safe_update,
                )
            else:
                envelope = execute_request_pipeline(
                    request,
                    artifacts_dir,
                    on_spawn=on_spawn,
                    on_event=on_event,
                )

            job = read_json(paths["job"]) or {}
            termination_intent = job.get("termination_intent")
            if termination_intent == "pause" and envelope.get("error_type") == "cancelled":
                envelope["error_type"] = "paused"
                envelope["error_message"] = "job paused"
                write_json(paths["normalized"], envelope)

            final_state = finalize_job_state(envelope)

            workflow = envelope.get("workflow") or {}
            workflow_steps = workflow.get("steps", [])
            safe_update(
                state=final_state,
                finished_at=utc_now(),
                assistant_role=envelope.get("assistant_role", request.get("assistant_role")),
                completed_roles=[step.get("role") for step in workflow_steps],
                current_role=None,
                current_step_job_path=None,
                delegate_pid=None,
                execution_workspace=envelope.get("execution_workspace"),
                last_error=envelope.get("error_message"),
                task_type=envelope.get("task_type") or request.get("task_type"),
                termination_intent=None,
                workflow_roles=envelope.get("workflow_roles", request.get("workflow_roles")),
                workflow_step=len(workflow_steps) if workflow_steps else 1,
                workflow_total_steps=len(envelope.get("workflow_roles", request.get("workflow_roles", []))),
            )
            return 0 if envelope["ok"] else 1
        except Exception as exc:
            write_failure_envelope(request, artifacts_dir, "worker_error", str(exc), exit_code=1)
            update_job(paths, state="failed", finished_at=utc_now(), last_error=str(exc))
            if startup_fd is not None:
                os.close(startup_fd)
            return 1


def wait_for_job(job_path: str) -> dict:
    artifacts_dir = Path(job_path)
    paths = artifact_paths(artifacts_dir)
    if not paths["lock"].exists():
        return {
            "ok": False,
            "error_type": "missing_job_state",
            "error_message": "job lock file does not exist",
        }

    with paths["lock"].open("r+") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_SH)
        fcntl.flock(lock_file, fcntl.LOCK_UN)

    return render_job_view(job_path, require_terminal=True)


def wait_for_jobs_any(job_paths: list[str]) -> dict:
    """Block until any one of the given jobs reaches a terminal state.

    Uses the same lock-based, non-polling model as ``wait_for_job``.
    Returns the job view of the first job that completes.
    """
    if not job_paths:
        return {
            "ok": False,
            "error_type": "input_error",
            "error_message": "no job paths provided",
        }
    if len(job_paths) == 1:
        return wait_for_job(job_paths[0])

    done_event = threading.Event()
    result_lock = threading.Lock()
    winner: list[dict] = []

    def _wait_one(jp: str) -> None:
        r = wait_for_job(jp)
        with result_lock:
            if not winner:
                winner.append(r)
                done_event.set()

    threads = [
        threading.Thread(target=_wait_one, args=(jp,), daemon=True)
        for jp in job_paths
    ]
    for t in threads:
        t.start()
    done_event.wait()
    return winner[0]


def wait_for_jobs_all(job_paths: list[str]) -> dict:
    """Block until all of the given jobs reach a terminal state.

    Uses the same lock-based, non-polling model as ``wait_for_job``.
    Returns a combined view with each job's result under ``"jobs"``.
    ``"ok"`` is True only when every job succeeded.
    """
    if not job_paths:
        return {
            "ok": False,
            "error_type": "input_error",
            "error_message": "no job paths provided",
        }
    if len(job_paths) == 1:
        return wait_for_job(job_paths[0])

    results: dict[str, dict] = {}
    results_lock = threading.Lock()

    def _wait_one(jp: str) -> None:
        r = wait_for_job(jp)
        with results_lock:
            results[jp] = r

    threads = [
        threading.Thread(target=_wait_one, args=(jp,), daemon=True)
        for jp in job_paths
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    job_results = [results[jp] for jp in job_paths]
    all_ok = all(
        r.get("ok") and (r.get("job") or {}).get("state") == "finished"
        for r in job_results
    )
    return {
        "ok": all_ok,
        "jobs": job_results,
    }


def cancel_job(job_path: str) -> dict:
    return _terminate_job(
        job_path,
        transition_state="cancelling",
        intent="cancel",
        requested_at_field="cancel_requested_at",
    )


def pause_job(job_path: str) -> dict:
    return _terminate_job(
        job_path,
        transition_state="pausing",
        intent="pause",
        requested_at_field="pause_requested_at",
    )


def _terminate_job(
    job_path: str,
    *,
    transition_state: str,
    intent: str,
    requested_at_field: str,
) -> dict:
    view = render_job_view(job_path)
    if not view.get("ok"):
        return view

    job = view["job"]
    if job["state"] in TERMINAL_JOB_STATES:
        return view

    pid = job.get("pid")
    if pid is None:
        return {
            "ok": False,
            "error_type": "missing_worker_pid",
            "error_message": "job is not terminal but has no worker pid",
            "job": job,
            "request": view["request"],
            "delegate": view["delegate"],
            "ready": False,
        }

    paths = artifact_paths(Path(job_path))
    update_job(paths, state=transition_state, termination_intent=intent, **{requested_at_field: utc_now()})

    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

    return wait_for_job(job_path)
