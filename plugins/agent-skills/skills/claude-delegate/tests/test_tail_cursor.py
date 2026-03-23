"""Verify tail-on-first-open and incremental cursor behaviour."""
from __future__ import annotations
import json, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from claude_delegate.progress_ui import ProgressUiApp

LIMIT = 5

def _setup(tmp):
    job_dir = tmp / "sessions" / "s1" / "jobs" / "j1"
    job_dir.mkdir(parents=True)
    events_path = job_dir / "events.jsonl"
    events_path.write_text(
        "\n".join(json.dumps({"seq": i}) for i in range(20)) + "\n"
    )
    stdout_path = job_dir / "stdout.jsonl"
    stdout_path.write_text("")
    stderr_path = job_dir / "stderr.log"
    stderr_path.write_text("")
    job_json = job_dir / "job.json"
    job_json.write_text(json.dumps({
        "state": "running",
        "events_path": str(events_path),
        "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path),
    }))
    return str(job_dir)

def test():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        job_path = _setup(tmp)
        app = ProgressUiApp(tmp)

        # 1. Initial request WITHOUT cursors -> tail (last page)
        result = app.job_output(job_path, LIMIT)
        events = result["events"]
        seqs = [item["parsed"]["seq"] for item in events["items"]]
        assert seqs == [15, 16, 17, 18, 19], f"Expected tail [15..19], got {seqs}"
        assert events["cursor"] == 15
        assert events["next_cursor"] == 20
        assert events["has_more"] is False
        print("PASS  initial request returns tail (last page)")

        # 2. Subsequent request WITH returned cursor -> incremental
        next_cursor = events["next_cursor"]
        result2 = app.job_output(job_path, LIMIT, events_cursor=next_cursor)
        events2 = result2["events"]
        assert events2["items"] == []
        assert events2["cursor"] == 20
        assert events2["next_cursor"] == 20
        assert events2["has_more"] is False
        print("PASS  subsequent request with cursor returns incremental (empty = caught up)")

        # 3. Simulate new lines arriving, then incremental pick-up
        events_path = Path(result["paths"]["events_path"])
        with open(events_path, "a") as f:
            for i in range(20, 23):
                f.write(json.dumps({"seq": i}) + "\n")
        result3 = app.job_output(job_path, LIMIT, events_cursor=next_cursor)
        events3 = result3["events"]
        seqs3 = [item["parsed"]["seq"] for item in events3["items"]]
        assert seqs3 == [20, 21, 22], f"Expected incremental [20,21,22], got {seqs3}"
        assert events3["cursor"] == 20
        assert events3["next_cursor"] == 23
        print("PASS  incremental picks up new lines after cursor")

        # 4. Explicit cursor=0 still reads from start
        result4 = app.job_output(job_path, LIMIT, events_cursor=0)
        events4 = result4["events"]
        seqs4 = [item["parsed"]["seq"] for item in events4["items"]]
        assert seqs4 == [0, 1, 2, 3, 4], f"Expected [0..4], got {seqs4}"
        print("PASS  explicit cursor=0 reads from start")

    print("\nAll tests passed.")

if __name__ == "__main__":
    test()
