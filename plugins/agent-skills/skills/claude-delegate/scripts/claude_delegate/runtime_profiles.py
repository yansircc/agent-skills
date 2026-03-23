from __future__ import annotations

import json
import os
import re
from copy import deepcopy
from pathlib import Path


RUNTIME_CONFIG_ENV = "CLAUDE_DELEGATE_RUNTIME_CONFIG"
RUNTIME_ENV = "CLAUDE_DELEGATE_RUNTIME"
RUNTIME_BIN_ENV = "CLAUDE_DELEGATE_RUNTIME_BIN"
LEGACY_CCC_BIN_ENV = "CCC_BIN"
ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)")

DEFAULT_RUNTIME_CONFIG = {
    "default_runtime": "claude",
    "runtimes": {
        "claude": {
            "bin": "claude",
            "args": [],
            "supports_native_provider": False,
            "supports_settings": True,
        },
        "ccc": {
            "bin": "ccc",
            "args": [],
            "supports_native_provider": True,
            "supports_settings": True,
        },
    },
    "providers": {},
}


def _deep_merge(base: object, override: object) -> object:
    if isinstance(base, dict) and isinstance(override, dict):
        merged = dict(base)
        for key, value in override.items():
            merged[key] = _deep_merge(base.get(key), value) if key in base else deepcopy(value)
        return merged
    return deepcopy(override)


def default_runtime_config_paths() -> list[Path]:
    home = Path.home()
    return [
        home / ".codex" / "claude-delegate" / "runtime_profiles.json",
        home / ".config" / "claude-delegate" / "runtime_profiles.json",
    ]


