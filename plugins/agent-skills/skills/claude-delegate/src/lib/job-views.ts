import { TERMINAL_JOB_STATES, artifactPaths, readJson } from "./common.js";

export function requestView(
  request: Record<string, unknown>,
): Record<string, unknown> {
  return {
    assistant_role: request.assistant_role ?? null,
    cwd: request.cwd,
    lineage: request.lineage ?? null,
    max_budget_usd:
      (
        ((request.task_packet as Record<string, unknown>) ?? {})
          .execution_policy as Record<string, unknown> ?? {}
      ).max_budget_usd ?? null,
    model: request.model,
    provider: request.provider ?? null,
    runtime: request.runtime ?? null,
    resume_session_id: request.resume_session_id,
    routing: request.routing ?? null,
    session_id: request.session_id,
    task_type:
      (request.task_type as string) ??
      ((request.task_packet as Record<string, unknown>) ?? {})
        .task_type ??
      null,
    tools: request.tools,
    workflow_roles:
      (request.workflow_roles as string[]) ?? [
        request.assistant_role as string,
      ],
  };
}

function summarizeStepJob(
  jobPath: string,
): Record<string, unknown> | null {
  const paths = artifactPaths(jobPath);
  const job = readJson(paths.job);
  const request = readJson(paths.request);
  const delegate = readJson(paths.normalized) ?? {};
  if (job === null || request === null) return null;

  const completion =
    (delegate.completion as Record<string, unknown>) ??
    (delegate.structured_output as Record<string, unknown>) ??
    {};

  return {
    assistant_role:
      (job.assistant_role as string) ??
      (request.assistant_role as string) ??
      null,
    boundary_status:
      ((delegate.boundary as Record<string, unknown>) ?? {}).status ?? null,
    error_type: delegate.error_type ?? null,
    event_count: job.event_count ?? null,
    finished_at: job.finished_at ?? null,
    job_path: jobPath,
    last_event_at: job.last_event_at ?? null,
    last_event_type: job.last_event_type ?? null,
    ok: delegate.ok ?? null,
    ready: TERMINAL_JOB_STATES.has(job.state as string),
    session_id: request.session_id ?? null,
    started_at: job.started_at ?? null,
    state: job.state ?? null,
    summary:
      (completion.summary as string) ??
      (delegate.result as string) ??
      null,
    task_type:
      (job.task_type as string) ??
      (request.task_type as string) ??
      ((request.task_packet as Record<string, unknown>) ?? {})
        .task_type ??
      null,
    verification_status:
      ((delegate.verification as Record<string, unknown>) ?? {}).status ??
      null,
  };
}

export function workflowStepViews(
  job: Record<string, unknown>,
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const jobPath of (job.step_job_paths as string[]) ?? []) {
    const summary = summarizeStepJob(jobPath);
    if (summary !== null) items.push(summary);
  }
  return items;
}

export function renderJobView(
  jobPath: string,
  opts?: { requireTerminal?: boolean },
): Record<string, unknown> {
  const paths = artifactPaths(jobPath);
  const job = readJson(paths.job);
  const request = readJson(paths.request);
  const delegate = readJson(paths.normalized);

  if (job === null || request === null) {
    return {
      ok: false,
      error_type: "missing_job_state",
      error_message: "job metadata is incomplete",
    };
  }

  const ready = TERMINAL_JOB_STATES.has(job.state as string);
  if (opts?.requireTerminal && !ready) {
    return {
      ok: false,
      error_type: "worker_state_error",
      error_message:
        "wait returned before the job reached a terminal state",
      job,
      request: requestView(request),
      delegate,
      ready: false,
      workflow_steps: workflowStepViews(job),
    };
  }

  return {
    ok: true,
    job,
    request: requestView(request),
    delegate,
    ready,
    workflow_steps: workflowStepViews(job),
  };
}
