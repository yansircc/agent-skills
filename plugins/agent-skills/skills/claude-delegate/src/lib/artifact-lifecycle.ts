import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  openSync,
  unlinkSync,
} from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

import { flockSync } from "fs-ext";

import {
  TERMINAL_JOB_STATES,
  artifactPaths,
  readJson,
  utcNow,
  writeJson,
} from "./common.js";
import { collectSummaries, parseTimestamp } from "./ledger.js";

const COMPACTABLE_JOB_FIELDS = [
  "events_path",
  "stdout_path",
  "stderr_path",
] as const;

async function gzipPath(filePath: string): Promise<string> {
  const gzPath = `${filePath}.gz`;
  await pipeline(
    createReadStream(filePath),
    createGzip(),
    createWriteStream(gzPath),
  );
  unlinkSync(filePath);
  return gzPath;
}

function preservedArtifacts(
  paths: ReturnType<typeof artifactPaths>,
): Record<string, string> {
  return {
    request_path: paths.request,
    job_metadata_path: paths.job,
    normalized_path: paths.normalized,
    handoff_path: paths.handoff,
    patch_path: paths.patch,
  };
}

export async function compactJobArtifacts(
  jobPath: string,
): Promise<Record<string, unknown>> {
  const paths = artifactPaths(jobPath);
  if (!existsSync(paths.lock)) {
    return {
      ok: false,
      error_type: "missing_job_state",
      error_message: "job lock file does not exist",
      job_path: jobPath,
    };
  }

  const fd = openSync(paths.lock, "r+");
  try {
    flockSync(fd, "ex");

    const job = readJson(paths.job) ?? {};
    if (!TERMINAL_JOB_STATES.has(job.state as string)) {
      return {
        ok: false,
        error_type: "non_terminal_job",
        error_message: "job is not terminal",
        job_path: jobPath,
      };
    }

    const updatedPaths: Record<string, string> = {};
    const compactedFields: string[] = [];

    for (const field of COMPACTABLE_JOB_FIELDS) {
      const rawPath = job[field] as string | undefined;
      if (!rawPath) continue;
      if (rawPath.endsWith(".gz") || !existsSync(rawPath)) continue;
      const gzPath = await gzipPath(rawPath);
      updatedPaths[field] = gzPath;
      compactedFields.push(field);
    }

    if (compactedFields.length === 0) {
      const metadata = (job.artifact_lifecycle ?? {}) as Record<
        string,
        unknown
      >;
      if (Object.keys(metadata).length > 0) {
        return {
          ok: true,
          job_path: jobPath,
          status: (metadata.status as string) ?? "unchanged",
          compacted_fields:
            (metadata.compacted_fields as string[]) ?? [],
        };
      }
      return {
        ok: true,
        job_path: jobPath,
        status: "unchanged",
        compacted_fields: [],
      };
    }

    const metadata: Record<string, unknown> = {
      status: "compacted",
      compacted_at: utcNow(),
      compacted_fields: compactedFields,
      compacted_paths: updatedPaths,
      preserved_artifacts: preservedArtifacts(paths),
    };

    Object.assign(job, updatedPaths);
    job.artifact_lifecycle = metadata;
    job.updated_at = metadata.compacted_at;
    writeJson(paths.job, job);

    return {
      ok: true,
      job_path: jobPath,
      status: "compacted",
      compacted_fields: compactedFields,
      compacted_paths: updatedPaths,
    };
  } finally {
    flockSync(fd, "un");
    closeSync(fd);
  }
}

export async function compactTerminalJobs(
  artifactsRoot: string,
  opts: { olderThanHours: number },
): Promise<Record<string, unknown>> {
  const cutoff = new Date(
    Date.now() - opts.olderThanHours * 3600_000,
  );
  const [items] = collectSummaries(artifactsRoot, {
    limit: null,
    sessionId: null,
    runtime: null,
    provider: null,
    state: null,
  });

  const results: Record<string, unknown>[] = [];
  for (const item of items) {
    const finishedAt = parseTimestamp(
      item.finished_at as string | null,
    );
    if (!TERMINAL_JOB_STATES.has(item.state as string)) continue;
    if (
      finishedAt === null ||
      finishedAt.getTime() > cutoff.getTime()
    )
      continue;
    results.push(await compactJobArtifacts(item.job_path as string));
  }

  const compacted = results.filter(
    (item) => item.status === "compacted",
  );
  return {
    ok: true,
    count: results.length,
    compacted_count: compacted.length,
    items: results,
    cutoff: cutoff.toISOString(),
  };
}
