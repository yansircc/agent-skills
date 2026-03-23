from __future__ import annotations

import argparse
import gzip
import json
import mimetypes
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .common import artifact_paths, read_json
from .jobs import render_job_view
from .ledger import list_ledger, list_sessions


def _ui_dist_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "ui" / "dist"


def _is_within(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as handle:
        return [line.rstrip("\n") for line in handle]


def _stream_page(
    lines: list[str], *, cursor: int | None, limit: int, formatter
) -> dict[str, Any]:
    """Return a page of *lines* with cursor bookkeeping.

    When *cursor* is ``None`` the caller is asking for a **tail** view:
    return the last *limit* lines so the UI shows recent activity on
    first open.  When *cursor* is an explicit integer, return the
    incremental page starting at that position.
    """
    total = len(lines)

    if cursor is None:
        # Tail mode – return the last page.
        start = max(0, total - limit)
        end = total
        return {
            "items": formatter(lines[start:end]),
            "cursor": start,
            "next_cursor": end,
            "total_lines": total,
            "has_more": False,
            "reset": False,
        }

    # Incremental mode.
    reset = cursor > total
    if reset:
        cursor = 0
    end = min(cursor + limit, total)
    return {
        "items": formatter(lines[cursor:end]),
        "cursor": cursor,
        "next_cursor": end,
        "total_lines": total,
        "has_more": end < total,
        "reset": reset,
    }


def _fmt_raw(lines: list[str]) -> list[dict[str, Any]]:
    return [{"raw": line} for line in lines]


def _parse_jsonl(lines: list[str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for raw in lines:
        parsed = None
        if raw:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = None
        items.append({"raw": raw, "parsed": parsed})
    return items


class ProgressUiApp:
    def __init__(
        self,
        artifacts_root: str | Path,
        *,
        dist_dir: str | Path | None = None,
        serve_static: bool = True,
    ):
        self.artifacts_root = Path(artifacts_root).resolve()
        self.dist_dir = None
        if serve_static:
            self.dist_dir = Path(dist_dir).resolve() if dist_dir is not None else _ui_dist_dir()

    def overview(self, limit: int) -> dict[str, Any]:
        sessions = list_sessions(self.artifacts_root, limit=limit)
        recent_jobs = list_ledger(
            self.artifacts_root,
            limit=limit,
            session_id=None,
            provider=None,
            state=None,
        )
        running_jobs = list_ledger(
            self.artifacts_root,
            limit=limit,
            session_id=None,
            provider=None,
            state="running",
        )
        return {
            "ok": True,
            "artifacts_root": str(self.artifacts_root),
            "sessions": sessions.get("items", []),
            "recent_jobs": recent_jobs.get("items", []),
            "running_jobs": running_jobs.get("items", []),
        }

    def job(self, job_path: str) -> dict[str, Any]:
        resolved = Path(job_path).resolve()
        if not _is_within(self.artifacts_root, resolved):
            return {
                "ok": False,
                "error_type": "path_error",
                "error_message": "job_path is outside artifacts_root",
            }
        return render_job_view(str(resolved))

    def job_output(
        self,
        job_path: str,
        limit: int,
        *,
        events_cursor: int | None = None,
        stdout_cursor: int | None = None,
        stderr_cursor: int | None = None,
    ) -> dict[str, Any]:
        resolved = Path(job_path).resolve()
        if not _is_within(self.artifacts_root, resolved):
            return {
                "ok": False,
                "error_type": "path_error",
                "error_message": "job_path is outside artifacts_root",
            }

        paths = artifact_paths(resolved)
        job = read_json(paths["job"]) or {}
        events_path = Path(job.get("events_path") or paths["events"])
        stdout_path = Path(job.get("stdout_path") or paths["stdout"])
        stderr_path = Path(job.get("stderr_path") or paths["stderr"])

        return {
            "ok": True,
            "job_path": str(resolved),
            "job_state": job.get("state"),
            "paths": {
                "events_path": str(events_path),
                "stdout_path": str(stdout_path),
                "stderr_path": str(stderr_path),
            },
            "events": _stream_page(
                _read_lines(events_path), cursor=events_cursor, limit=limit, formatter=_parse_jsonl,
            ),
            "stdout": _stream_page(
                _read_lines(stdout_path), cursor=stdout_cursor, limit=limit, formatter=_parse_jsonl,
            ),
            "stderr": _stream_page(
                _read_lines(stderr_path), cursor=stderr_cursor, limit=limit, formatter=_fmt_raw,
            ),
        }


class ProgressUiHandler(SimpleHTTPRequestHandler):
    app: ProgressUiApp

    def translate_path(self, path: str) -> str:
        if self.app.dist_dir is None:
            return ""
        parsed = urlparse(path)
        request_path = parsed.path
        if request_path in {"/", ""}:
            target = self.app.dist_dir / "index.html"
        else:
            target = self.app.dist_dir / request_path.lstrip("/")
            if not target.exists():
                target = self.app.dist_dir / "index.html"
        return str(target)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed)
            return
        if self.app.dist_dir is None:
            self.send_error(HTTPStatus.NOT_FOUND, "static UI disabled")
            return
        super().do_GET()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path: str) -> str:
        mimetype, _ = mimetypes.guess_type(path)
        return mimetype or "application/octet-stream"

    def log_message(self, format: str, *args: object) -> None:
        return

    def _handle_api(self, parsed) -> None:
        params = parse_qs(parsed.query)
        if parsed.path == "/api/overview":
            limit = _parse_limit(params.get("limit", ["30"])[0], default=30)
            self._write_json(self.app.overview(limit))
            return
        if parsed.path == "/api/job":
            job_path = params.get("job_path", [None])[0]
            if not job_path:
                self._write_json(_error_payload("input_error", "job_path is required"), status=HTTPStatus.BAD_REQUEST)
                return
            self._write_json(self.app.job(job_path))
            return
        if parsed.path == "/api/job-output":
            job_path = params.get("job_path", [None])[0]
            if not job_path:
                self._write_json(_error_payload("input_error", "job_path is required"), status=HTTPStatus.BAD_REQUEST)
                return
            limit = _parse_limit(params.get("limit", ["200"])[0], default=200)
            events_cursor = _parse_cursor(params.get("events_cursor", [None])[0])
            stdout_cursor = _parse_cursor(params.get("stdout_cursor", [None])[0])
            stderr_cursor = _parse_cursor(params.get("stderr_cursor", [None])[0])
            self._write_json(self.app.job_output(
                job_path, limit,
                events_cursor=events_cursor,
                stdout_cursor=stdout_cursor,
                stderr_cursor=stderr_cursor,
            ))
            return

        self._write_json(_error_payload("not_found", "unknown API route"), status=HTTPStatus.NOT_FOUND)

    def _write_json(self, payload: dict[str, Any], *, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _parse_limit(raw: str, *, default: int) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(1, min(value, 1000))


def _parse_cursor(raw: str | None) -> int | None:
    """Parse a cursor query-string value.

    Returns ``None`` when the param was omitted or not a valid integer,
    signalling "tail mode" to ``_stream_page``.
    """
    if raw is None:
        return None
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return None


def _error_payload(error_type: str, error_message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "error_type": error_type,
        "error_message": error_message,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the claude-delegate progress UI.")
    parser.add_argument("--artifacts-root", default="/tmp/claude-delegate-runs")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--api-only", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    app = ProgressUiApp(
        args.artifacts_root,
        dist_dir=None if args.api_only else _ui_dist_dir(),
        serve_static=not args.api_only,
    )
    if app.dist_dir is not None and not app.dist_dir.exists():
        raise SystemExit(
            f"UI bundle not found at {app.dist_dir}. Run `bun install && bun run build` in {app.dist_dir.parent} first."
        )

    handler = type("BoundProgressUiHandler", (ProgressUiHandler,), {"app": app})
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(
        json.dumps(
            {
                "ok": True,
                "url": f"http://{args.host}:{args.port}",
                "artifacts_root": str(app.artifacts_root),
                "dist_dir": None if app.dist_dir is None else str(app.dist_dir),
                "api_only": args.api_only,
            },
            indent=2,
            sort_keys=True,
        )
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
