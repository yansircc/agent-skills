from __future__ import annotations

from pathlib import Path
from typing import Callable

from .common import artifact_paths, write_json
from .contracts import build_delegate_prompt
from .delegate import DelegateRuntime
from .execution_workspace import build_execution_task_packet, prepare_execution_workspace
from .patch_artifact import generate_patch, write_patch_artifact
from .request import build_command_from_request
from .transport import summarize_tool_uses
from .verifier import evaluate_execution_policy, normalize_completion_fields, run_verification
from .workspace import capture_workspace_state, diff_workspace_state


def _should_capture_workspace(request: dict) -> bool:
    policy = request["task_packet"]["execution_policy"]
    observe_roots = policy.get("observe_roots") or []
    return (
        request["assistant_role"] == "implementer"
        or bool(policy.get("allowed_write_paths"))
        or policy.get("max_changed_files") is not None
        or bool(observe_roots)
    )


def _load_parent_handoff(request: dict) -> dict | None:
    lineage = request.get("lineage") or {}
    parent_job_path = lineage.get("parent_job_path")
    if not parent_job_path:
        return None
    from .handoff import load_parent_handoff

    return load_parent_handoff(parent_job_path)


def _request_for_execution(request: dict, workspace) -> dict:
    updated = dict(request)
    updated["execution_workspace"] = workspace.to_dict()
    updated["task_packet"] = build_execution_task_packet(request["task_packet"], workspace)
    updated["prompt"] = build_delegate_prompt(
        updated["task_packet"],
        assistant_role=request["assistant_role"],
        completion_contract=request["completion_contract"],
        delta_prompt=request.get("delta_prompt") or ((request.get("lineage") or {}).get("delta_prompt")),
        parent_handoff=_load_parent_handoff(request),
    )
    updated["command"] = build_command_from_request(updated)
    return updated


def execute_request_pipeline(
    request: dict,
    artifacts_dir: Path,
    *,
    on_spawn: Callable[[int], None] | None = None,
    on_event: Callable[[dict, int], None] | None = None,
) -> dict:
    paths = artifact_paths(artifacts_dir)
    policy = request["task_packet"]["execution_policy"]
    observe_roots = policy.get("observe_roots") or (
        [request["cwd"]] if request["assistant_role"] == "implementer" else []
    )
    exclude_globs = policy.get("exclude_globs") or []
    workspace = prepare_execution_workspace(request)
    request_for_execution = _request_for_execution(request, workspace)

    snapshot_before = None
    envelope: dict | None = None

    try:
        if _should_capture_workspace(request):
            snapshot_before = capture_workspace_state(
                workspace=workspace,
                observe_roots=observe_roots,
                exclude_roots=[str(paths["artifacts_dir"])],
                exclude_globs=exclude_globs,
            )

        runtime = DelegateRuntime(
            request_for_execution,
            artifacts_dir,
            on_spawn=on_spawn,
            on_event=on_event,
        )
        envelope = runtime.execute()

        workspace_changes: list[dict] = []
        if snapshot_before is not None:
            snapshot_after = capture_workspace_state(
                workspace=workspace,
                observe_roots=observe_roots,
                exclude_roots=[str(paths["artifacts_dir"])],
                exclude_globs=exclude_globs,
            )
            workspace_changes = diff_workspace_state(snapshot_before, snapshot_after, request["cwd"])

            # Generate and persist unified diff patch
            patch_content = generate_patch(snapshot_before, snapshot_after, request["cwd"])
            write_patch_artifact(patch_content, paths["patch"])

        envelope = normalize_completion_fields(request, envelope, workspace_changes)
        envelope["task_packet_summary"] = {
            "goal": request["task_packet"]["goal"],
            "task_type": request["task_packet"]["task_type"],
        }

        boundary = evaluate_execution_policy(request, envelope)
        envelope["boundary"] = boundary

        verification = run_verification(
            request,
            envelope,
            execution_cwd=workspace.execution_cwd,
        )
        envelope["verification"] = verification

        if boundary["status"] == "violated":
            envelope["ok"] = False
            envelope["error_type"] = envelope["error_type"] or "boundary_violation"
            envelope["error_message"] = envelope["error_message"] or "; ".join(item["message"] for item in boundary["violations"])

        if verification["status"] == "failed" and verification["fail_on_error"]:
            envelope["ok"] = False
            envelope["error_type"] = envelope["error_type"] or "verification_failed"
            if envelope.get("error_message") is None:
                envelope["error_message"] = "verification commands failed"

        raw_tool_uses = envelope.get("tool_uses", [])
        envelope["tool_use_count"] = len(raw_tool_uses)
        envelope["tool_uses"] = summarize_tool_uses(raw_tool_uses)
    finally:
        workspace.cleanup()

    assert envelope is not None
    envelope["execution_workspace"] = workspace.to_dict()
    write_json(paths["normalized"], envelope)

    # Write durable handoff artifact for cross-job context transfer
    from .handoff import shape_handoff
    handoff = shape_handoff(envelope)
    write_json(paths["handoff"], handoff)

    return envelope
