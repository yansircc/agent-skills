from __future__ import annotations

from pathlib import Path

from .common import read_json
from .prompt_context import compact_parent_handoff, render_structured_item


def shape_handoff(envelope: dict) -> dict:
    """
    Shape a compact handoff artifact from a completed delegate envelope.
    
    Handoff is durable cross-job context that is not session-dependent.
    It summarizes the normalized envelope without duplicating it, storing only
    what derived lineage jobs need to know about their parent.
    
    Invariant: handoff.json is the durable summarized context artifact, not a duplicate of operator_notes.
    """
    completion = envelope.get("completion", {})
    
    return {
        "ok": envelope.get("ok", False),
        "error_type": envelope.get("error_type"),
        "error_message": envelope.get("error_message"),
        "summary": completion.get("summary") or envelope.get("result") or "",
        "findings": envelope.get("findings", []),
        "open_risks": envelope.get("open_risks", []),
        "changed_files": envelope.get("changed_files", []),
        "diff_summary": envelope.get("diff_summary", []),
        "files_examined": envelope.get("files_examined", []),
        "test_commands": envelope.get("test_commands", []),
        "suggested_actions": envelope.get("suggested_actions", []),
        "task_packet_summary": envelope.get("task_packet_summary", {}),
        "execution_summary": {
            "duration_ms": envelope.get("duration_ms"),
            "num_turns": envelope.get("num_turns"),
            "total_cost_usd": envelope.get("total_cost_usd"),
        },
        "boundary_status": (envelope.get("boundary") or {}).get("status"),
        "verification_status": (envelope.get("verification") or {}).get("status"),
        "assistant_role": envelope.get("assistant_role"),
    }


def load_parent_handoff(job_path: str | Path) -> dict | None:
    """
    Load the parent handoff.json for a job.
    Returns None if the parent handoff does not exist.
    """
    from .common import artifact_paths
    
    paths = artifact_paths(Path(job_path))
    handoff_path = paths.get("handoff")
    if handoff_path is None or not handoff_path.exists():
        return None
    return read_json(handoff_path)


def render_parent_handoff(parent_handoff: dict | None) -> list[str]:
    if not parent_handoff:
        return []
    return render_structured_item(
        "Parent handoff:",
        compact_parent_handoff(parent_handoff),
    )
