"""Verify runtime-aware request building and session routing."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from claude_delegate.common import artifact_paths, read_json, write_json
from claude_delegate.job_state import initialize_job
from claude_delegate.ledger import append_ledger_entry, find_routable_session, list_sessions
from claude_delegate.request import build_request
from claude_delegate.runtime_profiles import build_process_env


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
        "model": "haiku",
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
            "summary": f"{request.get('runtime')}:{request.get('provider') or 'default'}:{request.get('model') or 'default'}",
        },
    }
    write_json(paths["normalized"], payload)


def _runtime_config_path(fake_home: Path) -> Path:
    return fake_home / ".codex" / "claude-delegate" / "runtime_profiles.json"


def _write_runtime_config(fake_home: Path, payload: dict) -> Path:
    path = _runtime_config_path(fake_home)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, payload)
    return path


def _clear_runtime_config(fake_home: Path) -> None:
    path = _runtime_config_path(fake_home)
    if path.exists():
        path.unlink()


def test() -> None:
    with tempfile.TemporaryDirectory() as home_tmp:
        fake_home = Path(home_tmp) / "home"
        fake_home.mkdir(parents=True)

        with mock.patch("pathlib.Path.home", return_value=fake_home):
            with mock.patch.dict(os.environ, {}, clear=True):
                # --- Runtime & provider resolution ---
                request = build_request(_args(runtime="ccc", provider="minimax", model=None))
                assert request["runtime"] == "ccc"
                assert request["runtime_bin"] == "ccc"
                assert request["model"] is None
                resolution = request["runtime_resolution"]
                assert resolution["provider_strategy"]["native_provider"] == "minimax"
                print("PASS  explicit ccc runtime preserves native provider routing")

                default_request = build_request(_args())
                assert default_request["runtime"] == "claude"
                assert default_request["runtime_bin"] == "claude"
                assert default_request["model"] == "haiku"
                assert default_request["runtime_resolution"]["provider_strategy"]["native_provider"] is None
                print("PASS  builtin default runtime stays generic claude")

                # --- Tools handling ---
                omitted_tools = build_request(_args(tools=None, assistant_role="implementer"))
                assert omitted_tools["tools"] is None
                assert omitted_tools["task_packet"]["allowed_tools"] == []
                print("PASS  omitted tools leaves runtime unrestricted")

                explicit_empty_tools = build_request(_args(tools=""))
                assert explicit_empty_tools["tools"] == ""
                assert explicit_empty_tools["task_packet"]["allowed_tools"] == []
                print("PASS  explicit empty tools preserves no-tools contract")

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
                assert packet_tools["task_packet"]["allowed_tools"] == ["Read"]
                print("PASS  explicit task_packet tools stay aligned")

                # --- Runtime config ---
                _write_runtime_config(fake_home, {"default_runtime": "ccc"})
                local_default = build_request(_args())
                assert local_default["runtime"] == "ccc"
                assert local_default["runtime_bin"] == "ccc"
                print("PASS  local runtime config can flip the default runtime to ccc")

                # --- Provider env profile ---
                _write_runtime_config(
                    fake_home,
                    {
                        "providers": {
                            "minimax": {
                                "runtime": "claude",
                                "process_env": {
                                    "ANTHROPIC_BASE_URL": "${MINIMAX_BASE_URL}",
                                    "ANTHROPIC_AUTH_TOKEN": "${MINIMAX_AUTH_TOKEN}",
                                },
                            }
                        }
                    },
                )
                with mock.patch.dict(
                    os.environ,
                    {
                        "MINIMAX_BASE_URL": "https://minimax.example",
                        "MINIMAX_AUTH_TOKEN": "token-123",
                    },
                    clear=True,
                ):
                    env_profiled = build_request(_args(provider="minimax", model=None))
                    assert env_profiled["runtime"] == "claude"
                    assert env_profiled["runtime_bin"] == "claude"
                    assert env_profiled["runtime_resolution"]["provider_strategy"]["native_provider"] is None
                    process_env = build_process_env(env_profiled)
                    assert process_env["ANTHROPIC_BASE_URL"] == "https://minimax.example"
                    assert process_env["ANTHROPIC_AUTH_TOKEN"] == "token-123"
                    assert env_profiled["runtime_resolution"]["provider_strategy"]["process_env_keys"] == [
                        "ANTHROPIC_AUTH_TOKEN",
                        "ANTHROPIC_BASE_URL",
                    ]
                print("PASS  claude runtime can route providers through process env profiles")

                _clear_runtime_config(fake_home)

                # --- Session routing ---
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
                    minimax_request = build_request(
                        _args(runtime="ccc", provider="minimax", session_id="session-minimax", **common)
                    )
                    claude_request = build_request(
                        _args(runtime="claude", provider=None, session_id="session-claude", **common)
                    )
                    ccc_request = build_request(
                        _args(runtime="ccc", provider=None, session_id="session-ccc", **common)
                    )
                    _materialize_job(root, minimax_request, "job-minimax")
                    _materialize_job(root, claude_request, "job-claude")
                    _materialize_job(root, ccc_request, "job-ccc")

                    routed = find_routable_session(
                        root,
                        cwd=minimax_request["cwd"],
                        workspace_id=minimax_request["workspace_identity"]["workspace_id"],
                        runtime="ccc",
                        assistant_role=minimax_request["assistant_role"],
                        task_type=minimax_request["task_type"],
                        provider="minimax",
                        model="haiku",
                    )
                    assert routed["matched_session"] is not None
                    assert routed["matched_session"]["session_id"] == "session-minimax"

                    claude_routed = find_routable_session(
                        root,
                        cwd=claude_request["cwd"],
                        workspace_id=claude_request["workspace_identity"]["workspace_id"],
                        runtime="claude",
                        assistant_role=claude_request["assistant_role"],
                        task_type=claude_request["task_type"],
                        provider=None,
                        model="haiku",
                    )
                    assert claude_routed["matched_session"] is not None
                    assert claude_routed["matched_session"]["session_id"] == "session-claude"

                    sessions = list_sessions(root, provider="minimax", runtime="ccc")
                    assert sessions["count"] == 1
                    assert sessions["items"][0]["provider"] == "minimax"
                    assert sessions["items"][0]["runtime"] == "ccc"
                    assert sessions["items"][0]["workspace_id"] == minimax_request["workspace_identity"]["workspace_id"]
                    print("PASS  routing and session listing are runtime-aware")

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
                            runtime="claude",
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
                    assert heavy_sessions["items"][0]["session_health"]["last_num_turns"] == 30

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
                            runtime="claude",
                        )
                    )
                    assert auto_reuse["routing"]["decision"] == "matched_resumable"
                    assert auto_reuse["session_id"] == "session-heavy"
                    assert auto_reuse["resume_session_id"] == "session-heavy"
                    print("PASS  auto routing reuses matched sessions within the same runtime")

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
                        "runtime": "claude",
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
                            runtime="claude",
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
                            runtime="claude",
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
                            runtime="claude",
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
                            runtime="claude",
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
