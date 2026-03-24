import { readJson, writeJson, utcNow } from "./common.js";
import type { ArtifactPaths } from "./common.js";

export function buildJobRecord(
  paths: ArtifactPaths,
  request: Record<string, unknown>,
): Record<string, unknown> {
  const workflowRoles = (request.workflow_roles as string[]) ?? [
    request.assistant_role as string,
  ];
  return {
    assistant_role: request.assistant_role ?? null,
    cancel_requested_at: null,
    completed_roles: [],
    created_at: request.created_at,
    current_role:
      workflowRoles.length > 1
        ? null
        : (request.assistant_role as string) ?? null,
    current_step_job_path: null,
    delegate_pid: null,
    event_count: 0,
    events_path: paths.events,
    finished_at: null,
    job_id: paths.artifactsDir.split("/").pop()!,
    job_path: paths.artifactsDir,
    last_error: null,
    last_event_at: null,
    last_event_type: null,
    lock_path: paths.lock,
    normalized_path: paths.normalized,
    artifact_lifecycle: null,
    pause_requested_at: null,
    pid: null,
    request_path: paths.request,
    routing: request.routing ?? null,
    runtime: request.runtime ?? null,
    started_at: null,
    state: "submitted",
    step_job_paths: [],
    stderr_path: paths.stderr,
    stdout_path: paths.stdout,
    task_type:
      (request.task_type as string) ??
      ((request.task_packet as Record<string, unknown>) ?? {}).task_type ??
      null,
    termination_intent: null,
    updated_at: request.created_at,
    workflow_roles: workflowRoles,
    workflow_step: 0,
    workflow_total_steps: workflowRoles.length,
  };
}

export function initializeJob(
  paths: ArtifactPaths,
  request: Record<string, unknown>,
  opts?: { ledgerPath?: string },
): Record<string, unknown> {
  const record = buildJobRecord(paths, request);
  if (opts?.ledgerPath !== undefined) {
    record.ledger_path = opts.ledgerPath;
  }
  writeJson(paths.job, record);
  return record;
}

export function updateJob(
  paths: ArtifactPaths,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const job = readJson(paths.job) ?? {};
  Object.assign(job, changes);
  job.updated_at = utcNow();
  writeJson(paths.job, job);
  return job;
}

export function finalizeJobState(envelope: Record<string, unknown>): string {
  if (envelope.ok) return "finished";
  if (envelope.error_type === "paused") return "paused";
  if (envelope.error_type === "cancelled") return "cancelled";
  return "failed";
}
