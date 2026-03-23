from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_MODEL = "opus"
DEFAULT_SYSTEM_PROMPT = "Reply concisely. Execute commands when asked."
TERMINAL_JOB_STATES = {"finished", "failed", "cancelled", "paused"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_text(path: Path, data: str) -> None:
    path.write_text(data)


def write_json(path: Path, data: object) -> None:
    temp_path = path.with_name(f"{path.name}.tmp")
    temp_path.write_text(json.dumps(data, indent=2, sort_keys=True))
    temp_path.replace(path)


def read_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text())


def build_artifacts_dir(root: str) -> Path:
    run_dir = Path(root) / datetime.now().strftime("%Y%m%dT%H%M%S") / str(uuid.uuid4())
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def artifact_paths(artifacts_dir: Path) -> dict[str, Path]:
    return {
        "artifacts_dir": artifacts_dir,
        "events": artifacts_dir / "events.jsonl",
        "handoff": artifacts_dir / "handoff.json",
        "job": artifacts_dir / "job.json",
        "lock": artifacts_dir / "job.lock",
        "normalized": artifacts_dir / "normalized.json",
        "patch": artifacts_dir / "workspace.patch",
        "request": artifacts_dir / "request.json",
        "stderr": artifacts_dir / "stderr.txt",
        "stdout": artifacts_dir / "stdout.jsonl",
    }


def print_json(data: object) -> None:
    print(json.dumps(data, indent=2, sort_keys=True))
