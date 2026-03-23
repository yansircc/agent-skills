from __future__ import annotations

import shutil
import subprocess
import tempfile
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path

from .workspace_identity import git_repo_is_clean, git_repo_root


SUPPORTED_WORKSPACE_MODES = {"auto", "shared", "copy", "worktree"}


def _copytree(source_root: Path, destination_root: Path) -> None:
    shutil.copytree(source_root, destination_root, symlinks=True)


@dataclass
class ExecutionWorkspace:
    requested_mode: str
    mode: str
    source_cwd: str
    source_root: str
    execution_cwd: str
    execution_root: str
    source_repo_root: str | None
    cleanup_root: str | None
    cleaned_up: bool = False
    cleanup_error: str | None = None

    def resolve_source_path(self, raw_path: str) -> Path:
        path = Path(raw_path)
        if not path.is_absolute():
            path = Path(self.source_cwd) / path
        return path.resolve()

    def map_source_to_execution(self, source_path: str | Path) -> Path:
        resolved = Path(source_path).resolve()
        source_root = Path(self.source_root).resolve()
        if resolved != source_root and source_root not in resolved.parents:
            raise ValueError(f"Path is outside execution workspace source root: {resolved}")
        return Path(self.execution_root).resolve() / resolved.relative_to(source_root)

    def map_execution_to_source(self, execution_path: str | Path) -> Path:
        resolved = Path(execution_path).resolve()
        execution_root = Path(self.execution_root).resolve()
        if resolved != execution_root and execution_root not in resolved.parents:
            raise ValueError(f"Path is outside execution workspace root: {resolved}")
        return Path(self.source_root).resolve() / resolved.relative_to(execution_root)

    def display_path(self, raw_path: str) -> str:
        execution_path = self.map_source_to_execution(self.resolve_source_path(raw_path))
        execution_cwd = Path(self.execution_cwd).resolve()
        if execution_path == execution_cwd:
            return "."
        try:
            return str(execution_path.relative_to(execution_cwd))
        except ValueError:
            return str(execution_path)

    def cleanup(self) -> None:
        if self.cleanup_root is None or self.cleaned_up:
            return

        cleanup_root = Path(self.cleanup_root)
        try:
            if self.mode == "worktree":
                subprocess.run(
                    ["git", "-C", self.source_repo_root or self.source_root, "worktree", "remove", "--force", str(cleanup_root)],
                    capture_output=True,
                    text=True,
                    check=True,
                )
            else:
                shutil.rmtree(cleanup_root)
            self.cleaned_up = True
        except Exception as exc:
            self.cleanup_error = str(exc)

    def to_dict(self) -> dict:
        return {
            "requested_mode": self.requested_mode,
            "mode": self.mode,
            "source_cwd": self.source_cwd,
            "source_root": self.source_root,
            "execution_cwd": self.execution_cwd,
            "execution_root": self.execution_root,
            "source_repo_root": self.source_repo_root,
            "cleanup_root": self.cleanup_root,
            "cleaned_up": self.cleaned_up,
            "cleanup_error": self.cleanup_error,
        }


def _requested_workspace_mode(request: dict) -> str:
    raw_mode = ((request.get("task_packet") or {}).get("execution_policy") or {}).get("workspace_mode")
    if raw_mode is None:
        return "auto" if request.get("assistant_role") == "implementer" else "shared"

    mode = str(raw_mode).strip().lower()
    if mode not in SUPPORTED_WORKSPACE_MODES:
        raise ValueError(f"Unsupported workspace_mode: {raw_mode}")
    return mode


def _shared_workspace(source_cwd: str, source_root: str, requested_mode: str, repo_root: str | None) -> ExecutionWorkspace:
    return ExecutionWorkspace(
        requested_mode=requested_mode,
        mode="shared",
        source_cwd=source_cwd,
        source_root=source_root,
        execution_cwd=source_cwd,
        execution_root=source_root,
        source_repo_root=repo_root,
        cleanup_root=None,
    )


def _copy_workspace(
    *,
    source_cwd: str,
    source_root: str,
    requested_mode: str,
    repo_root: str | None,
) -> ExecutionWorkspace:
    copy_root = Path(tempfile.mkdtemp(prefix="claude-delegate-copy-")).resolve()
    copy_root.rmdir()
    _copytree(Path(source_root), copy_root)
    execution_cwd = copy_root / Path(source_cwd).resolve().relative_to(Path(source_root).resolve())
    return ExecutionWorkspace(
        requested_mode=requested_mode,
        mode="copy",
        source_cwd=source_cwd,
        source_root=source_root,
        execution_cwd=str(execution_cwd),
        execution_root=str(copy_root),
        source_repo_root=repo_root,
        cleanup_root=str(copy_root),
    )


def _worktree_workspace(
    *,
    source_cwd: str,
    repo_root: str,
    requested_mode: str,
) -> ExecutionWorkspace:
    worktree_root = Path(tempfile.mkdtemp(prefix="claude-delegate-worktree-")).resolve()
    subprocess.run(
        ["git", "-C", repo_root, "worktree", "add", "--detach", str(worktree_root), "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    )
    execution_cwd = worktree_root / Path(source_cwd).resolve().relative_to(Path(repo_root).resolve())
    return ExecutionWorkspace(
        requested_mode=requested_mode,
        mode="worktree",
        source_cwd=source_cwd,
        source_root=repo_root,
        execution_cwd=str(execution_cwd),
        execution_root=str(worktree_root),
        source_repo_root=repo_root,
        cleanup_root=str(worktree_root),
    )


def prepare_execution_workspace(request: dict) -> ExecutionWorkspace:
    source_cwd = str(Path(request["cwd"]).resolve())
    repo_root = git_repo_root(source_cwd)
    source_root = repo_root or source_cwd
    requested_mode = _requested_workspace_mode(request)

    if requested_mode == "shared":
        return _shared_workspace(source_cwd, source_root, requested_mode, repo_root)

    if requested_mode == "copy":
        return _copy_workspace(
            source_cwd=source_cwd,
            source_root=source_root,
            requested_mode=requested_mode,
            repo_root=repo_root,
        )

    if requested_mode == "worktree":
        if repo_root is None:
            raise ValueError("workspace_mode=worktree requires a git repository.")
        if not git_repo_is_clean(repo_root):
            raise ValueError(
                "workspace_mode=worktree requires a clean git repository; "
                "dirty and untracked state are not yet seeded into worktrees."
            )
        return _worktree_workspace(
            source_cwd=source_cwd,
            repo_root=repo_root,
            requested_mode=requested_mode,
        )

    if request.get("assistant_role") != "implementer":
        return _shared_workspace(source_cwd, source_root, requested_mode, repo_root)

    if repo_root is not None and git_repo_is_clean(repo_root):
        return _worktree_workspace(
            source_cwd=source_cwd,
            repo_root=repo_root,
            requested_mode=requested_mode,
        )

    return _copy_workspace(
        source_cwd=source_cwd,
        source_root=source_root,
        requested_mode=requested_mode,
        repo_root=repo_root,
    )


def build_execution_task_packet(task_packet: dict, workspace: ExecutionWorkspace) -> dict:
    packet = deepcopy(task_packet)
    policy = deepcopy(packet.get("execution_policy") or {})
    for key in ("allowed_write_paths", "observe_roots"):
        if key in policy:
            policy[key] = [workspace.display_path(item) for item in policy.get(key, [])]
    packet["execution_policy"] = policy
    return packet
