import { formatRelativeTime, secondsSince } from "./time.js";
import { summarizeText } from "./text.js";
import { latestEventSummary } from "./events.js";

export function deriveJobDiagnosis(view, items = []) {
  const job = view?.job;
  const delegate = view?.delegate || {};
  const completion = delegate.completion || delegate.structured_output || {};
  const latest = latestEventSummary(items);
  const ageSeconds = secondsSince(job?.last_event_at);
  const ageLabel = job?.last_event_at ? `${formatRelativeTime(job.last_event_at)} ago` : "not yet";

  if (!job) return "No job selected.";

  if (job.state === "running") {
    if (latest?.key === "api_retry") {
      return `Provider retry in flight. Last visible event ${ageLabel}.`;
    }
    if (ageSeconds !== null && ageSeconds > 90 && latest) {
      return `Possibly stalled. Last visible step ${ageLabel}: ${latest.title}${latest.detail ? ` - ${latest.detail}` : ""}.`;
    }
    if (latest) {
      return `Live. Last visible step ${ageLabel}: ${latest.title}${latest.detail ? ` - ${latest.detail}` : ""}.`;
    }
    return "Worker started. Waiting for first visible event.";
  }

  if (job.state === "finished") {
    if (completion.summary) return summarizeText(completion.summary, 220);
    return "Finished without a completion summary.";
  }

  if (job.state === "failed") {
    return delegate.error_message || job.last_error || completion.summary || "Failed without a summarized error.";
  }

  if (job.state === "paused") {
    return "Paused. This session can be resumed from the same assistant identity.";
  }

  if (job.state === "cancelled") {
    return "Cancelled before reaching a terminal delegate result.";
  }

  return `State: ${job.state || "unknown"}.`;
}

export function stateTone(state) {
  switch (state) {
    case "running":
      return "running";
    case "finished":
      return "finished";
    case "failed":
    case "cancelled":
      return "failed";
    case "paused":
      return "paused";
    default:
      return "idle";
  }
}

export function streamActivity(job) {
  if (!job) return "idle";
  if (job.state !== "running") return job.state || "idle";
  return job.last_event_at ? "streaming" : "starting";
}
