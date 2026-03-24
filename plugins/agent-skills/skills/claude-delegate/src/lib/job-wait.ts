import {
  closeSync,
  existsSync,
  openSync,
} from "node:fs";

import { flockSync } from "fs-ext";

import { artifactPaths } from "./common.js";
import { renderJobView } from "./job-views.js";

export function waitForJob(jobPath: string): Record<string, unknown> {
  const paths = artifactPaths(jobPath);
  if (!existsSync(paths.lock)) {
    return {
      ok: false,
      error_type: "missing_job_state",
      error_message: "job lock file does not exist",
    };
  }

  const fd = openSync(paths.lock, "r+");
  try {
    flockSync(fd, "sh");
    flockSync(fd, "un");
  } finally {
    closeSync(fd);
  }

  return renderJobView(jobPath, { requireTerminal: true });
}

export function waitForJobsAny(
  jobPaths: string[],
): Promise<Record<string, unknown>> {
  if (jobPaths.length === 0) {
    return Promise.resolve({
      ok: false,
      error_type: "input_error",
      error_message: "no job paths provided",
    });
  }
  if (jobPaths.length === 1) {
    return Promise.resolve(waitForJob(jobPaths[0]));
  }

  return new Promise((resolve) => {
    let resolved = false;
    for (const jp of jobPaths) {
      // Each wait runs in its own microtask via setImmediate
      setImmediate(() => {
        const result = waitForJob(jp);
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      });
    }
  });
}

export function waitForJobsAll(
  jobPaths: string[],
): Promise<Record<string, unknown>> {
  if (jobPaths.length === 0) {
    return Promise.resolve({
      ok: false,
      error_type: "input_error",
      error_message: "no job paths provided",
    });
  }
  if (jobPaths.length === 1) {
    return Promise.resolve(waitForJob(jobPaths[0]));
  }

  return new Promise((resolve) => {
    const results: Record<string, Record<string, unknown>> = {};
    let count = 0;
    for (const jp of jobPaths) {
      setImmediate(() => {
        results[jp] = waitForJob(jp);
        count += 1;
        if (count === jobPaths.length) {
          const jobResults = jobPaths.map((p) => results[p]);
          const allOk = jobResults.every(
            (r) =>
              r.ok === true &&
              ((r.job as Record<string, unknown>) ?? {}).state ===
                "finished",
          );
          resolve({
            ok: allOk,
            jobs: jobResults,
          });
        }
      });
    }
  });
}
