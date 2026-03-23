from __future__ import annotations

import json
import signal
import subprocess
import threading
from pathlib import Path
from typing import Callable

from .common import artifact_paths, read_json, write_json, write_text
from .transport import extract_tool_uses, parse_transport


def base_envelope(paths: dict[str, Path], request: dict) -> dict:
    job = read_json(paths["job"]) or {}
    return {
        "ok": False,
        "error_type": None,
        "error_message": None,
        "exit_code": None,
        "session_id": request["session_id"],
        "model": request["model"],
        "provider": request.get("provider"),
        "duration_ms": None,
        "model_usage": None,
        "num_turns": None,
        "total_cost_usd": None,
        "result": None,
        "stop_reason": None,
        "structured_output": None,
        "permission_denials": [],
        "routing": request.get("routing"),
        "tool_use_count": 0,
        "tool_uses": [],
        "artifacts": {
            "artifacts_dir": str(paths["artifacts_dir"]),
            "handoff_path": str(paths["handoff"]),
            "job_metadata_path": str(paths["job"]),
            "ledger_path": job.get("ledger_path"),
            "patch_path": str(paths["patch"]),
            "request_path": str(paths["request"]),
            "normalized_path": str(paths["normalized"]),
        },
    }


def write_outputs(paths: dict[str, Path], stdout: str, stderr: str) -> None:
    write_text(paths["events"], stdout)
    write_text(paths["stdout"], stdout)
    write_text(paths["stderr"], stderr)


def write_failure_envelope(
    request: dict,
    artifacts_dir: Path,
    error_type: str,
    error_message: str,
    *,
    exit_code: int | None = None,
) -> dict:
    paths = artifact_paths(artifacts_dir)
    envelope = base_envelope(paths, request)
    envelope["error_type"] = error_type
    envelope["error_message"] = error_message
    envelope["exit_code"] = exit_code
    write_json(paths["normalized"], envelope)
    return envelope


def normalize_process_output(
    request: dict,
    process: subprocess.CompletedProcess[str],
    artifacts_dir: Path,
) -> dict:
    paths = artifact_paths(artifacts_dir)
    write_outputs(paths, process.stdout, process.stderr)

    envelope = base_envelope(paths, request)
    envelope["exit_code"] = process.returncode

    final, events, parse_error = parse_transport(process.stdout)

    if process.returncode != 0:
        envelope["error_type"] = "process_error"
        envelope["error_message"] = (process.stderr or process.stdout).strip() or "ccc exited non-zero"
    elif parse_error is not None:
        envelope["error_type"] = "transport_error"
        envelope["error_message"] = parse_error
    else:
        assert final is not None
        init = {}
        if events is not None:
            init = next(
                (
                    event
                    for event in events
                    if event.get("type") == "system" and event.get("subtype") == "init"
                ),
                {},
            )
        envelope["session_id"] = final.get("session_id") or init.get("session_id") or request["session_id"]
        envelope["duration_ms"] = final.get("duration_ms")
        envelope["model_usage"] = final.get("modelUsage") or final.get("model_usage")
        envelope["num_turns"] = final.get("num_turns")
        envelope["stop_reason"] = final.get("stop_reason")
        envelope["total_cost_usd"] = final.get("total_cost_usd")
        envelope["result"] = final.get("result")
        envelope["structured_output"] = final.get("structured_output")
        envelope["permission_denials"] = final.get("permission_denials", [])
        envelope["tool_uses"] = extract_tool_uses(events) if events is not None else []
        envelope["tool_use_count"] = len(envelope["tool_uses"])

        if final.get("is_error"):
            envelope["error_type"] = "delegate_error"
            envelope["error_message"] = final.get("result") or "ccc reported is_error=true"
        elif request["schema"] is not None and "structured_output" not in final:
            envelope["error_type"] = "protocol_error"
            envelope["error_message"] = "schema supplied but structured_output missing from final event"
        else:
            envelope["ok"] = True

    write_json(paths["normalized"], envelope)
    return envelope


