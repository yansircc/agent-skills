"""Verify SDK transport option construction."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from claude_delegate.request import build_request
from claude_delegate.sdk_transport import build_sdk_options


def _args(**overrides):
    base = {
        "assistant_role": "explorer",
        "artifacts_root": None,
        "cancel": False,
        "ccc_bin": None,
        "compact_terminal_older_than_hours": None,
        "completion_contract_file": None,
        "completion_contract_json": None,
        "cwd": "/private/tmp",
        "delta_prompt": None,
        "delta_prompt_file": None,
        "fork_job": None,
        "job_path": None,
        "job_worker": False,
        "ledger": False,
        "ledger_limit": 20,
        "ledger_provider": None,
        "ledger_runtime": None,
        "ledger_session_id": None,
        "ledger_state": None,
        "ledger_stats": False,
        "list_sessions": False,
        "list_sessions_cwd": None,
        "list_sessions_limit": None,
        "list_sessions_provider": None,
        "list_sessions_role": None,
        "list_sessions_runtime": None,
        "list_sessions_state": None,
        "list_sessions_task_type": None,
        "max_budget_usd": None,
        "model": None,
        "pause": False,
        "prompt": "Say hello and finish.",
        "prompt_file": None,
        "provider": None,
        "prune_terminal_older_than_hours": None,
        "resume_job": None,
        "resume_session_id": None,
        "retry_job": None,
        "runtime": None,
        "runtime_bin": None,
        "runtime_config": None,
        "schema_file": None,
        "schema_json": None,
        "session_id": None,
        "session_routing": "new",
        "settings": None,
        "startup_fd": None,
        "status": False,
        "submit": False,
        "system_prompt": None,
        "task_packet_file": None,
        "task_packet_json": None,
        "task_type": "general",
        "timeout_seconds": None,
        "tools": "Bash",
        "wait": False,
        "wait_all": False,
        "wait_any": False,
        "workflow_roles": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _write_runtime_config(fake_home: Path, payload: dict) -> None:
    path = fake_home / ".codex" / "claude-delegate" / "runtime_profiles.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def test() -> None:
    with tempfile.TemporaryDirectory() as home_tmp:
        fake_home = Path(home_tmp) / "home"
        fake_home.mkdir(parents=True)
        _write_runtime_config(
            fake_home,
            {
                "default_runtime": "ccc",
                "providers": {
                    "minimax": {
                        "runtime": "ccc",
                        "native_provider": "minimax",
                        "extra_args": ["--debug-to-stderr", "--foo", "bar", "--toggle"],
                    }
                },
                "runtimes": {
                    "ccc": {
                        "bin": "/Users/yansir/.local/bin/ccc",
                        "supports_native_provider": True,
                        "supports_settings": True,
                    }
                },
            },
        )

        with mock.patch("pathlib.Path.home", return_value=fake_home):
            with mock.patch.dict(os.environ, {}, clear=True):
                request = build_request(
                    _args(
                        provider="minimax",
                        settings='{"env":{"KEEP_ME":"1"}}',
                    )
                )
                options = build_sdk_options(request)

    assert options.cli_path == "/Users/yansir/.local/bin/ccc"
    assert options.extra_args == {
        "provider": "minimax",
        "debug-to-stderr": None,
        "foo": "bar",
        "toggle": None,
    }
    assert options.output_format == {"type": "json_schema", "schema": request["schema"]}
    assert options.settings == '{"env":{"KEEP_ME":"1"}}'
    assert options.include_partial_messages is True
    assert options.permission_mode == "bypassPermissions"
    print("PASS  sdk transport maps runtime/provider/schema into structured SDK options")


if __name__ == "__main__":
    test()
