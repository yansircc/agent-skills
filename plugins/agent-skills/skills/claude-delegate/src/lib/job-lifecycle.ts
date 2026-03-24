import { TERMINAL_JOB_STATES, artifactPaths, utcNow } from "./common.js";
import { updateJob } from "./job-state.js";
import { renderJobView, requestView } from "./job-views.js";
import { waitForJob } from "./job-wait.js";

export function cancelJob(
  jobPath: string,
): Record<string, unknown> {
  return terminateJob(jobPath, {
    transitionState: "cancelling",
    intent: "cancel",
    requestedAtField: "cancel_requested_at",
  });
}

export function pauseJob(
  jobPath: string,
): Record<string, unknown> {
  return terminateJob(jobPath, {
    transitionState: "pausing",
    intent: "pause",
    requestedAtField: "pause_requested_at",
  });
}

function terminateJob(
  jobPath: string,
  opts: {
    transitionState: string;
    intent: string;
    requestedAtField: string;
  },
): Record<string, unknown> {
  const view = renderJobView(jobPath);
  if (!view.ok) return view;

  const job = view.job as Record<string, unknown>;
  if (TERMINAL_JOB_STATES.has(job.state as string)) return view;

  const pid = job.pid as number | null;
  if (pid == null) {
    return {
      ok: false,
      error_type: "missing_worker_pid",
      error_message: "job is not terminal but has no worker pid",
      job,
      request: view.request,
      delegate: view.delegate,
      ready: false,
    };
  }

  const paths = artifactPaths(jobPath);
  updateJob(paths, {
    state: opts.transitionState,
    termination_intent: opts.intent,
    [opts.requestedAtField]: utcNow(),
  });

  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    // Process already exited
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }

  return waitForJob(jobPath);
}
