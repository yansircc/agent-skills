#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  artifactPaths,
  buildArtifactsDir,
  printJson,
  writeJson,
} from "../lib/common.js";
import { compactTerminalJobs } from "../lib/artifact-lifecycle.js";
import { cancelJob, pauseJob } from "../lib/job-lifecycle.js";
import { initializeJob } from "../lib/job-state.js";
import { renderJobView } from "../lib/job-views.js";
import {
  waitForJob,
  waitForJobsAll,
  waitForJobsAny,
} from "../lib/job-wait.js";
import { submitRequest, runWorker } from "../lib/jobs.js";
import { appendLedgerEntry } from "../lib/ledger.js";
import { pruneTerminalJobs } from "../lib/ledger-maintenance.js";
import {
  ledgerStats,
  listLedger,
  listSessions,
} from "../lib/ledger-query.js";
import { buildRequest } from "./request.js";
import { buildProgram, determineMode } from "./args.js";

export async function main(): Promise<number> {
  try {
    const program = buildProgram();
    program.parse();
    const opts = program.opts();
    const mode = determineMode(opts);

    if (mode === "worker") {
      const jobPaths = opts.jobPath as string[];
      if (!jobPaths || jobPaths.length === 0) {
        throw new Error("Provide --job-path for --job-worker.");
      }
      const startupFd = opts.startupFd as number | undefined;
      let startupNotify: (() => void) | null = null;
      if (startupFd != null) {
        const { writeSync, closeSync } = await import("node:fs");
        startupNotify = (): void => {
          try {
            writeSync(startupFd, "started\n");
            closeSync(startupFd);
          } catch {
            // FD may be invalid
          }
        };
      }
      if (process.send) {
        const originalNotify = startupNotify;
        startupNotify = (): void => {
          process.send!("started");
          originalNotify?.();
        };
      }
      return await runWorker(jobPaths[0], startupNotify);
    }

    if (
      mode === "status" ||
      mode === "wait" ||
      mode === "cancel" ||
      mode === "pause"
    ) {
      const jobPaths = opts.jobPath as string[];
      if (!jobPaths || jobPaths.length === 0) {
        throw new Error(
          "Provide --job-path for status, wait, cancel, or pause.",
        );
      }
      if (jobPaths.length > 1) {
        throw new Error(
          "--wait/--status/--cancel/--pause require exactly one --job-path; " +
            "use --wait-any or --wait-all for multiple jobs.",
        );
      }
      const jobPath = jobPaths[0];
      let payload: Record<string, unknown>;
      if (mode === "status") {
        payload = renderJobView(jobPath);
      } else if (mode === "wait") {
        payload = waitForJob(jobPath);
      } else if (mode === "pause") {
        payload = pauseJob(jobPath);
      } else {
        payload = cancelJob(jobPath);
      }
      printJson(payload);
      return payload.ok ? 0 : 1;
    }

    if (mode === "wait_any" || mode === "wait_all") {
      const jobPaths = opts.jobPath as string[];
      if (!jobPaths || jobPaths.length === 0) {
        throw new Error(
          "Provide at least one --job-path for --wait-any / --wait-all.",
        );
      }
      let payload: Record<string, unknown>;
      if (mode === "wait_any") {
        payload = await waitForJobsAny(jobPaths);
      } else {
        payload = await waitForJobsAll(jobPaths);
      }
      printJson(payload);
      return payload.ok ? 0 : 1;
    }

    if (mode === "ledger") {
      const payload = listLedger(opts.artifactsRoot as string, {
        limit: opts.ledgerLimit as number,
        sessionId: (opts.ledgerSessionId as string) ?? null,
        runtime: (opts.ledgerRuntime as string) ?? null,
        provider: (opts.ledgerProvider as string) ?? null,
        state: (opts.ledgerState as string) ?? null,
      });
      printJson(payload);
      return payload.ok ? 0 : 1;
    }

    if (mode === "ledger_stats") {
      const payload = ledgerStats(opts.artifactsRoot as string, {
        sessionId: (opts.ledgerSessionId as string) ?? null,
        runtime: (opts.ledgerRuntime as string) ?? null,
        provider: (opts.ledgerProvider as string) ?? null,
        state: (opts.ledgerState as string) ?? null,
      });
      printJson(payload);
      return payload.ok ? 0 : 1;
    }

    if (mode === "list_sessions") {
      const payload = listSessions(opts.artifactsRoot as string, {
        limit: (opts.listSessionsLimit as number) ?? null,
        sessionId: (opts.ledgerSessionId as string) ?? null,
        cwd: (opts.listSessionsCwd as string) ?? null,
        runtime: (opts.listSessionsRuntime as string) ?? null,
        provider: (opts.listSessionsProvider as string) ?? null,
        state: (opts.listSessionsState as string) ?? null,
        assistantRole: (opts.listSessionsRole as string) ?? null,
        taskType: (opts.listSessionsTaskType as string) ?? null,
      });
      printJson(payload);
      return payload.ok ? 0 : 1;
    }

    if (mode === "prune") {
      const payload = pruneTerminalJobs(opts.artifactsRoot as string, {
        olderThanHours: opts.pruneTerminalOlderThanHours as number,
      });
      printJson(payload);
      return payload.ok ? 0 : 1;
    }

    if (mode === "compact") {
      const payload = await compactTerminalJobs(
        opts.artifactsRoot as string,
        {
          olderThanHours:
            opts.compactTerminalOlderThanHours as number,
        },
      );
      printJson(payload);
      return payload.ok ? 0 : 1;
    }

    // mode === "run" or mode === "submit"
    const artifactsDir = buildArtifactsDir(
      opts.artifactsRoot as string,
    );
    const request = buildRequest(opts);
    writeJson(path.join(artifactsDir, "request.json"), request);
    const ledgerPath = appendLedgerEntry(
      opts.artifactsRoot as string,
      artifactsDir,
      request,
    );
    initializeJob(artifactPaths(artifactsDir), request, {
      ledgerPath,
    });

    if (mode === "submit") {
      const [payload, exitCode] = submitRequest(
        request,
        artifactsDir,
        path.resolve(
          new URL(import.meta.url).pathname,
        ),
      ) as unknown as [Record<string, unknown>, number];
      printJson(payload);
      return exitCode;
    }

    // Direct run mode
    const { writeFileSync } = await import("node:fs");
    const paths = artifactPaths(artifactsDir);
    if (!existsSync(paths.lock)) {
      writeFileSync(paths.lock, "");
    }
    const exitCode = await runWorker(artifactsDir, null);
    const normalizedPath = path.join(artifactsDir, "normalized.json");
    if (existsSync(normalizedPath)) {
      console.log(readFileSync(normalizedPath, "utf-8"));
      return exitCode;
    }

    throw new Error("run completed without normalized output");
  } catch (exc) {
    printJson({
      ok: false,
      error_type: "input_error",
      error_message: String(exc),
    });
    return 2;
  }
}

main().then((code) => {
  process.exitCode = code;
});
