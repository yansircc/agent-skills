from __future__ import annotations

import fcntl
import gzip
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .common import TERMINAL_JOB_STATES, artifact_paths, read_json, utc_now, write_json
from .ledger import collect_summaries, parse_timestamp


COMPACTABLE_JOB_FIELDS = ("events_path", "stdout_path", "stderr_path")


def _gzip_path(path: Path) -> Path:
    gz_path = path.with_name(f"{path.name}.gz")
    with path.open("rb") as src, gzip.open(gz_path, "wb") as dst:
        shutil.copyfileobj(src, dst)
    path.unlink()
    return gz_path


def _preserved_artifacts(paths: dict[str, Path]) -> dict[str, str]:
    return {
        "request_path": str(paths["request"]),
        "job_metadata_path": str(paths["job"]),
        "normalized_path": str(paths["normalized"]),
        "handoff_path": str(paths["handoff"]),
        "patch_path": str(paths["patch"]),
    }


def compact_job_artifacts(job_path: str | Path) -> dict:
    artifacts_dir = Path(job_path)
    paths = artifact_paths(artifacts_dir)
    job_lock = paths["lock"]
    if not job_lock.exists():
        return {
            "ok": False,
            "error_type": "missing_job_state",
            "error_message": "job lock file does not exist",
            "job_path": str(artifacts_dir),
        }

    with job_lock.open("r+") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)

        job = read_json(paths["job"]) or {}
        if job.get("state") not in TERMINAL_JOB_STATES:
            return {
                "ok": False,
                "error_type": "non_terminal_job",
                "error_message": "job is not terminal",
                "job_path": str(artifacts_dir),
            }

        updated_paths: dict[str, str] = {}
        compacted_fields: list[str] = []

        for field in COMPACTABLE_JOB_FIELDS:
            raw_path = job.get(field)
            if not raw_path:
                continue
            current_path = Path(raw_path)
            if current_path.suffix == ".gz" or not current_path.exists():
                continue
            gz_path = _gzip_path(current_path)
            updated_paths[field] = str(gz_path)
            compacted_fields.append(field)

        if not compacted_fields:
            metadata = job.get("artifact_lifecycle") or {}
            if metadata:
                return {
                    "ok": True,
                    "job_path": str(artifacts_dir),
                    "status": metadata.get("status", "unchanged"),
                    "compacted_fields": metadata.get("compacted_fields", []),
                }
            return {
                "ok": True,
                "job_path": str(artifacts_dir),
                "status": "unchanged",
                "compacted_fields": [],
            }

        metadata = {
            "status": "compacted",
            "compacted_at": utc_now(),
            "compacted_fields": compacted_fields,
            "compacted_paths": updated_paths,
            "preserved_artifacts": _preserved_artifacts(paths),
        }

        job.update(updated_paths)
        job["artifact_lifecycle"] = metadata
        job["updated_at"] = metadata["compacted_at"]
        write_json(paths["job"], job)

        return {
            "ok": True,
            "job_path": str(artifacts_dir),
            "status": "compacted",
            "compacted_fields": compacted_fields,
            "compacted_paths": updated_paths,
        }


def compact_terminal_jobs(
    artifacts_root: str | Path,
    *,
    older_than_hours: float,
) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=older_than_hours)
    items, _ = collect_summaries(
        artifacts_root,
        limit=None,
        session_id=None,
        state=None,
    )

    results: list[dict] = []
    for item in items:
        finished_at = parse_timestamp(item.get("finished_at"))
        if item.get("state") not in TERMINAL_JOB_STATES:
            continue
        if finished_at is None or finished_at > cutoff:
            continue
        results.append(compact_job_artifacts(item["job_path"]))

    compacted = [item for item in results if item.get("status") == "compacted"]
    return {
        "ok": True,
        "count": len(results),
        "compacted_count": len(compacted),
        "items": results,
        "cutoff": cutoff.isoformat(),
    }
