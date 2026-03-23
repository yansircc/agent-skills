"""Generate unified diff patches from workspace snapshots without requiring git."""

from __future__ import annotations

import difflib
from pathlib import Path

from .workspace import has_semantic_change


def _unified_diff(
    path_str: str,
    before_content: str,
    after_content: str,
) -> list[str]:
    """Generate unified diff lines for a file change."""
    before_lines = before_content.splitlines(keepends=True)
    after_lines = after_content.splitlines(keepends=True)
    diff_lines = list(
        difflib.unified_diff(
            before_lines,
            after_lines,
            fromfile=f"a/{path_str}",
            tofile=f"b/{path_str}",
            lineterm="",
        )
    )

    # unified_diff returns a generator; ensure lines end properly
    result = []
    for line in diff_lines:
        if line.endswith("\n"):
            result.append(line)
        else:
            result.append(line + "\n")
    return result


def generate_patch(
    snapshot_before: dict[str, dict],
    snapshot_after: dict[str, dict],
    cwd: str,
) -> str:
    """
    Generate a unified diff patch from before/after workspace snapshots.
    Works without git by using file content stored in snapshots.
    Skips files that don't have content captured (binary or too large).
    """
    patch_lines: list[str] = []
    all_paths = sorted(set(snapshot_before.keys()) | set(snapshot_after.keys()))
    cwd_path = Path(cwd).resolve()

    for path_str in all_paths:
        before_entry = snapshot_before.get(path_str)
        after_entry = snapshot_after.get(path_str)

        if not has_semantic_change(before_entry, after_entry):
            continue

        # Compute relative path for display
        path = Path(path_str)
        try:
            relative = str(path.relative_to(cwd_path))
        except ValueError:
            relative = path_str

        # Get content from snapshots (may be None for binary/large files)
        before_content = before_entry.get("content") if before_entry else None
        after_content = after_entry.get("content") if after_entry else None

        if before_content is None and after_content is None:
            # Both binary/large - skip patch generation for this file
            # but note it in patch header
            if before_entry and not after_entry:
                patch_lines.append(f"--- a/{relative}\n")
                patch_lines.append("+++ /dev/null\n")
                patch_lines.append("Binary file deleted (content not captured)\n")
            elif after_entry and not before_entry:
                patch_lines.append(f"--- /dev/null\n")
                patch_lines.append(f"+++ b/{relative}\n")
                patch_lines.append("Binary file added (content not captured)\n")
            else:
                patch_lines.append(f"--- a/{relative}\n")
                patch_lines.append(f"+++ b/{relative}\n")
                patch_lines.append("Binary file modified (content not captured)\n")
            continue

        # File was deleted
        if before_entry is not None and after_entry is None:
            if before_content is not None:
                patch_lines.extend(_unified_diff(relative, before_content, ""))
            else:
                patch_lines.append(f"--- a/{relative}\n")
                patch_lines.append("+++ /dev/null\n")
                patch_lines.append("Binary file deleted\n")
            continue
        
        # File was added
        if before_entry is None and after_entry is not None:
            if after_content is not None:
                patch_lines.extend(_unified_diff(relative, "", after_content))
            else:
                patch_lines.append(f"--- /dev/null\n")
                patch_lines.append(f"+++ b/{relative}\n")
                patch_lines.append("Binary file added\n")
            continue

        # File was modified
        if before_entry is not None and after_entry is not None:
            if before_content is not None and after_content is not None:
                patch_lines.extend(_unified_diff(relative, before_content, after_content))
            else:
                # Binary or large file - note the change but don't show diff
                before_size = before_entry.get("size", "?")
                after_size = after_entry.get("size", "?")
                patch_lines.append(f"--- a/{relative}\n")
                patch_lines.append(f"+++ b/{relative}\n")
                patch_lines.append(f"Binary file modified ({before_size} -> {after_size} bytes)\n")

    return "".join(patch_lines)


def write_patch_artifact(patch_content: str, patch_path: Path) -> None:
    """Write patch content to file atomically."""
    temp_path = patch_path.with_name(f"{patch_path.name}.tmp")
    temp_path.write_text(patch_content)
    temp_path.replace(patch_path)
