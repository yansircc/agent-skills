"""Regression tests for multi-job wait: --wait-any / --wait-all CLI modes.

Covers:
  - Parser: --job-path accumulated as a list when repeated
  - Parser: --wait-any and --wait-all produce the correct mode
  - Parser: --wait, --wait-any, --wait-all are mutually exclusive
  - Behaviour: wait_for_jobs_all returns all job results
  - Behaviour: wait_for_jobs_any returns first-completed result
  - Behaviour: wait_for_jobs_any does not block on a still-running job
"""
from __future__ import annotations

import fcntl
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from claude_delegate.common import TERMINAL_JOB_STATES, artifact_paths, write_json
from claude_delegate.job_state import initialize_job
from claude_delegate.jobs import wait_for_jobs_all, wait_for_jobs_any

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MINIMAL_REQUEST = {
    "assistant_role": "implementer",
    "artifacts_root": "/tmp",
    "cwd": "/tmp",
    "created_at": "2026-01-01T00:00:00+00:00",
    "model": "haiku",
    "provider": None,
    "resume_session_id": None,
    "session_id": "test-session",
    "tools": "Bash",
    "workflow_roles": ["implementer"],
    "routing": None,
    "task_type": "coding",
}


def _make_finished_job(root: Path, name: str) -> str:
    """Create a synthetic finished job directory with uncontested lock file."""
    job_dir = root / name
    job_dir.mkdir(parents=True)
    paths = artifact_paths(job_dir)

    request = dict(_MINIMAL_REQUEST, session_id=f"test-session-{name}")
    write_json(paths["request"], request)
    record = initialize_job(paths, request)

    # Advance state to finished
    record["state"] = "finished"
    record["finished_at"] = "2026-01-01T00:00:01+00:00"
    write_json(paths["job"], record)

    # Create lock file (no one holds an exclusive lock → shared lock
    # acquisition in wait_for_job succeeds immediately)
    paths["lock"].touch()

    # Minimal normalised output so render_job_view returns ok=True
    write_json(paths["normalized"], {"ok": True, "completion": {"summary": f"job {name} done"}})

    return str(job_dir)


def _make_job_infrastructure(root: Path, name: str) -> str:
    """Create a job directory whose lock file can be externally locked."""
    job_dir = root / name
    job_dir.mkdir(parents=True)
    paths = artifact_paths(job_dir)

    request = dict(_MINIMAL_REQUEST, session_id=f"test-session-{name}")
    write_json(paths["request"], request)
    record = initialize_job(paths, request)

    # State stays "submitted" / "running" – we will hold the exclusive lock
    record["state"] = "running"
    write_json(paths["job"], record)

    paths["lock"].touch()
    write_json(paths["normalized"], {"ok": False, "error_type": "not_done"})

    return str(job_dir)


# ---------------------------------------------------------------------------
# Parser tests
# ---------------------------------------------------------------------------

def test_parser_repeated_job_path() -> None:
    """--job-path can be supplied multiple times and accumulates as a list."""
    saved = sys.argv[:]
    try:
        sys.argv = ["prog", "--wait-all", "--job-path", "/a", "--job-path", "/b"]
        from run_claude_delegate import parse_args
        args = parse_args()
        assert args.job_path == ["/a", "/b"], f"Expected ['/a', '/b'], got {args.job_path}"
    finally:
        sys.argv = saved
    print("PASS  --job-path repeated accumulates list")


def test_parser_wait_any_mode() -> None:
    """--wait-any is recognized and produces mode 'wait_any'."""
    saved = sys.argv[:]
    try:
        sys.argv = ["prog", "--wait-any", "--job-path", "/a"]
        from run_claude_delegate import determine_mode, parse_args
        args = parse_args()
        assert determine_mode(args) == "wait_any"
    finally:
        sys.argv = saved
    print("PASS  --wait-any produces mode 'wait_any'")


