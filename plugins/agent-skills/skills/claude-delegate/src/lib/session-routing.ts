import { randomUUID } from "node:crypto";

import { findRoutableSession } from "./ledger-query.js";

export function resolveSessionRouting(
  request: Record<string, unknown>,
  artifactsRoot: string,
): Record<string, unknown> {
  const routingMode =
    (request.session_routing as string) ?? "new";
  const lineage = (request.lineage ?? {}) as Record<string, unknown>;

  if (lineage.action === "resume") {
    request.routing = {
      mode: routingMode,
      decision: "lineage_resume",
      matched_session_id: request.resume_session_id ?? null,
      matched_job_path: lineage.parent_job_path ?? null,
      reason: "Lineage resume reuses the parent Claude session.",
    };
    return request;
  }

  if (lineage.action === "fork" || lineage.action === "retry") {
    request.routing = {
      mode: routingMode,
      decision: `lineage_${lineage.action}`,
      matched_session_id: null,
      matched_job_path: lineage.parent_job_path ?? null,
      reason: `Lineage ${lineage.action} starts a fresh Claude session.`,
    };
    return request;
  }

  if (request.resume_session_id) {
    request.routing = {
      mode: routingMode,
      decision: "explicit_reuse",
      matched_session_id: request.resume_session_id,
      matched_job_path: null,
      reason: "Explicit --resume-session-id.",
    };
    return request;
  }

  if (request.session_id) {
    request.routing = {
      mode: routingMode,
      decision: "explicit_session",
      matched_session_id: request.session_id,
      matched_job_path: null,
      reason: "Explicit --session-id.",
    };
    return request;
  }

  if (routingMode === "auto") {
    const routingCandidate = findRoutableSession(artifactsRoot, {
      cwd: request.cwd as string,
      workspaceId:
        ((request.workspace_identity as Record<string, unknown>) ?? {})
          .workspace_id as string | null ?? null,
      runtime: request.runtime as string,
      assistantRole: request.assistant_role as string,
      taskType: request.task_type as string,
      provider: (request.provider as string) ?? null,
      model: (request.model as string) ?? null,
    });

    const matched = routingCandidate.matched_session as Record<
      string,
      unknown
    > | null;
    if (matched !== null) {
      const matchedHealth = matched.session_health ?? null;
      request.session_id = matched.session_id;
      request.resume_session_id = matched.session_id;
      request.routing = {
        mode: routingMode,
        decision: "matched_resumable",
        matched_session_id: matched.session_id,
        matched_job_path: matched.last_job_path ?? null,
        candidate_count: routingCandidate.candidate_count,
        session_health: matchedHealth,
        reason:
          "Matched the latest resumable session by workspace boundary, runtime, assistant_role, task_type, provider, and model.",
      };
      return request;
    }

    const active = routingCandidate.active_session as Record<
      string,
      unknown
    > | null;
    if (active !== null) {
      request.routing = {
        mode: routingMode,
        decision: "matching_session_active",
        matched_session_id: active.session_id,
        matched_job_path: active.last_job_path ?? null,
        candidate_count: routingCandidate.candidate_count,
        session_health: active.session_health ?? null,
        reason: "A matching session is active and cannot be reused.",
      };
      return request;
    }

    request.routing = {
      mode: routingMode,
      decision: "new_session",
      matched_session_id: null,
      matched_job_path: null,
      candidate_count: 0,
      reason: "No matching resumable session found.",
    };
    return request;
  }

  request.routing = {
    mode: routingMode,
    decision: "new_session",
    matched_session_id: null,
    matched_job_path: null,
    reason:
      "Routing mode new always starts a fresh Claude session.",
  };
  return request;
}

export function resolveSessionFields(
  sessionId: string | null | undefined,
  resumeSessionId: string | null | undefined,
): [string, string | null] {
  if (
    sessionId &&
    resumeSessionId &&
    sessionId !== resumeSessionId
  ) {
    throw new Error(
      "Use either --session-id or --resume-session-id, not both.",
    );
  }
  if (resumeSessionId) return [resumeSessionId, resumeSessionId];
  if (sessionId) return [sessionId, null];
  return [randomUUID(), null];
}