class DelegateRuntime:
    def __init__(
        self,
        request: dict,
        artifacts_dir: Path,
        *,
        on_spawn: Callable[[int], None] | None = None,
        on_event: Callable[[dict, int], None] | None = None,
    ) -> None:
        self.request = request
        self.artifacts_dir = artifacts_dir
        self.paths = artifact_paths(artifacts_dir)
        self.on_spawn = on_spawn
        self.on_event = on_event
        self.process: subprocess.Popen[str] | None = None
        self.cancel_requested = False
        self.cancel_exit_code = 143
        self.cancel_reason = "job cancelled"
        self._previous_handlers: dict[int, signal.Handlers] = {}
        self._stdout_lines: list[str] = []
        self._stderr_lines: list[str] = []
        self._event_count = 0

    def execute(self) -> dict:
        self._install_signal_handlers()
        try:
            if self.cancel_requested:
                write_outputs(self.paths, "", "")
                return write_failure_envelope(
                    self.request,
                    self.artifacts_dir,
                    "cancelled",
                    self.cancel_reason,
                    exit_code=self.cancel_exit_code,
                )

            self.process = subprocess.Popen(
                self.request["command"],
                cwd=((self.request.get("execution_workspace") or {}).get("execution_cwd") or self.request["cwd"]),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            if self.on_spawn is not None:
                self.on_spawn(self.process.pid)
            if self.cancel_requested and self.process.poll() is None:
                self.process.terminate()

            self.paths["events"].write_text("")
            self.paths["stdout"].write_text("")
            self.paths["stderr"].write_text("")

            stdout_thread = threading.Thread(
                target=self._read_stdout_stream,
                args=(self.process.stdout,),
                daemon=True,
            )
            stderr_thread = threading.Thread(
                target=self._read_stderr_stream,
                args=(self.process.stderr,),
                daemon=True,
            )
            stdout_thread.start()
            stderr_thread.start()

            timeout_seconds = self.request.get("timeout_seconds")
            try:
                if timeout_seconds is None:
                    self.process.wait()
                else:
                    self.process.wait(timeout=timeout_seconds)
            except subprocess.TimeoutExpired as exc:
                self.process.kill()
                self.process.wait()
                stdout_thread.join()
                stderr_thread.join()
                stdout = "".join(self._stdout_lines)
                stderr = "".join(self._stderr_lines)
                write_outputs(self.paths, stdout or exc.stdout or "", stderr or exc.stderr or "")
                return write_failure_envelope(
                    self.request,
                    self.artifacts_dir,
                    "timeout_error",
                    f"ccc timed out after {timeout_seconds} seconds",
                    exit_code=124,
                )

            stdout_thread.join()
            stderr_thread.join()
            stdout = "".join(self._stdout_lines)
            stderr = "".join(self._stderr_lines)
            completed = subprocess.CompletedProcess(
                self.request["command"],
                self.process.returncode,
                stdout,
                stderr,
            )

            if self.cancel_requested:
                write_outputs(self.paths, stdout, stderr)
                return write_failure_envelope(
                    self.request,
                    self.artifacts_dir,
                    "cancelled",
                    self.cancel_reason,
                    exit_code=self.cancel_exit_code,
                )

            return normalize_process_output(self.request, completed, self.artifacts_dir)
        finally:
            self._restore_signal_handlers()

    def _install_signal_handlers(self) -> None:
        for signum in (signal.SIGTERM, signal.SIGINT):
            self._previous_handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, self._handle_cancel_signal)

    def _restore_signal_handlers(self) -> None:
        for signum, handler in self._previous_handlers.items():
            signal.signal(signum, handler)

    def _handle_cancel_signal(self, signum: int, _frame: object) -> None:
        self.cancel_requested = True
        self.cancel_exit_code = 128 + signum
        self.cancel_reason = f"job cancelled by signal {signum}"
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()

    def _read_stdout_stream(self, stream: object) -> None:
        assert stream is not None
        with self.paths["events"].open("a") as events_handle, self.paths["stdout"].open("a") as stdout_handle:
            for line in iter(stream.readline, ""):
                self._stdout_lines.append(line)
                events_handle.write(line)
                events_handle.flush()
                stdout_handle.write(line)
                stdout_handle.flush()
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    payload = json.loads(stripped)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue
                self._event_count += 1
                if self.on_event is not None:
                    self.on_event(payload, self._event_count)

    def _read_stderr_stream(self, stream: object) -> None:
        assert stream is not None
        with self.paths["stderr"].open("a") as stderr_handle:
            for line in iter(stream.readline, ""):
                self._stderr_lines.append(line)
                stderr_handle.write(line)
                stderr_handle.flush()
