from __future__ import annotations

import copy
import uuid
from pathlib import Path

from .common import artifact_paths, read_json
from .request import finalize_request


def read_parent_request(job_path: str | Path) -> dict:
    paths = artifact_paths(Path(job_path))
    request = read_json(paths["request"])
    if request is None:
        raise ValueError(f"Missing request.json for job: {job_path}")
    return request


def derive_request_from_job(
    job_path: str | Path,
    *,
    action: str,
    delta_prompt: str | None,
) -> dict:
    parent_request = read_parent_request(job_path)
    derived = copy.deepcopy(parent_request)
    parent_session_id = parent_request["session_id"]

    derived["lineage"] = {
        "action": action,
        "parent_job_path": str(job_path),
        "parent_session_id": parent_session_id,
    }
    derived["delta_prompt"] = delta_prompt

    derived.pop("command", None)
    derived.pop("created_at", None)
    derived.pop("prompt", None)
    derived.pop("system_prompt", None)
    derived["skip_ledger"] = False

    if action == "resume":
        derived["resume_session_id"] = parent_session_id
        derived["session_id"] = parent_session_id
    elif action in {"fork", "retry"}:
        derived["resume_session_id"] = None
        derived["session_id"] = str(uuid.uuid4())
    else:
        raise ValueError(f"Unsupported lineage action: {action}")

    return finalize_request(derived)
