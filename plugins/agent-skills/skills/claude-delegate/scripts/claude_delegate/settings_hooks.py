from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

from .common import write_json


HOOK_TIMEOUT_SECONDS = 10
SETTINGS_SCHEMA_URL = "https://json.schemastore.org/claude-code-settings.json"
TRANSPORT_ENV_KEYS = {
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
}


def _skill_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _bash_guard_script() -> str:
    return str((_skill_root() / "hooks" / "bash_guardrails.sh").resolve())


def _parse_settings(raw: str) -> dict:
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("Claude settings must decode to a JSON object.")
    return parsed


def _minimal_settings() -> dict:
    return {
        "$schema": SETTINGS_SCHEMA_URL,
        "hooks": {},
    }


def _load_settings_value(value: str) -> dict:

    candidate = Path(value).expanduser()
    if candidate.exists():
        return _parse_settings(candidate.read_text())

    if value.lstrip().startswith("{"):
        return _parse_settings(value)

    raise ValueError(f"Claude settings path not found: {candidate}")


def _hook_entry(command: str) -> dict:
    return {
        "hooks": [
            {
                "type": "command",
                "command": command,
                "timeout": HOOK_TIMEOUT_SECONDS,
            }
        ]
    }


def _has_command_hook(items: list[dict], command: str) -> bool:
    for item in items:
        for hook in item.get("hooks", []):
            if hook.get("type") == "command" and hook.get("command") == command:
                return True
    return False


def _scrub_conflicting_settings(settings: dict, request: dict) -> dict:
    scrubbed = deepcopy(settings)

    # Request-level provider/model selection is the source of truth.
    if request.get("provider") is not None:
        env = scrubbed.get("env")
        if isinstance(env, dict):
            for key in TRANSPORT_ENV_KEYS:
                env.pop(key, None)
            if not env:
                scrubbed.pop("env", None)

    if request.get("provider") is not None or request.get("model") is not None:
        scrubbed.pop("model", None)

    return scrubbed


def materialize_settings(request: dict, artifacts_dir: str | Path) -> dict:
    updated = deepcopy(request)
    runtime_resolution = updated.get("runtime_resolution") or {}
    runtime_name = runtime_resolution.get("name") or updated.get("runtime") or "runtime"
    if not runtime_resolution.get("supports_settings", True):
        raise ValueError(
            f"Runtime '{runtime_name}' does not support job-local settings injection; "
            "this adapter currently requires a Claude-compatible settings surface."
        )
    settings_value = updated.get("settings")
    settings = _minimal_settings() if settings_value is None else _load_settings_value(settings_value)
    settings = _scrub_conflicting_settings(settings, updated)

    hooks = settings.setdefault("hooks", {})
    pre_tool_use = hooks.setdefault("PreToolUse", [])

    command = _bash_guard_script()
    if not _has_command_hook(pre_tool_use, command):
        pre_tool_use.append(_hook_entry(command))

    settings_path = Path(artifacts_dir) / "claude_settings.json"
    write_json(settings_path, settings)
    updated["settings"] = str(settings_path)
    return updated