def test_parser_wait_all_mode() -> None:
    """--wait-all is recognized and produces mode 'wait_all'."""
    saved = sys.argv[:]
    try:
        sys.argv = ["prog", "--wait-all", "--job-path", "/a"]
        from run_claude_delegate import determine_mode, parse_args
        args = parse_args()
        assert determine_mode(args) == "wait_all"
    finally:
        sys.argv = saved
    print("PASS  --wait-all produces mode 'wait_all'")


def test_parser_wait_single_job_mode() -> None:
    """--wait with a single --job-path still produces mode 'wait' (backward compat)."""
    saved = sys.argv[:]
    try:
        sys.argv = ["prog", "--wait", "--job-path", "/a"]
        from run_claude_delegate import determine_mode, parse_args
        args = parse_args()
        assert determine_mode(args) == "wait"
        assert args.job_path == ["/a"]
    finally:
        sys.argv = saved
    print("PASS  --wait with single --job-path preserves backward-compatible mode 'wait'")


def test_parser_wait_flags_mutually_exclusive() -> None:
    """--wait, --wait-any, and --wait-all are mutually exclusive."""
    import subprocess

    entrypoint = str(Path(__file__).resolve().parents[1] / "scripts" / "run_claude_delegate.py")
    result = subprocess.run(
        [sys.executable, entrypoint, "--wait-any", "--wait-all", "--job-path", "/a"],
        capture_output=True,
    )
    assert result.returncode != 0, "Expected non-zero exit for mutually exclusive flags"
    print("PASS  --wait-any and --wait-all are mutually exclusive")


# ---------------------------------------------------------------------------
# Behaviour tests
# ---------------------------------------------------------------------------

def test_wait_all_no_paths() -> None:
    """wait_for_jobs_all with no paths returns an error dict."""
    result = wait_for_jobs_all([])
    assert result.get("ok") is False
    assert result.get("error_type") == "input_error"
    print("PASS  wait_for_jobs_all([]) returns input_error")


def test_wait_any_no_paths() -> None:
    """wait_for_jobs_any with no paths returns an error dict."""
    result = wait_for_jobs_any([])
    assert result.get("ok") is False
    assert result.get("error_type") == "input_error"
    print("PASS  wait_for_jobs_any([]) returns input_error")


def test_wait_all_multiple_finished_jobs() -> None:
    """wait_for_jobs_all returns combined ok=True when all jobs finished."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        path_a = _make_finished_job(root, "job-a")
        path_b = _make_finished_job(root, "job-b")

        result = wait_for_jobs_all([path_a, path_b])

        assert result.get("ok") is True, f"Expected ok=True, got {result}"
        jobs = result.get("jobs", [])
        assert len(jobs) == 2, f"Expected 2 job results, got {len(jobs)}"
        # Order is preserved
        assert jobs[0]["job"]["job_path"] == path_a
        assert jobs[1]["job"]["job_path"] == path_b
        for j in jobs:
            assert j.get("ok") is True
            assert j["job"]["state"] in TERMINAL_JOB_STATES
    print("PASS  wait_for_jobs_all returns combined result for multiple finished jobs")


def test_wait_all_one_failed_job() -> None:
    """wait_for_jobs_all returns ok=False when any job failed."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        # job-a: finished ok
        path_a = _make_finished_job(root, "job-a")
        # job-b: failed
        job_dir_b = root / "job-b"
        job_dir_b.mkdir(parents=True)
        paths_b = artifact_paths(job_dir_b)
        request_b = dict(_MINIMAL_REQUEST, session_id="test-session-job-b")
        write_json(paths_b["request"], request_b)
        record_b = initialize_job(paths_b, request_b)
        record_b["state"] = "failed"
        record_b["finished_at"] = "2026-01-01T00:00:02+00:00"
        write_json(paths_b["job"], record_b)
        paths_b["lock"].touch()
        write_json(paths_b["normalized"], {"ok": False, "error_type": "worker_error", "error_message": "boom"})
        path_b = str(job_dir_b)

        result = wait_for_jobs_all([path_a, path_b])

        assert result.get("ok") is False, f"Expected ok=False (one failed), got {result}"
        jobs = result.get("jobs", [])
        assert len(jobs) == 2
        assert jobs[0].get("ok") is True
        assert jobs[0]["job"]["state"] == "finished"
        # Individual view ok=True (view was rendered), but job state and delegate signal failure
        assert jobs[1]["job"]["state"] == "failed"
        assert jobs[1].get("delegate", {}).get("ok") is False
    print("PASS  wait_for_jobs_all returns ok=False when any job failed")


