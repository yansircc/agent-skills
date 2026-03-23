"""Verify provider-aware request building and session routing."""
from __future__ import annotations

import json
import tempfile
import sys
from unittest import mock
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from claude_delegate.common import artifact_paths, read_json, write_json
from claude_delegate.job_state import initialize_job
from claude_delegate.ledger import append_ledger_entry, find_routable_session, list_sessions
from claude_delegate.request import build_request
from claude_delegate.settings_hooks import materialize_settings


def _args(**overrides):
    base = {
        "assistant_role": "explorer",
        "artifacts_root": None,
        "ccc_bin": "ccc",
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
        "ledger_session_id": None,
        "ledger_state": None,
        "ledger_stats": False,
        "list_sessions": False,
        "list_sessions_cwd": None,
        "list_sessions_limit": None,
        "list_sessions_provider": None,
        "list_sessions_role": None,
        "list_sessions_state": None,
        "list_sessions_task_type": None,
        "max_budget_usd": None,
        "model": "haiku",
        "pause": False,
        "prompt": "Say hello and finish.",
        "prompt_file": None,
        "provider": None,
        "prune_terminal_older_than_hours": None,
        "resume_job": None,
        "resume_session_id": None,
        "retry_job": None,
        "schema_file": None,
        "schema_json": None,
        "session_id": None,
        "session_routing": "new",
        "settings": None,
        "status": False,
        "submit": False,
        "system_prompt": None,
        "task_packet_file": None,
        "task_packet_json": None,
        "task_type": "general",
        "timeout_seconds": None,
        "tools": "Bash",
        "wait": False,
        "workflow_roles": None,
        "startup_fd": None,
        "cancel": False,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _materialize_job(root: Path, request: dict, name: str, *, normalized: dict | None = None) -> None:
    job_dir = root / name
    job_dir.mkdir(parents=True)
    paths = artifact_paths(job_dir)
    write_json(paths["request"], request)
    ledger_path = append_ledger_entry(root, job_dir, request)
    initialize_job(paths, request, ledger_path=str(ledger_path))
    job = read_json(paths["job"]) or {}
    job["state"] = "finished"
    job["finished_at"] = request["created_at"]
    write_json(paths["job"], job)
    payload = normalized or {
        "ok": True,
        "completion": {
            "summary": f"{request.get('provider') or 'default'}:{request.get('model') or 'default'}",
        },
    }
    write_json(paths["normalized"], payload)


def _read_job_settings(request: dict) -> dict:
    settings_path = Path(request["settings"])
    return json.loads(settings_path.read_text())


def test() -> None:
    request = build_request(_args(provider="minimax", model=None))
    assert request["provider"] == "minimax"
    assert request["model"] is None
    assert "--provider" in request["command"]
    assert "--model" not in request["command"]
    print("PASS  explicit provider does not force default model")

    omitted_tools = build_request(_args(tools=None, assistant_role="implementer"))
    assert omitted_tools["tools"] is None
    assert "--tools" not in omitted_tools["command"]
    assert omitted_tools["task_packet"]["allowed_tools"] == []
    print("PASS  omitted tools leaves command unrestricted")

    explicit_empty_tools = build_request(_args(tools=""))
    assert explicit_empty_tools["tools"] == ""
    empty_tools_index = explicit_empty_tools["command"].index("--tools")
    assert explicit_empty_tools["command"][empty_tools_index + 1] == ""
    assert explicit_empty_tools["task_packet"]["allowed_tools"] == []
    print("PASS  explicit empty tools preserves no-tools contract")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        fake_home = root / "home"
        (fake_home / ".claude").mkdir(parents=True)
        write_json(
            fake_home / ".claude" / "settings.json",
            {
                "$schema": "https://json.schemastore.org/claude-code-settings.json",
                "env": {
                    "ANTHROPIC_BASE_URL": "https://should-not-leak.example",
                    "ANTHROPIC_AUTH_TOKEN": "secret",
                },
                "model": "opus[1m]",
            },
        )
        with mock.patch("pathlib.Path.home", return_value=fake_home):
            request = materialize_settings(
                build_request(_args(settings=None)),
                root,
            )
        settings = _read_job_settings(request)
        assert settings["$schema"] == "https://json.schemastore.org/claude-code-settings.json"
        assert settings["hooks"]["PreToolUse"]
        assert "env" not in settings
        assert "model" not in settings
        print("PASS  default materialized settings are self-contained and do not inherit ~/.claude/settings.json")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        explicit_settings = json.dumps(
            {
                "$schema": "https://json.schemastore.org/claude-code-settings.json",
                "env": {
                    "ANTHROPIC_API_KEY": "api-key",
                    "ANTHROPIC_AUTH_TOKEN": "auth-token",
                    "ANTHROPIC_BASE_URL": "https://wrong-provider.example",
                    "KEEP_ME": "1",
                },
                "hooks": {
                    "PostToolUse": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "~/.claude/hooks/custom.sh",
                                    "timeout": 10,
                                }
                            ]
                        }
                    ]
                },
                "model": "opus[1m]",
            }
        )
        request = materialize_settings(
            build_request(_args(provider="minimax", model=None, settings=explicit_settings)),
            root,
        )
        settings = _read_job_settings(request)
        assert settings["env"] == {"KEEP_ME": "1"}
        assert "model" not in settings
        assert settings["hooks"]["PostToolUse"]
        assert settings["hooks"]["PreToolUse"]
        print("PASS  explicit provider scrub keeps request truth and preserves unrelated settings")

    packet_tools = build_request(
        _args(
            tools=None,
            task_packet_json=json.dumps(
                {
                    "goal": "Say hello and finish.",
                    "allowed_tools": ["Read"],
                }
            ),
        )
    )
    assert packet_tools["tools"] == "Read"
    packet_tools_index = packet_tools["command"].index("--tools")
    assert packet_tools["command"][packet_tools_index + 1] == "Read"
    assert packet_tools["task_packet"]["allowed_tools"] == ["Read"]
    print("PASS  explicit task_packet tools stay aligned with ccc")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        common = {
            "artifacts_root": str(root),
            "cwd": "/private/tmp/provider-routing",
            "assistant_role": "implementer",
            "task_type": "coding",
            "session_routing": "new",
            "prompt": "Bounded task.",
            "tools": "Bash,Read",
            "model": "haiku",
        }
        minimax_request = build_request(_args(provider="minimax", session_id="session-minimax", **common))
        anthropic_request = build_request(_args(provider=None, session_id="session-default", **common))
        _materialize_job(root, minimax_request, "job-minimax")
        _materialize_job(root, anthropic_request, "job-default")

        routed = find_routable_session(
            root,
            cwd=minimax_request["cwd"],
            workspace_id=minimax_request["workspace_identity"]["workspace_id"],
            assistant_role=minimax_request["assistant_role"],
            task_type=minimax_request["task_type"],
            provider="minimax",
            model="haiku",
        )
        assert routed["matched_session"] is not None
        assert routed["matched_session"]["session_id"] == "session-minimax"

        default_routed = find_routable_session(
            root,
            cwd=minimax_request["cwd"],
            workspace_id=anthropic_request["workspace_identity"]["workspace_id"],
            assistant_role=minimax_request["assistant_role"],
            task_type=minimax_request["task_type"],
            provider=None,
            model="haiku",
        )
        assert default_routed["matched_session"] is not None
        assert default_routed["matched_session"]["session_id"] == "session-default"

        sessions = list_sessions(root, provider="minimax")
        assert sessions["count"] == 1
        assert sessions["items"][0]["provider"] == "minimax"
        assert sessions["items"][0]["workspace_id"] == minimax_request["workspace_identity"]["workspace_id"]
        print("PASS  routing and session listing are provider-aware")

        heavy_request = build_request(
            _args(
                artifacts_root=str(root),
                cwd="/private/tmp/provider-routing",
                assistant_role="implementer",
                task_type="coding",
                session_routing="new",
                prompt="Heavy task.",
                tools="Bash,Read",
                model="haiku",
                provider=None,
                session_id="session-heavy",
            )
        )
        _materialize_job(
            root,
            heavy_request,
            "job-heavy",
            normalized={
                "ok": True,
                "completion": {"summary": "heavy session"},
                "duration_ms": 250_000,
                "num_turns": 30,
                "model_usage": {
                    "claude-haiku": {
                        "cacheReadInputTokens": 300_000,
                    }
                },
            },
        )

        heavy_sessions = list_sessions(root, session_id="session-heavy")
        assert heavy_sessions["count"] == 1
        assert heavy_sessions["items"][0]["session_health"]["status"] == "soft_capped"

        auto_reuse = build_request(
            _args(
                artifacts_root=str(root),
                cwd="/private/tmp/provider-routing",
                assistant_role="implementer",
                task_type="coding",
                session_routing="auto",
                prompt="Follow-up task.",
                tools="Bash,Read",
                model="haiku",
                provider=None,
            )
        )
        assert auto_reuse["routing"]["decision"] == "matched_resumable"
        assert auto_reuse["session_id"] == "session-heavy"
        assert auto_reuse["resume_session_id"] == "session-heavy"
        print("PASS  auto routing reuses matched sessions even when health signals are soft-capped")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        common = {
            "artifacts_root": str(root),
            "cwd": "/private/tmp/workspace-routing",
            "assistant_role": "implementer",
            "task_type": "coding",
            "session_routing": "new",
            "tools": "Bash,Read",
            "model": "haiku",
            "provider": None,
        }

        broad_request = build_request(
            _args(
                prompt="Broad task.",
                session_id="session-broad",
                **common,
            )
        )
        narrow_request = build_request(
            _args(
                prompt="Narrow task.",
                session_id="session-narrow",
                task_packet_json=json.dumps(
                    {
                        "goal": "Narrow task.",
                        "execution_policy": {
                            "allowed_write_paths": ["pkg"],
                            "observe_roots": ["pkg"],
                        },
                    }
                ),
                **common,
            )
        )
        _materialize_job(root, broad_request, "job-broad")
        _materialize_job(root, narrow_request, "job-narrow")

        assert broad_request["workspace_identity"]["workspace_id"] != narrow_request["workspace_identity"]["workspace_id"]

        broad_auto = build_request(
            _args(
                artifacts_root=str(root),
                cwd="/private/tmp/workspace-routing",
                assistant_role="implementer",
                task_type="coding",
                prompt="Broad follow-up.",
                session_routing="auto",
                tools="Bash,Read",
                model="haiku",
                provider=None,
            )
        )
        narrow_auto = build_request(
            _args(
                artifacts_root=str(root),
                cwd="/private/tmp/workspace-routing",
                assistant_role="implementer",
                task_type="coding",
                prompt="Narrow follow-up.",
                session_routing="auto",
                tools="Bash,Read",
                model="haiku",
                provider=None,
                task_packet_json=json.dumps(
                    {
                        "goal": "Narrow follow-up.",
                        "execution_policy": {
                            "allowed_write_paths": ["pkg"],
                            "observe_roots": ["pkg"],
                        },
                    }
                ),
            )
        )

        assert broad_auto["session_id"] == "session-broad"
        assert narrow_auto["session_id"] == "session-narrow"
        print("PASS  auto routing is workspace-boundary aware")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        legacy_request = build_request(
            _args(
                artifacts_root=str(root),
                cwd="/private/tmp/workspace-routing",
                assistant_role="implementer",
                task_type="coding",
                session_routing="new",
                prompt="Legacy narrow task.",
                tools="Bash,Read",
                model="haiku",
                provider=None,
                session_id="session-legacy-narrow",
                task_packet_json=json.dumps(
                    {
                        "goal": "Legacy narrow task.",
                        "execution_policy": {
                            "allowed_write_paths": ["pkg"],
                            "observe_roots": ["pkg"],
                        },
                    }
                ),
            )
        )
        legacy_request.pop("workspace_identity", None)
        _materialize_job(root, legacy_request, "job-legacy-narrow")

        legacy_auto = build_request(
            _args(
                artifacts_root=str(root),
                cwd="/private/tmp/workspace-routing",
                assistant_role="implementer",
                task_type="coding",
                session_routing="auto",
                prompt="Legacy narrow follow-up.",
                tools="Bash,Read",
                model="haiku",
                provider=None,
                task_packet_json=json.dumps(
                    {
                        "goal": "Legacy narrow follow-up.",
                        "execution_policy": {
                            "allowed_write_paths": ["pkg"],
                            "observe_roots": ["pkg"],
                        },
                    }
                ),
            )
        )

        assert legacy_auto["session_id"] == "session-legacy-narrow"
        assert legacy_auto["resume_session_id"] == "session-legacy-narrow"
        print("PASS  legacy jobs derive workspace identity during routing")

    print("\nAll tests passed.")


if __name__ == "__main__":
    test()
