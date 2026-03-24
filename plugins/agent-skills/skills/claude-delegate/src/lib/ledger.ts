import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
import path from "node:path";

import { flockSync } from "fs-ext";

import {
  TERMINAL_JOB_STATES,
  artifactPaths,
  readJson,
} from "./common.js";
import { buildWorkspaceIdentity } from "./workspace-identity.js";

export interface LedgerPaths {
  root: string;
  ledger: string;
  lock: string;
}

export function ledgerPaths(root: string): LedgerPaths {
  mkdirSync(root, { recursive: true });
  return {
    root,
    ledger: path.join(root, "ledger.jsonl"),
    lock: path.join(root, "ledger.lock"),
  };
}

export function appendLedgerEntry(
  artifactsRoot: string,
  artifactsDir: string,
  request: Record<string, unknown>,
): string {
  const paths = ledgerPaths(artifactsRoot);
  if (request.skip_ledger) {
    return paths.ledger;
  }

  const entry: Record<string, unknown> = {
    assistant_role: request.assistant_role ?? null,
    created_at: request.created_at,
    cwd: request.cwd,
    job_id: artifactsDir.split("/").pop()!,
    job_path: artifactsDir,
    model: request.model,
    provider: request.provider ?? null,
    runtime: request.runtime ?? null,
    session_id: request.session_id,
    task_type: request.task_type ?? null,
    workspace_id:
      ((request.workspace_identity as Record<string, unknown>) ?? {})
        .workspace_id ?? null,
  };

  // Touch lock file
  if (!existsSync(paths.lock)) {
    appendFileSync(paths.lock, "");
  }

  const fd = openSync(paths.lock, "r+");
  try {
    flockSync(fd, "ex");
    appendFileSync(paths.ledger, JSON.stringify(entry, Object.keys(entry).sort()) + "\n");
  } finally {
    flockSync(fd, "un");
    closeSync(fd);
  }

  return paths.ledger;
}

export function summarizeJob(
  jobPath: string,
): Record<string, unknown> | null {
  const paths = artifactPaths(jobPath);
  const request = readJson(paths.request);
  const job = readJson(paths.job);
  let delegate = readJson(paths.normalized);

  if (request === null || job === null) return null;

  delegate = delegate ?? {};
  const completion =
    (delegate.completion as Record<string, unknown>) ??
    (delegate.structured_output as Record<string, unknown>) ??
    {};
  const lineage = (request.lineage ?? {}) as Record<string, unknown>;
  let workspaceIdentity = request.workspace_identity;
  if (
    workspaceIdentity === null ||
    workspaceIdentity === undefined ||
    typeof workspaceIdentity !== "object"
  ) {
    workspaceIdentity = buildWorkspaceIdentity({
      cwd: request.cwd as string,
      executionPolicy:
        ((request.task_packet as Record<string, unknown>) ?? {})
          .execution_policy as Record<string, unknown> | null ?? null,
    });
  }
  const wi = workspaceIdentity as Record<string, unknown>;

  return {
    assistant_role:
      (job.assistant_role as string) ??
      (request.assistant_role as string) ??
      null,
    boundary_status:
      ((delegate.boundary as Record<string, unknown>) ?? {}).status ?? null,
    created_at: request.created_at,
    cwd: request.cwd,
    duration_ms: delegate.duration_ms ?? null,
    error_message: delegate.error_message ?? null,
    error_type: delegate.error_type ?? null,
    event_count: job.event_count ?? null,
    finished_at: job.finished_at ?? null,
    job_id: job.job_id ?? null,
    job_path: jobPath,
    last_event_at: job.last_event_at ?? null,
    last_event_type: job.last_event_type ?? null,
    lineage_action: lineage.action ?? null,
    model: request.model,
    model_usage: delegate.model_usage ?? null,
    num_turns: delegate.num_turns ?? null,
    ok: delegate.ok ?? null,
    provider: request.provider ?? null,
    runtime: request.runtime ?? null,
    session_id: request.session_id,
    summary:
      (completion.summary as string) ??
      (delegate.result as string) ??
      null,
    started_at: job.started_at ?? null,
    state: job.state ?? null,
    task_type:
      (job.task_type as string) ??
      (request.task_type as string) ??
      ((request.task_packet as Record<string, unknown>) ?? {})
        .task_type ??
      null,
    total_cost_usd: delegate.total_cost_usd ?? null,
    verification_status:
      ((delegate.verification as Record<string, unknown>) ?? {}).status ??
      null,
    workflow_roles:
      (job.workflow_roles as string[]) ??
      (request.workflow_roles as string[]) ??
      null,
    workspace_id: wi.workspace_id ?? null,
    workspace_identity: workspaceIdentity,
  };
}

export function collectSummaries(
  artifactsRoot: string,
  opts: {
    limit: number | null;
    sessionId: string | null;
    runtime: string | null;
    provider: string | null;
    state: string | null;
  },
): [Record<string, unknown>[], LedgerPaths] {
  const paths = ledgerPaths(artifactsRoot);
  if (!existsSync(paths.ledger)) {
    return [[], paths];
  }

  const items: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  // Touch lock file
  if (!existsSync(paths.lock)) {
    appendFileSync(paths.lock, "");
  }

  let lines: string[];
  const fd = openSync(paths.lock, "r+");
  try {
    flockSync(fd, "sh");
    lines = readFileSync(paths.ledger, "utf-8").split("\n");
    flockSync(fd, "un");
  } finally {
    closeSync(fd);
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const entry = JSON.parse(line) as Record<string, unknown>;
    const jobPath = entry.job_path as string;
    if (seen.has(jobPath)) continue;
    seen.add(jobPath);

    const summary = summarizeJob(jobPath);
    if (summary === null) continue;
    if (
      opts.sessionId !== null &&
      summary.session_id !== opts.sessionId
    )
      continue;
    if (
      opts.runtime !== null &&
      summary.runtime !== opts.runtime
    )
      continue;
    if (
      opts.provider !== null &&
      summary.provider !== opts.provider
    )
      continue;
    if (opts.state !== null && summary.state !== opts.state) continue;

    items.push(summary);
    if (opts.limit !== null && items.length >= opts.limit) break;
  }

  return [items, paths];
}

export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(value);
}
