#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
from pathlib import Path

from claude_delegate.artifact_lifecycle import compact_terminal_jobs
from claude_delegate.common import artifact_paths, build_artifacts_dir, print_json, write_json
from claude_delegate.contracts import ROLE_SYSTEM_INSTRUCTIONS
from claude_delegate.jobs import cancel_job, initialize_job, pause_job, render_job_view, run_worker, submit_request, wait_for_job, wait_for_jobs_all, wait_for_jobs_any
from claude_delegate.ledger import append_ledger_entry, ledger_stats, list_ledger, list_sessions, prune_terminal_jobs
from claude_delegate.request import build_request


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a local Claude-compatible CLI runtime through a stable JSON envelope."
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--submit", action="store_true")
    mode_group.add_argument("--status", action="store_true")
    mode_group.add_argument("--wait", action="store_true")
    mode_group.add_argument("--wait-any", action="store_true")
    mode_group.add_argument("--wait-all", action="store_true")
    mode_group.add_argument("--cancel", action="store_true")
    mode_group.add_argument("--pause", action="store_true")
    mode_group.add_argument("--ledger", action="store_true")
    mode_group.add_argument("--ledger-stats", action="store_true")
    mode_group.add_argument("--list-sessions", action="store_true")
    mode_group.add_argument("--prune-terminal-older-than-hours", type=float)
    mode_group.add_argument("--compact-terminal-older-than-hours", type=float)
    mode_group.add_argument("--job-worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--runtime", default=os.environ.get("CLAUDE_DELEGATE_RUNTIME"))
    parser.add_argument("--runtime-bin", default=os.environ.get("CLAUDE_DELEGATE_RUNTIME_BIN"))
    parser.add_argument("--runtime-config", default=os.environ.get("CLAUDE_DELEGATE_RUNTIME_CONFIG"))
    parser.add_argument("--ccc-bin", default=os.environ.get("CCC_BIN"), help=argparse.SUPPRESS)
    parser.add_argument("--cwd")
    parser.add_argument("--provider")
    parser.add_argument("--model")
    parser.add_argument("--tools")
    parser.add_argument("--system-prompt")
    parser.add_argument("--settings")
    parser.add_argument("--timeout-seconds", type=int)
    parser.add_argument("--artifacts-root", default="/tmp/claude-delegate-runs")
    parser.add_argument("--session-id")
    parser.add_argument("--resume-session-id")
    parser.add_argument("--session-routing", choices=["new", "auto"])
    parser.add_argument("--resume-job")
    parser.add_argument("--fork-job")
    parser.add_argument("--retry-job")
    parser.add_argument("--job-path", action="append", dest="job_path", metavar="JOB_PATH")
    parser.add_argument("--prompt")
    parser.add_argument("--prompt-file")
    parser.add_argument("--schema-json")
    parser.add_argument("--schema-file")
    parser.add_argument("--assistant-role", choices=sorted(ROLE_SYSTEM_INSTRUCTIONS))
    parser.add_argument("--workflow-roles")
    parser.add_argument("--task-type")
    parser.add_argument("--task-packet-json")
    parser.add_argument("--task-packet-file")
    parser.add_argument("--completion-contract-json")
    parser.add_argument("--completion-contract-file")
    parser.add_argument("--delta-prompt")
    parser.add_argument("--delta-prompt-file")
    parser.add_argument("--max-budget-usd", type=float)
    parser.add_argument("--startup-fd", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--ledger-limit", type=int, default=20)
    parser.add_argument("--ledger-session-id")
    parser.add_argument("--ledger-runtime")
    parser.add_argument("--ledger-provider")
    parser.add_argument("--ledger-state")
    parser.add_argument("--list-sessions-limit", type=int)
    parser.add_argument("--list-sessions-cwd")
    parser.add_argument("--list-sessions-provider")
    parser.add_argument("--list-sessions-runtime")
    parser.add_argument("--list-sessions-state")
    parser.add_argument("--list-sessions-role")
    parser.add_argument("--list-sessions-task-type")
    return parser.parse_args()


def determine_mode(args: argparse.Namespace) -> str:
    if args.job_worker:
        return "worker"
    if args.submit:
        return "submit"
    if args.status:
        return "status"
    if args.wait:
        return "wait"
    if args.wait_any:
        return "wait_any"
    if args.wait_all:
        return "wait_all"
    if args.cancel:
        return "cancel"
    if args.pause:
        return "pause"
    if args.ledger:
        return "ledger"
    if args.ledger_stats:
        return "ledger_stats"
    if args.list_sessions:
        return "list_sessions"
    if args.prune_terminal_older_than_hours is not None:
        return "prune"
    if args.compact_terminal_older_than_hours is not None:
        return "compact"
    return "run"


def main() -> int:
    try:
        args = parse_args()
        mode = determine_mode(args)

        if mode == "worker":
            if not args.job_path:
                raise ValueError("Provide --job-path for --job-worker.")
            return run_worker(args.job_path[0], args.startup_fd)

        if mode in {"status", "wait", "cancel", "pause"}:
            if not args.job_path:
                raise ValueError("Provide --job-path for status, wait, cancel, or pause.")
            if len(args.job_path) > 1:
                raise ValueError(
                    "--wait/--status/--cancel/--pause require exactly one --job-path; "
                    "use --wait-any or --wait-all for multiple jobs."
                )
            job_path = args.job_path[0]
            if mode == "status":
                payload = render_job_view(job_path)
            elif mode == "wait":
                payload = wait_for_job(job_path)
            elif mode == "pause":
                payload = pause_job(job_path)
            else:
                payload = cancel_job(job_path)
            print_json(payload)
            return 0 if payload.get("ok") else 1

        if mode in {"wait_any", "wait_all"}:
            if not args.job_path:
                raise ValueError("Provide at least one --job-path for --wait-any / --wait-all.")
            if mode == "wait_any":
                payload = wait_for_jobs_any(args.job_path)
            else:
                payload = wait_for_jobs_all(args.job_path)
            print_json(payload)
            return 0 if payload.get("ok") else 1

        if mode == "ledger":
            payload = list_ledger(
                args.artifacts_root,
                limit=args.ledger_limit,
                session_id=args.ledger_session_id,
                runtime=args.ledger_runtime,
                provider=args.ledger_provider,
                state=args.ledger_state,
            )
            print_json(payload)
            return 0 if payload.get("ok") else 1

        if mode == "ledger_stats":
            payload = ledger_stats(
                args.artifacts_root,
                session_id=args.ledger_session_id,
                runtime=args.ledger_runtime,
                provider=args.ledger_provider,
                state=args.ledger_state,
            )
            print_json(payload)
            return 0 if payload.get("ok") else 1

        if mode == "list_sessions":
            payload = list_sessions(
                args.artifacts_root,
                limit=args.list_sessions_limit,
                session_id=args.ledger_session_id,
                cwd=args.list_sessions_cwd,
                runtime=args.list_sessions_runtime,
                provider=args.list_sessions_provider,
                state=args.list_sessions_state,
                assistant_role=args.list_sessions_role,
                task_type=args.list_sessions_task_type,
            )
            print_json(payload)
            return 0 if payload.get("ok") else 1

        if mode == "prune":
            payload = prune_terminal_jobs(
                args.artifacts_root,
                older_than_hours=args.prune_terminal_older_than_hours,
            )
            print_json(payload)
            return 0 if payload.get("ok") else 1

        if mode == "compact":
            payload = compact_terminal_jobs(
                args.artifacts_root,
                older_than_hours=args.compact_terminal_older_than_hours,
            )
            print_json(payload)
            return 0 if payload.get("ok") else 1

        artifacts_dir = build_artifacts_dir(args.artifacts_root)
        request = build_request(args)
        write_json((artifacts_dir / "request.json"), request)
        ledger_path = append_ledger_entry(args.artifacts_root, artifacts_dir, request)
        initialize_job(artifact_paths(artifacts_dir), request, ledger_path=str(ledger_path))

        if mode == "submit":
            payload, exit_code = submit_request(request, artifacts_dir, str(Path(__file__).resolve()))
            print_json(payload)
            return exit_code

        artifact_paths(artifacts_dir)["lock"].touch()
        payload = run_worker(str(artifacts_dir), None)
        normalized = Path(artifacts_dir / "normalized.json")
        if normalized.exists():
            print(normalized.read_text())
            return payload

        raise RuntimeError("run completed without normalized output")

    except Exception as exc:
        print_json(
            {
                "ok": False,
                "error_type": "input_error",
                "error_message": str(exc),
            }
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
