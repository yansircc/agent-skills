import { collectSummaries, ledgerPaths, parseTimestamp } from "./ledger.js";
import {
  accumulateSessionHealth,
  finalizeSessionHealth,
  initializeSessionHealth,
  type SessionHealthAccumulator,
} from "./session-health.js";

function providerModelLabel(
  provider: string | null | undefined,
  model: string | null | undefined,
): string {
  if (provider && model) return `${provider}/${model}`;
  if (provider) return `${provider}/default`;
  if (model) return model;
  return "default";
}

export function listLedger(
  artifactsRoot: string,
  opts: {
    limit: number;
    sessionId: string | null;
    runtime: string | null;
    provider: string | null;
    state: string | null;
  },
): Record<string, unknown> {
  const [items, paths] = collectSummaries(artifactsRoot, {
    limit: opts.limit,
    sessionId: opts.sessionId,
    runtime: opts.runtime,
    provider: opts.provider,
    state: opts.state,
  });

  return {
    ok: true,
    count: items.length,
    items,
    ledger_path: paths.ledger,
  };
}

export function ledgerStats(
  artifactsRoot: string,
  opts: {
    sessionId: string | null;
    runtime: string | null;
    provider: string | null;
    state: string | null;
  },
): Record<string, unknown> {
  const [items, paths] = collectSummaries(artifactsRoot, {
    limit: null,
    sessionId: opts.sessionId,
    runtime: opts.runtime,
    provider: opts.provider,
    state: opts.state,
  });

  const states: Record<string, number> = {};
  const models: Record<string, Record<string, number>> = {};
  const providers: Record<string, number> = {};
  const roles: Record<string, number> = {};
  const taskTypes: Record<string, number> = {};
  const verificationStatuses: Record<string, number> = {};
  const boundaryStatuses: Record<string, number> = {};
  const lineageActions: Record<string, number> = {};
  let okCount = 0;
  let errorCount = 0;
  let totalCostUsd = 0;
  let durationTotalMs = 0;
  let durationCount = 0;

  for (const item of items) {
    const itemState = (item.state as string) ?? "unknown";
    states[itemState] = (states[itemState] ?? 0) + 1;
    const role = (item.assistant_role as string) ?? "unknown";
    roles[role] = (roles[role] ?? 0) + 1;
    const taskType = (item.task_type as string) ?? "unknown";
    taskTypes[taskType] = (taskTypes[taskType] ?? 0) + 1;
    const providerName = (item.provider as string) ?? "default";
    providers[providerName] = (providers[providerName] ?? 0) + 1;
    const verification =
      (item.verification_status as string) ?? "unknown";
    verificationStatuses[verification] =
      (verificationStatuses[verification] ?? 0) + 1;
    const boundary =
      (item.boundary_status as string) ?? "unknown";
    boundaryStatuses[boundary] =
      (boundaryStatuses[boundary] ?? 0) + 1;
    const lineageAction =
      (item.lineage_action as string) ?? "none";
    lineageActions[lineageAction] =
      (lineageActions[lineageAction] ?? 0) + 1;

    const modelName = providerModelLabel(
      item.provider as string | undefined,
      item.model as string | undefined,
    );
    if (!(modelName in models)) {
      models[modelName] = {
        count: 0,
        ok_count: 0,
        total_cost_usd: 0,
      };
    }
    const modelBucket = models[modelName];
    modelBucket.count += 1;

    if (item.ok === true) {
      okCount += 1;
      modelBucket.ok_count += 1;
    } else if (
      itemState === "failed" ||
      itemState === "cancelled"
    ) {
      errorCount += 1;
    }

    const cost = item.total_cost_usd;
    if (typeof cost === "number") {
      totalCostUsd += cost;
      modelBucket.total_cost_usd += cost;
    }

    const dMs = item.duration_ms;
    if (typeof dMs === "number" && Number.isInteger(dMs)) {
      durationTotalMs += dMs;
      durationCount += 1;
    }
  }

  return {
    ok: true,
    count: items.length,
    ok_count: okCount,
    error_count: errorCount,
    providers,
    states,
    models,
    roles,
    task_types: taskTypes,
    verification_statuses: verificationStatuses,
    boundary_statuses: boundaryStatuses,
    lineage_actions: lineageActions,
    total_cost_usd: totalCostUsd,
    average_duration_ms:
      durationCount > 0
        ? durationTotalMs / durationCount
        : null,
    ledger_path: paths.ledger,
  };
}

