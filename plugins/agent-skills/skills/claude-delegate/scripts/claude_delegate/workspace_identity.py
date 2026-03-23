from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


def git_repo_root(cwd: str) -> str | None:
    process = subprocess.run(
        ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        return None
    root = process.stdout.strip()
    return str(Path(root).resolve()) if root else None


def git_repo_is_clean(repo_root: str) -> bool:
    process = subprocess.run(
        ["git", "-C", repo_root, "status", "--porcelain=v1", "--untracked-files=normal"],
        capture_output=True,
        text=True,
        check=False,
    )
    return process.returncode == 0 and not process.stdout.strip()


def normalize_scope_paths(raw_paths: object, cwd: str) -> list[str]:
    if not isinstance(raw_paths, list):
        return []

    result: list[str] = []
    seen: set[str] = set()
    base = Path(cwd).resolve()

    for raw_path in raw_paths:
        if not isinstance(raw_path, str) or not raw_path.strip():
            continue
        path = Path(raw_path)
        if not path.is_absolute():
            path = base / path
        resolved = str(path.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        result.append(resolved)

    return result


def build_workspace_identity(*, cwd: str, execution_policy: dict | None) -> dict:
    source_cwd = str(Path(cwd).resolve())
    source_repo_root = git_repo_root(source_cwd)
    source_root = source_repo_root or source_cwd
    policy = execution_policy or {}

    workspace_mode = policy.get("workspace_mode")
    workspace_mode = str(workspace_mode).strip().lower() if workspace_mode is not None else None
    observe_roots = normalize_scope_paths(policy.get("observe_roots"), source_cwd)
    allowed_write_paths = normalize_scope_paths(policy.get("allowed_write_paths"), source_cwd)

    material = {
        "allowed_write_paths": allowed_write_paths,
        "cwd": source_cwd,
        "observe_roots": observe_roots,
        "source_root": source_root,
        "workspace_mode": workspace_mode,
    }
    workspace_id = hashlib.sha256(
        json.dumps(material, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:16]

    return {
        "workspace_id": workspace_id,
        "cwd": source_cwd,
        "source_root": source_root,
        "source_repo_root": source_repo_root,
        "repo_is_clean": git_repo_is_clean(source_repo_root) if source_repo_root is not None else None,
        "workspace_mode": workspace_mode,
        "observe_roots": observe_roots,
        "allowed_write_paths": allowed_write_paths,
    }
