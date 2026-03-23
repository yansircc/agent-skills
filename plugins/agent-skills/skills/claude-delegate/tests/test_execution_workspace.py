"""Regression tests for isolated execution workspaces."""
from __future__ import annotations

import subprocess
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from claude_delegate.contracts import build_delegate_prompt, default_completion_contract
from claude_delegate.execution_workspace import build_execution_task_packet, prepare_execution_workspace
from claude_delegate.patch_artifact import generate_patch
from claude_delegate.verifier import run_verification
from claude_delegate.workspace import capture_workspace_state, diff_workspace_state


def _request(cwd: Path, *, mode: str, role: str = "implementer") -> dict:
    return {
        "assistant_role": role,
        "cwd": str(cwd),
        "task_packet": {
            "goal": "Bounded task.",
            "task_type": "coding",
            "execution_policy": {
                "allow_edits": role == "implementer",
                "allowed_write_paths": [str(cwd)] if role == "implementer" else [],
                "command_allowlist": [],
                "exclude_globs": [],
                "max_budget_usd": None,
                "max_changed_files": None,
                "max_turns": None,
                "observe_roots": [str(cwd)],
                "workspace_mode": mode,
            },
            "verification_contract": {
                "auto": False,
                "commands": [],
                "fail_on_error": True,
            },
        },
    }


def _git(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=True,
    )


def test_copy_workspace_keeps_source_clean_and_maps_patch() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "source"
        source.mkdir()
        source_file = source / "app.py"
        source_file.write_text("print('source')\n")

        request = _request(source, mode="copy")
        workspace = prepare_execution_workspace(request)
        try:
            snapshot_before = capture_workspace_state(
                workspace=workspace,
                observe_roots=[str(source)],
                exclude_roots=[],
                exclude_globs=[],
            )
            execution_file = Path(workspace.execution_cwd) / "app.py"
            execution_file.write_text("print('worker')\n")
            snapshot_after = capture_workspace_state(
                workspace=workspace,
                observe_roots=[str(source)],
                exclude_roots=[],
                exclude_globs=[],
            )
            changes = diff_workspace_state(snapshot_before, snapshot_after, str(source))
            patch = generate_patch(snapshot_before, snapshot_after, str(source))
        finally:
            workspace.cleanup()

        assert source_file.read_text() == "print('source')\n"
        assert workspace.mode == "copy"
        assert changes == [
            {
                "change": "modified",
                "execution_path": str(execution_file.resolve()),
                "path": str(source_file.resolve()),
                "relative_path": "app.py",
            }
        ]
        assert "--- a/app.py" in patch
        assert "+++ b/app.py" in patch
        assert not Path(workspace.execution_root).exists()
        print("PASS  copy workspace isolates edits and preserves source-relative patch paths")


def test_verification_runs_inside_execution_workspace() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "source"
        source.mkdir()
        (source / "marker.txt").write_text("source\n")

        request = _request(source, mode="copy")
        request["task_packet"]["verification_contract"]["commands"] = [
            "python3 -c \"from pathlib import Path; import sys; sys.exit(0 if Path('marker.txt').read_text() == 'worker\\n' else 1)\""
        ]
        workspace = prepare_execution_workspace(request)
        try:
            (Path(workspace.execution_cwd) / "marker.txt").write_text("worker\n")
            result = run_verification(request, {"workspace_changes": []}, execution_cwd=workspace.execution_cwd)
        finally:
            workspace.cleanup()

        assert result["status"] == "passed"
        assert (source / "marker.txt").read_text() == "source\n"
        print("PASS  verification uses execution cwd instead of mutating the source workspace")


def test_execution_prompt_paths_do_not_leak_source_absolutes() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "source"
        source.mkdir()
        (source / "marker.txt").write_text("source\n")

        request = _request(source, mode="copy")
        workspace = prepare_execution_workspace(request)
        try:
            packet = build_execution_task_packet(request["task_packet"], workspace)
            prompt = build_delegate_prompt(
                packet,
                assistant_role="implementer",
                completion_contract=default_completion_contract("implementer"),
            )
        finally:
            workspace.cleanup()

        assert str(source) not in prompt
        assert "- allowed_write_paths: [\".\"]" in prompt
        assert "- observe_roots: [\".\"]" in prompt
        print("PASS  execution prompt uses execution-safe paths instead of source absolutes")


def test_worktree_workspace_isolates_clean_git_repo() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp) / "repo"
        repo.mkdir()
        _git("init", cwd=repo)
        _git("config", "user.email", "test@example.com", cwd=repo)
        _git("config", "user.name", "Test User", cwd=repo)

        source = repo / "src"
        source.mkdir()
        source_file = source / "main.py"
        source_file.write_text("print('source')\n")
        _git("add", ".", cwd=repo)
        _git("commit", "-m", "initial", cwd=repo)

        request = _request(source, mode="worktree")
        workspace = prepare_execution_workspace(request)
        try:
            execution_file = Path(workspace.execution_cwd) / "main.py"
            execution_file.write_text("print('worker')\n")
            execution_file_exists = execution_file.exists()
            worktree_list = _git("worktree", "list", cwd=repo).stdout
        finally:
            workspace.cleanup()

        assert workspace.mode == "worktree"
        assert execution_file_exists is True
        assert source_file.read_text() == "print('source')\n"
        assert workspace.execution_root in worktree_list
        assert not Path(workspace.execution_root).exists()
        print("PASS  worktree workspace isolates a clean git repository")


def test_auto_workspace_uses_copy_for_dirty_git_repo() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp) / "repo"
        repo.mkdir()
        _git("init", cwd=repo)
        _git("config", "user.email", "test@example.com", cwd=repo)
        _git("config", "user.name", "Test User", cwd=repo)
        source_file = repo / "main.py"
        source_file.write_text("print('clean')\n")
        _git("add", ".", cwd=repo)
        _git("commit", "-m", "initial", cwd=repo)
        source_file.write_text("print('dirty')\n")

        workspace = prepare_execution_workspace(_request(repo, mode="auto"))
        try:
            execution_file = Path(workspace.execution_cwd) / "main.py"
            execution_file.write_text("print('worker')\n")
        finally:
            workspace.cleanup()

        assert workspace.mode == "copy"
        assert source_file.read_text() == "print('dirty')\n"
        print("PASS  auto workspace falls back to copy for dirty git state")


def test_explicit_worktree_rejects_dirty_git_repo() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp) / "repo"
        repo.mkdir()
        _git("init", cwd=repo)
        _git("config", "user.email", "test@example.com", cwd=repo)
        _git("config", "user.name", "Test User", cwd=repo)
        source_file = repo / "main.py"
        source_file.write_text("print('clean')\n")
        _git("add", ".", cwd=repo)
        _git("commit", "-m", "initial", cwd=repo)
        source_file.write_text("print('dirty')\n")

        try:
            prepare_execution_workspace(_request(repo, mode="worktree"))
        except ValueError as exc:
            assert "clean git repository" in str(exc)
        else:
            raise AssertionError("Expected workspace_mode=worktree to reject dirty repos")

        print("PASS  explicit worktree mode rejects dirty git state")


def test() -> None:
    test_copy_workspace_keeps_source_clean_and_maps_patch()
    test_verification_runs_inside_execution_workspace()
    test_execution_prompt_paths_do_not_leak_source_absolutes()
    test_worktree_workspace_isolates_clean_git_repo()
    test_auto_workspace_uses_copy_for_dirty_git_repo()
    test_explicit_worktree_rejects_dirty_git_repo()
    print("\nAll execution workspace tests passed.")


if __name__ == "__main__":
    test()
