import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import path from "node:path";

import { flockSync } from "fs-ext";

import { TERMINAL_JOB_STATES } from "./common.js";
import { ledgerPaths, parseTimestamp, summarizeJob } from "./ledger.js";

export function pruneTerminalJobs(
  artifactsRoot: string,
  opts: { olderThanHours: number },
): Record<string, unknown> {
  const paths = ledgerPaths(artifactsRoot);
  const cutoff = new Date(
    Date.now() - opts.olderThanHours * 3600_000,
  );
  if (!existsSync(paths.ledger)) {
    return {
      ok: true,
      deleted_count: 0,
      stale_entry_count: 0,
      kept_count: 0,
      ledger_path: paths.ledger,
      cutoff: cutoff.toISOString(),
    };
  }

  const deletedJobPaths: string[] = [];
  const staleJobPaths: string[] = [];
  const keptLines: string[] = [];
  const decisionCache: Record<string, string> = {};

  // Touch lock file
  if (!existsSync(paths.lock)) {
    appendFileSync(paths.lock, "");
  }

  const fd = openSync(paths.lock, "r+");
  try {
    flockSync(fd, "ex");
    const lines = readFileSync(paths.ledger, "utf-8").split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as Record<string, unknown>;
      const jobPath = entry.job_path as string;

      let decision = decisionCache[jobPath];
      if (decision === undefined) {
        if (!existsSync(jobPath)) {
          decision = "stale";
        } else {
          const summary = summarizeJob(jobPath);
          const finishedAt =
            summary !== null
              ? parseTimestamp(summary.finished_at as string | null)
              : null;
          if (
            summary !== null &&
            TERMINAL_JOB_STATES.has(summary.state as string) &&
            finishedAt !== null &&
            finishedAt.getTime() <= cutoff.getTime()
          ) {
            decision = "delete";
          } else {
            decision = "keep";
          }
        }
        decisionCache[jobPath] = decision;
      }

      if (decision === "delete") {
        if (!deletedJobPaths.includes(jobPath)) {
          deletedJobPaths.push(jobPath);
        }
        continue;
      }
      if (decision === "stale") {
        if (!staleJobPaths.includes(jobPath)) {
          staleJobPaths.push(jobPath);
        }
        continue;
      }
      keptLines.push(line);
    }

    if (keptLines.length > 0) {
      writeFileSync(paths.ledger, keptLines.join("\n") + "\n");
    } else {
      writeFileSync(paths.ledger, "");
    }
  } finally {
    flockSync(fd, "un");
    closeSync(fd);
  }

  for (const jobPath of deletedJobPaths) {
    rmSync(jobPath, { recursive: true, force: true });
  }

  return {
    ok: true,
    deleted_count: deletedJobPaths.length,
    deleted_job_paths: deletedJobPaths,
    stale_entry_count: staleJobPaths.length,
    stale_job_paths: staleJobPaths,
    kept_count: keptLines.length,
    ledger_path: paths.ledger,
    cutoff: cutoff.toISOString(),
  };
}