def test_wait_any_multiple_finished_jobs() -> None:
    """wait_for_jobs_any returns a valid single-job view when all jobs are finished."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        path_a = _make_finished_job(root, "job-a")
        path_b = _make_finished_job(root, "job-b")

        result = wait_for_jobs_any([path_a, path_b])

        assert result.get("ok") is True, f"Expected ok=True, got {result}"
        assert "job" in result
        assert result["job"]["state"] in TERMINAL_JOB_STATES
        # Must be one of the submitted paths (not a combined multi-job dict)
        assert "jobs" not in result
    print("PASS  wait_for_jobs_any returns single-job view when all are finished")


def test_wait_any_returns_first_finished_skips_running() -> None:
    """wait_for_jobs_any returns the first-completed job without blocking on a running one."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        path_running = _make_job_infrastructure(root, "job-running")
        path_done = _make_finished_job(root, "job-done")

        # Hold exclusive lock on the running job to simulate an active worker.
        lock_acquired = threading.Event()
        lock_release = threading.Event()

        def hold_exclusive_lock() -> None:
            paths = artifact_paths(Path(path_running))
            with paths["lock"].open("r+") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                lock_acquired.set()
                lock_release.wait(timeout=10)

        locker = threading.Thread(target=hold_exclusive_lock, daemon=True)
        locker.start()
        assert lock_acquired.wait(timeout=2), "timed out waiting for exclusive lock"

        try:
            result = wait_for_jobs_any([path_running, path_done])
        finally:
            lock_release.set()  # always release so daemon thread can exit

        assert result.get("ok") is True, f"Expected ok=True from finished job, got {result}"
        assert result["job"]["job_path"] == path_done, (
            f"Expected result from job-done, got {result['job']['job_path']}"
        )
    print("PASS  wait_for_jobs_any returns finished job without blocking on running one")


def test_wait_all_single_path_delegates_to_wait_for_job() -> None:
    """wait_for_jobs_all with one path returns the same shape as wait_for_job."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        path_a = _make_finished_job(root, "job-a")

        result = wait_for_jobs_all([path_a])

        # Single-path short-circuit returns the standard job view, not a wrapper
        assert "jobs" not in result, "Single-path wait_for_jobs_all should not wrap in 'jobs'"
        assert result.get("ok") is True
    print("PASS  wait_for_jobs_all with one path returns standard job view (no wrapper)")


def test_wait_any_single_path_delegates_to_wait_for_job() -> None:
    """wait_for_jobs_any with one path returns the same shape as wait_for_job."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        path_a = _make_finished_job(root, "job-a")

        result = wait_for_jobs_any([path_a])

        assert "jobs" not in result, "Single-path wait_for_jobs_any should not wrap in 'jobs'"
        assert result.get("ok") is True
    print("PASS  wait_for_jobs_any with one path returns standard job view (no wrapper)")


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def test() -> None:
    test_parser_repeated_job_path()
    test_parser_wait_any_mode()
    test_parser_wait_all_mode()
    test_parser_wait_single_job_mode()
    test_parser_wait_flags_mutually_exclusive()
    test_wait_all_no_paths()
    test_wait_any_no_paths()
    test_wait_all_multiple_finished_jobs()
    test_wait_all_one_failed_job()
    test_wait_any_multiple_finished_jobs()
    test_wait_any_returns_first_finished_skips_running()
    test_wait_all_single_path_delegates_to_wait_for_job()
    test_wait_any_single_path_delegates_to_wait_for_job()
    print("\nAll multi-wait tests passed.")


if __name__ == "__main__":
    test()
