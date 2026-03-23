from __future__ import annotations

import shlex
import subprocess
from pathlib import Path


def normalize_completion_fields(request: dict, envelope: dict, workspace_changes: list[dict]) -> dict:
    completion = envelope.get("structured_output") or {}
    envelope["assistant_role"] = request["assistant_role"]
    envelope["task_type"] = request["task_packet"]["task_type"]
    envelope["completion_contract"] = {
        "name": request["completion_contract"]["name"],
        "role": request["completion_contract"]["role"],
    }
    envelope["completion"] = completion
    envelope["workflow_roles"] = request.get("workflow_roles", [request["assistant_role"]])
    envelope["lineage"] = request.get("lineage")
    envelope["workspace_changes"] = workspace_changes
    envelope["changed_files"] = [item["relative_path"] for item in workspace_changes]
    envelope["declared_changed_files"] = completion.get("changed_files", [])
    envelope["diff_summary"] = completion.get("diff_summary", [])
    envelope["open_risks"] = completion.get("open_risks", [])
    envelope["test_commands"] = completion.get("test_commands", [])
    envelope["findings"] = completion.get("findings", [])
    envelope["files_examined"] = completion.get("files_examined", [])
    envelope["suggested_actions"] = completion.get("suggested_actions", [])
    return envelope


def _within_allowed(path: str, allowed: list[str], cwd: str) -> bool:
    file_path = Path(path).resolve()
    for allowed_path in allowed:
        resolved = Path(allowed_path)
        if not resolved.is_absolute():
            resolved = Path(cwd) / resolved
        resolved = resolved.resolve()
        if file_path == resolved or resolved in file_path.parents:
            return True
    return False


def evaluate_execution_policy(request: dict, envelope: dict) -> dict:
    policy = request["task_packet"]["execution_policy"]
    violations: list[dict] = []
    changes = envelope.get("workspace_changes", [])
    role = request["assistant_role"]

    if not policy.get("allow_edits", False) and changes:
        violations.append(
            {
                "kind": "unexpected_edits",
                "message": f"{role} is not allowed to edit files",
            }
        )

    allowed_write_paths = policy.get("allowed_write_paths", [])
    if allowed_write_paths:
        for item in changes:
            if not _within_allowed(item["path"], allowed_write_paths, request["cwd"]):
                violations.append(
                    {
                        "kind": "write_scope_violation",
                        "message": f"Changed file outside allowed write paths: {item['relative_path']}",
                        "path": item["path"],
                    }
                )

    max_changed_files = policy.get("max_changed_files")
    if isinstance(max_changed_files, int) and len(changes) > max_changed_files:
        violations.append(
            {
                "kind": "max_changed_files_exceeded",
                "message": f"Changed {len(changes)} files, limit is {max_changed_files}",
            }
        )

    max_turns = policy.get("max_turns")
    if isinstance(max_turns, int) and isinstance(envelope.get("num_turns"), int) and envelope["num_turns"] > max_turns:
        violations.append(
            {
                "kind": "max_turns_exceeded",
                "message": f"Used {envelope['num_turns']} turns, limit is {max_turns}",
            }
        )

    max_budget = policy.get("max_budget_usd")
    if isinstance(max_budget, (int, float)) and isinstance(envelope.get("total_cost_usd"), (int, float)):
        if float(envelope["total_cost_usd"]) > float(max_budget):
            violations.append(
                {
                    "kind": "max_budget_exceeded",
                    "message": f"Spent {envelope['total_cost_usd']}, limit is {max_budget}",
                }
            )

    allowlist = policy.get("command_allowlist", [])
    if allowlist:
        for tool_use in envelope.get("tool_uses", []):
            if tool_use.get("name") != "Bash":
                continue
            command = (tool_use.get("input") or {}).get("command", "")
            if not any(command == prefix or command.startswith(f"{prefix} ") for prefix in allowlist):
                violations.append(
                    {
                        "kind": "command_allowlist_violation",
                        "message": f"Command outside allowlist: {command}",
                    }
                )

    status = "passed" if not violations else "violated"
    return {
        "status": status,
        "violations": violations,
    }


def derive_verification_commands(request: dict, envelope: dict) -> list[str]:
    verification_contract = request["task_packet"]["verification_contract"]
    commands = list(verification_contract.get("commands", []))

    if not commands and verification_contract.get("auto", False):
        changed_files = [item["relative_path"] for item in envelope.get("workspace_changes", [])]
        python_files = [item for item in changed_files if item.endswith(".py")]
        if python_files:
            quoted = " ".join(shlex.quote(item) for item in python_files)
            commands.append(f"python3 -m py_compile {quoted}")

    deduped: list[str] = []
    seen: set[str] = set()
    for command in commands:
        if command in seen:
            continue
        seen.add(command)
        deduped.append(command)
    return deduped


def run_verification(request: dict, envelope: dict, *, execution_cwd: str | None = None) -> dict:
    verification_contract = request["task_packet"]["verification_contract"]
    commands = derive_verification_commands(request, envelope)
    if not commands:
        return {
            "status": "skipped",
            "fail_on_error": verification_contract.get("fail_on_error", False),
            "commands": [],
            "results": [],
        }

    results: list[dict] = []
    failed = False
    for command in commands:
        process = subprocess.run(
            ["/bin/zsh", "-lc", command],
            cwd=execution_cwd or request["cwd"],
            capture_output=True,
            text=True,
            check=False,
        )
        failed = failed or process.returncode != 0
        results.append(
            {
                "command": command,
                "exit_code": process.returncode,
                "ok": process.returncode == 0,
                "stdout": process.stdout,
                "stderr": process.stderr,
            }
        )

    return {
        "status": "failed" if failed else "passed",
        "fail_on_error": verification_contract.get("fail_on_error", False),
        "commands": commands,
        "results": results,
    }