def _normalize_name(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _load_json_file(path: Path) -> dict:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError(f"Runtime config must decode to a JSON object: {path}")
    return payload


def load_runtime_config(explicit_path: str | None = None) -> tuple[dict, Path | None]:
    config = deepcopy(DEFAULT_RUNTIME_CONFIG)

    if explicit_path:
        path = Path(explicit_path).expanduser()
        if not path.exists():
            raise ValueError(f"Runtime config path not found: {path}")
        return _deep_merge(config, _load_json_file(path)), path

    env_path = os.environ.get(RUNTIME_CONFIG_ENV)
    if env_path:
        path = Path(env_path).expanduser()
        if not path.exists():
            raise ValueError(f"Runtime config path not found: {path}")
        return _deep_merge(config, _load_json_file(path)), path

    for path in default_runtime_config_paths():
        if path.exists():
            return _deep_merge(config, _load_json_file(path)), path

    return config, None


def _normalize_args(value: object, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{label} must be a JSON array of strings.")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"{label} must contain only strings.")
        if item:
            result.append(item)
    return result


def _provider_entry(config: dict, provider_name: str | None) -> dict | None:
    if provider_name is None:
        return None
    providers = config.get("providers") or {}
    if not isinstance(providers, dict):
        raise ValueError("Runtime config 'providers' must be an object.")
    entry = providers.get(provider_name)
    if entry is None:
        return None
    if not isinstance(entry, dict):
        raise ValueError(f"Provider profile must be an object: {provider_name}")
    return entry


def _runtime_entry(config: dict, runtime_name: str) -> dict:
    runtimes = config.get("runtimes") or {}
    if not isinstance(runtimes, dict):
        raise ValueError("Runtime config 'runtimes' must be an object.")
    entry = runtimes.get(runtime_name)
    if not isinstance(entry, dict):
        raise ValueError(f"Unknown runtime profile: {runtime_name}")
    return entry


def _referenced_env_vars(value: str) -> list[str]:
    names: list[str] = []
    for match in ENV_PATTERN.finditer(value):
        names.append(match.group(1) or match.group(2))
    return names


def _validate_process_env_templates(process_env: object, provider_name: str) -> dict[str, str]:
    if process_env is None:
        return {}
    if not isinstance(process_env, dict):
        raise ValueError(f"Provider profile process_env must be an object: {provider_name}")

    normalized: dict[str, str] = {}
    for key, raw_value in process_env.items():
        if not isinstance(key, str) or not key:
            raise ValueError(f"Provider profile process_env keys must be non-empty strings: {provider_name}")
        if not isinstance(raw_value, str):
            raise ValueError(f"Provider profile process_env values must be strings: {provider_name}")
        for env_name in _referenced_env_vars(raw_value):
            if env_name not in os.environ:
                raise ValueError(
                    f"Provider profile '{provider_name}' requires env var '{env_name}' for process_env expansion."
                )
        normalized[key] = raw_value
    return normalized


def _expand_template(value: str) -> str:
    def replacer(match: re.Match[str]) -> str:
        env_name = match.group(1) or match.group(2)
        env_value = os.environ.get(env_name)
        if env_value is None:
            raise ValueError(f"Missing env var for runtime profile expansion: {env_name}")
        return env_value

    return ENV_PATTERN.sub(replacer, value)


def resolve_runtime_request(request: dict) -> dict:
    config, config_path = load_runtime_config(_normalize_name(request.get("runtime_config")))
    provider_name = _normalize_name(request.get("provider"))
    provider_entry = _provider_entry(config, provider_name)

    explicit_runtime = _normalize_name(request.get("runtime")) or _normalize_name(os.environ.get(RUNTIME_ENV))
    provider_runtime = _normalize_name((provider_entry or {}).get("runtime"))
    default_runtime = _normalize_name(config.get("default_runtime")) or "claude"

    if explicit_runtime and provider_runtime and explicit_runtime != provider_runtime:
        raise ValueError(
            f"Provider profile '{provider_name}' requires runtime '{provider_runtime}', "
            f"but request selected runtime '{explicit_runtime}'."
        )

    runtime_name = explicit_runtime or provider_runtime or default_runtime
    runtime_entry = _runtime_entry(config, runtime_name)
    runtime_args = _normalize_args(runtime_entry.get("args"), f"Runtime profile args for {runtime_name}")
    runtime_bin = (
        _normalize_name(request.get("runtime_bin"))
        or _normalize_name(request.get("ccc_bin"))
        or _normalize_name(os.environ.get(RUNTIME_BIN_ENV))
        or _normalize_name(os.environ.get(LEGACY_CCC_BIN_ENV))
        or _normalize_name(runtime_entry.get("bin"))
        or runtime_name
    )
    supports_native_provider = bool(runtime_entry.get("supports_native_provider", False))
    supports_settings = bool(runtime_entry.get("supports_settings", True))

    provider_source = "none"
    native_provider: str | None = None
    provider_extra_args: list[str] = []
    process_env_templates: dict[str, str] = {}

    if provider_name is not None:
        if provider_entry is not None:
            native_provider = _normalize_name(provider_entry.get("native_provider"))
            provider_extra_args = _normalize_args(
                provider_entry.get("extra_args"),
                f"Provider profile extra_args for {provider_name}",
            )
            process_env_templates = _validate_process_env_templates(
                provider_entry.get("process_env"),
                provider_name,
            )
            provider_source = "profile"
        elif supports_native_provider:
            native_provider = provider_name
            provider_source = "native_runtime"
        else:
            raise ValueError(
                f"Provider '{provider_name}' is not configured for runtime '{runtime_name}'. "
                "Add a provider profile or choose a runtime that supports native provider routing."
            )

        if native_provider is not None and not supports_native_provider:
            raise ValueError(
                f"Runtime '{runtime_name}' does not support native provider routing, "
                f"but provider '{provider_name}' requests native_provider."
            )

    return {
        "name": runtime_name,
        "bin": runtime_bin,
        "args": runtime_args,
        "supports_native_provider": supports_native_provider,
        "supports_settings": supports_settings,
        "config_path": None if config_path is None else str(config_path),
        "provider_strategy": {
            "name": provider_name,
            "source": provider_source,
            "native_provider": native_provider,
            "extra_args": provider_extra_args,
            "process_env_keys": sorted(process_env_templates.keys()),
        },
    }


def build_process_env(request: dict) -> dict:
    runtime_resolution = request.get("runtime_resolution") or {}
    provider_name = _normalize_name(request.get("provider"))
    config_path = _normalize_name(runtime_resolution.get("config_path"))
    config, _ = load_runtime_config(config_path)
    provider_entry = _provider_entry(config, provider_name)
    process_env = {} if provider_entry is None else _validate_process_env_templates(provider_entry.get("process_env"), provider_name or "")

    env = dict(os.environ)
    for key, template in process_env.items():
        env[key] = _expand_template(template)
    return env
