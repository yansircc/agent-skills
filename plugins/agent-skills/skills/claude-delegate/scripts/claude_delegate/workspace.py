from __future__ import annotations

import hashlib
from pathlib import Path

from .execution_workspace import ExecutionWorkspace


# Maximum file size (in bytes) to include content in snapshot for patch generation
_MAX_CONTENT_SIZE = 1024 * 1024  # 1 MB


def _fingerprint(path: Path) -> dict:
    hasher = hashlib.sha1()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
    stat = path.stat()
    return {
        "mtime_ns": stat.st_mtime_ns,
        "sha1": hasher.hexdigest(),
        "size": stat.st_size,
    }


def _capture_content(path: Path) -> str | None:
    """Capture file content if under size limit. Returns None for binary or too-large files."""
    stat = path.stat()
    if stat.st_size > _MAX_CONTENT_SIZE:
        return None
    try:
        return path.read_text(encoding="utf-8", errors="strict")
    except (UnicodeDecodeError, OSError):
        return None


def has_semantic_change(before_entry: dict | None, after_entry: dict | None) -> bool:
    """Return whether file existence or content changed, ignoring mtime-only churn."""
    if (before_entry is None) != (after_entry is None):
        return True
    if before_entry is None:
        return False
    return (before_entry.get("sha1"), before_entry.get("size")) != (
        after_entry.get("sha1"),
        after_entry.get("size"),
    )


def _should_exclude_path(resolved: Path, excludes: list[Path], exclude_globs: list[str]) -> bool:
    if any(resolved == excluded or excluded in resolved.parents for excluded in excludes):
        return True
    for pattern in exclude_globs:
        if resolved.match(pattern):
            return True
    return False


def capture_workspace_state(
    *,
    workspace: ExecutionWorkspace,
    observe_roots: list[str],
    exclude_roots: list[str],
    exclude_globs: list[str],
) -> dict[str, dict]:
    state: dict[str, dict] = {}
    excludes = [Path(item).resolve() for item in exclude_roots]
    for raw_root in observe_roots:
        source_root = workspace.resolve_source_path(raw_root)
        execution_root = workspace.map_source_to_execution(source_root)
        if not execution_root.exists():
            continue
        candidates = [execution_root] if execution_root.is_file() else sorted(path for path in execution_root.rglob("*") if path.is_file())
        for execution_path in candidates:
            resolved = execution_path.resolve()
            if _should_exclude_path(resolved, excludes, exclude_globs):
                continue
            source_path = workspace.map_execution_to_source(resolved)
            entry = _fingerprint(resolved)
            entry["execution_path"] = str(resolved)
            entry["source_path"] = str(source_path)
            # Include content for patch generation (up to size limit)
            content = _capture_content(resolved)
            if content is not None:
                entry["content"] = content
            state[str(source_path)] = entry
    return state


def diff_workspace_state(before: dict[str, dict], after: dict[str, dict], source_cwd: str) -> list[dict]:
    changes: list[dict] = []
    all_paths = sorted(set(before) | set(after))
    cwd_path = Path(source_cwd).resolve()

    for path_str in all_paths:
        before_entry = before.get(path_str)
        after_entry = after.get(path_str)
        if not has_semantic_change(before_entry, after_entry):
            continue
        path = Path(path_str)
        try:
            relative = str(path.relative_to(cwd_path))
        except ValueError:
            relative = path_str

        if before_entry is None:
            change = "added"
        elif after_entry is None:
            change = "deleted"
        else:
            change = "modified"

        execution_path = (after_entry or before_entry or {}).get("execution_path")
        changes.append(
            {
                "change": change,
                "path": path_str,
                "execution_path": execution_path,
                "relative_path": relative,
            }
        )

    return changes
