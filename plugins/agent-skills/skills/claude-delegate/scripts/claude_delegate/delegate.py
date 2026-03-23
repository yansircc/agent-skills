from __future__ import annotations

import asyncio
import json
import signal
from pathlib import Path
from typing import Callable

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    StreamEvent,
    query,
)

from .common import artifact_paths, read_json, write_json, write_text
from .sdk_transport import (
    build_sdk_options,
    extract_tool_uses_from_messages,
    message_to_event,
    result_to_envelope_fields,
)


def base_envelope(paths: dict[str, Path], request: dict) -> dict:
    job = read_json(paths["job"]) or {}
    return {
        "ok": False,
        "error_type": None,
        "error_message": None,
        "exit_code": None,
        "session_id": request["session_id"],
        "runtime": request.get("runtime"),
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
        self.cancel_requested = False
        self.cancel_exit_code = 143
        self.cancel_reason = "job cancelled"
        self._previous_handlers: dict[int, signal.Handlers] = {}
        self._event_count = 0
        self._collected_messages: list = []
        self._stderr_lines: list[str] = []

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

            return asyncio.run(self._execute_async())
        finally:
            self._restore_signal_handlers()

    async def _execute_async(self) -> dict:
        options = build_sdk_options(self.request, stderr_callback=self._record_stderr)
        prompt = self.request["prompt"]

        # Initialise artifact files
        self.paths["events"].write_text("")
        self.paths["stdout"].write_text("")
        self.paths["stderr"].write_text("")

        result_msg: ResultMessage | None = None
        cancel_event = asyncio.Event()

        # Wire SIGTERM/SIGINT into the async cancellation path
        loop = asyncio.get_running_loop()
        for signum in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(signum, lambda s=signum: self._handle_cancel_async(s, cancel_event))

        timeout_seconds = self.request.get("timeout_seconds")

        try:
            async with asyncio.timeout(timeout_seconds):
                async for msg in query(prompt=prompt, options=options):
                    if self.cancel_requested:
                        break

                    self._collected_messages.append(msg)
                    event_dict = message_to_event(msg)
                    if event_dict is not None:
                        self._record_event(event_dict)

                    if isinstance(msg, ResultMessage):
                        result_msg = msg

        except TimeoutError:
            runtime_label = self.request.get("runtime") or "delegate runtime"
            return write_failure_envelope(
                self.request,
                self.artifacts_dir,
                "timeout_error",
                f"{runtime_label} timed out after {timeout_seconds} seconds",
                exit_code=124,
            )
        except Exception as exc:
            return write_failure_envelope(
                self.request,
                self.artifacts_dir,
                "sdk_error",
                str(exc),
                exit_code=1,
            )
        finally:
            # Restore signal handlers (remove async handlers)
            for signum in (signal.SIGTERM, signal.SIGINT):
                loop.remove_signal_handler(signum)

        if self.cancel_requested:
            return write_failure_envelope(
                self.request,
                self.artifacts_dir,
                "cancelled",
                self.cancel_reason,
                exit_code=self.cancel_exit_code,
            )

        return self._build_envelope(result_msg)

    def _build_envelope(self, result_msg: ResultMessage | None) -> dict:
        envelope = base_envelope(self.paths, self.request)
        tool_uses = extract_tool_uses_from_messages(self._collected_messages)

        if result_msg is None:
            envelope["error_type"] = "protocol_error"
            envelope["error_message"] = "SDK stream ended without a ResultMessage"
        else:
            result_fields = result_to_envelope_fields(result_msg)
            envelope.update(result_fields)

            if (
                envelope["ok"]
                and self.request.get("schema") is not None
                and result_msg.structured_output is None
            ):
                envelope["ok"] = False
                envelope["error_type"] = "protocol_error"
                envelope["error_message"] = "schema supplied but structured_output missing from result"

        envelope["tool_uses"] = tool_uses
        envelope["tool_use_count"] = len(tool_uses)
        write_json(self.paths["normalized"], envelope)
        return envelope

    def _record_event(self, event_dict: dict) -> None:
        line = json.dumps(event_dict, separators=(",", ":")) + "\n"
        with self.paths["events"].open("a") as f:
            f.write(line)
            f.flush()
        with self.paths["stdout"].open("a") as f:
            f.write(line)
            f.flush()
        self._event_count += 1
        if self.on_event is not None:
            self.on_event(event_dict, self._event_count)

    def _record_stderr(self, line: str) -> None:
        normalized = line if line.endswith("\n") else f"{line}\n"
        self._stderr_lines.append(normalized)
        with self.paths["stderr"].open("a") as f:
            f.write(normalized)
            f.flush()

    def _handle_cancel_async(self, signum: int, cancel_event: asyncio.Event) -> None:
        self.cancel_requested = True
        self.cancel_exit_code = 128 + signum
        self.cancel_reason = f"job cancelled by signal {signum}"
        cancel_event.set()

    def _install_signal_handlers(self) -> None:
        for signum in (signal.SIGTERM, signal.SIGINT):
            self._previous_handlers[signum] = signal.getsignal(signum)

    def _restore_signal_handlers(self) -> None:
        for signum, handler in self._previous_handlers.items():
            signal.signal(signum, handler)