export function listSessions(
  artifactsRoot: string,
  opts?: {
    limit?: number | null;
    sessionId?: string | null;
    cwd?: string | null;
    workspaceId?: string | null;
    runtime?: string | null;
    provider?: string | null;
    state?: string | null;
    assistantRole?: string | null;
    taskType?: string | null;
  },
): Record<string, unknown> {
  const o = opts ?? {};
  const [items, paths] = collectSummaries(artifactsRoot, {
    limit: null,
    sessionId: null,
    runtime: null,
    provider: null,
    state: null,
  });

  const sessionsDict: Record<string, Record<string, unknown>> = {};

  const sortedItems = [...items].sort((a, b) => {
    const tA = parseTimestamp(a.created_at as string)?.getTime() ?? 0;
    const tB = parseTimestamp(b.created_at as string)?.getTime() ?? 0;
    return tB - tA;
  });

  for (const item of sortedItems) {
    const sid = item.session_id as string;
    if (!(sid in sessionsDict)) {
      sessionsDict[sid] = {
        session_id: sid,
        cwd: item.cwd,
        assistant_role: item.assistant_role ?? null,
        task_type: item.task_type ?? null,
        model: item.model,
        provider: item.provider ?? null,
        runtime: item.runtime ?? null,
        job_count: 0,
        first_created_at: item.created_at,
        last_created_at: item.created_at,
        last_job_path: item.job_path,
        last_state: item.state,
        started_at: item.started_at ?? null,
        finished_at: item.finished_at ?? null,
        last_event_at: item.last_event_at ?? null,
        summary: item.summary ?? null,
        boundary_status: item.boundary_status ?? null,
        verification_status: item.verification_status ?? null,
        lineage_action: (item.lineage_action as string) ?? "none",
        session_health: initializeSessionHealth(item),
        workspace_id: item.workspace_id ?? null,
        workspace_identity: item.workspace_identity ?? null,
      };
    } else {
      accumulateSessionHealth(
        sessionsDict[sid].session_health as SessionHealthAccumulator,
        item,
      );
    }

    const sess = sessionsDict[sid];
    sess.job_count = (sess.job_count as number) + 1;

    const firstTs = parseTimestamp(
      sess.first_created_at as string,
    );
    const thisTs = parseTimestamp(item.created_at as string);
    if (
      firstTs &&
      thisTs &&
      thisTs.getTime() < firstTs.getTime()
    ) {
      sess.first_created_at = item.created_at;
    }
  }

  const resultSessions: Record<string, unknown>[] = [];
  for (const [sid, sess] of Object.entries(sessionsDict)) {
    if (o.sessionId != null && sid !== o.sessionId) continue;
    if (o.cwd != null && sess.cwd !== o.cwd) continue;
    if (
      o.workspaceId != null &&
      sess.workspace_id !== o.workspaceId
    )
      continue;
    if (o.runtime != null && sess.runtime !== o.runtime) continue;
    if (o.provider != null && sess.provider !== o.provider)
      continue;
    if (o.state != null && sess.last_state !== o.state) continue;
    if (
      o.assistantRole != null &&
      sess.assistant_role !== o.assistantRole
    )
      continue;
    if (o.taskType != null && sess.task_type !== o.taskType)
      continue;

    sess.session_health = finalizeSessionHealth(
      sess.session_health as SessionHealthAccumulator,
    );
    sess.resumable = sess.last_state !== "running";
    sess.active = sess.last_state === "running";
    resultSessions.push(sess);

    if (
      o.limit != null &&
      resultSessions.length >= o.limit
    )
      break;
  }

  return {
    ok: true,
    count: resultSessions.length,
    items: resultSessions,
    ledger_path: paths.ledger,
  };
}

export function findRoutableSession(
  artifactsRoot: string,
  opts: {
    cwd: string;
    workspaceId: string | null;
    runtime: string;
    assistantRole: string;
    taskType: string;
    provider: string | null;
    model: string | null;
  },
): Record<string, unknown> {
  const listing = listSessions(artifactsRoot, {
    limit: null,
    sessionId: null,
    cwd: opts.cwd,
    workspaceId: opts.workspaceId,
    runtime: opts.runtime,
    provider: opts.provider,
    state: null,
    assistantRole: opts.assistantRole,
    taskType: opts.taskType,
  });
  const allItems = (listing.items as Record<string, unknown>[]) ?? [];
  const filtered = allItems.filter(
    (item) =>
      item.runtime === opts.runtime &&
      item.provider === opts.provider &&
      item.model === opts.model,
  );
  const matchedSession =
    filtered.find((item) => item.resumable === true) ?? null;
  const activeSession =
    filtered.find((item) => item.active === true) ?? null;
  return {
    candidate_count: filtered.length,
    matched_session: matchedSession,
    active_session: activeSession,
  };
}
