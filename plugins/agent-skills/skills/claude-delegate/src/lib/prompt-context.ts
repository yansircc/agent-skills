import { sortedStringify } from "./common.js";

const MAX_LIST_ITEMS = 3;
const MAX_STRING_CHARS = 200;

export function promptLiteral(value: unknown): string {
  return sortedStringify(value, 0);
}

function truncateText(value: unknown, maxChars = MAX_STRING_CHARS): string {
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars - 3) + "...";
}

function compactStringList(
  values: unknown[],
  limit = MAX_LIST_ITEMS,
): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    result.push(truncateText(value));
    if (result.length >= limit) break;
  }
  return result;
}

function compactFindings(
  findings: Record<string, unknown>[],
  limit = MAX_LIST_ITEMS,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const finding of findings.slice(0, limit)) {
    const item: Record<string, unknown> = {};
    for (const key of ["severity", "file", "line"]) {
      const value = finding[key];
      if (value !== null && value !== undefined && value !== "") {
        item[key] = value;
      }
    }
    const issue = finding.issue;
    if (issue) item.issue = truncateText(issue);
    if (Object.keys(item).length > 0) result.push(item);
  }
  return result;
}

export function compactPriorStep(
  step: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of [
    "role",
    "ok",
    "error_type",
    "boundary_status",
    "verification_status",
  ]) {
    const value = step[key];
    if (value !== null && value !== undefined) payload[key] = value;
  }

  const summary = step.summary;
  if (summary) payload.summary = truncateText(summary);

  const findings = compactFindings(
    (step.findings as Record<string, unknown>[]) ?? [],
  );
  if (findings.length > 0) payload.findings = findings;

  for (const key of [
    "open_risks",
    "changed_files",
    "diff_summary",
    "files_examined",
    "test_commands",
    "suggested_actions",
  ]) {
    const items = compactStringList((step[key] as unknown[]) ?? []);
    if (items.length > 0) payload[key] = items;
  }

  return payload;
}

export function compactParentHandoff(
  parentHandoff: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of [
    "assistant_role",
    "ok",
    "error_type",
    "boundary_status",
    "verification_status",
  ]) {
    const value = parentHandoff[key];
    if (value !== null && value !== undefined) payload[key] = value;
  }

  for (const key of ["summary", "error_message"]) {
    const value = parentHandoff[key];
    if (value) payload[key] = truncateText(value);
  }

  const taskPacketSummary =
    (parentHandoff.task_packet_summary as Record<string, unknown>) ?? {};
  if (Object.keys(taskPacketSummary).length > 0) {
    const taskPayload: Record<string, unknown> = {};
    if (taskPacketSummary.goal)
      taskPayload.goal = truncateText(taskPacketSummary.goal);
    if (taskPacketSummary.task_type)
      taskPayload.task_type = taskPacketSummary.task_type;
    if (Object.keys(taskPayload).length > 0)
      payload.task_packet_summary = taskPayload;
  }

  const executionSummary =
    (parentHandoff.execution_summary as Record<string, unknown>) ?? {};
  const executionPayload: Record<string, unknown> = {};
  for (const key of ["duration_ms", "num_turns", "total_cost_usd"]) {
    if (executionSummary[key] !== null && executionSummary[key] !== undefined)
      executionPayload[key] = executionSummary[key];
  }
  if (Object.keys(executionPayload).length > 0)
    payload.execution_summary = executionPayload;

  const findings = compactFindings(
    (parentHandoff.findings as Record<string, unknown>[]) ?? [],
  );
  if (findings.length > 0) payload.findings = findings;

  for (const key of [
    "open_risks",
    "changed_files",
    "diff_summary",
    "files_examined",
    "test_commands",
    "suggested_actions",
  ]) {
    const items = compactStringList((parentHandoff[key] as unknown[]) ?? []);
    if (items.length > 0) payload[key] = items;
  }

  return payload;
}

export function renderStructuredItem(
  title: string,
  payload: Record<string, unknown> | null,
): string[] {
  if (!payload || Object.keys(payload).length === 0) return [];
  return [title, `- ${promptLiteral(payload)}`];
}

export function renderStructuredItems(
  title: string,
  payloads: Record<string, unknown>[],
): string[] {
  const items = payloads.filter(
    (p) => p && Object.keys(p).length > 0,
  );
  if (items.length === 0) return [];
  return [title, ...items.map((p) => `- ${promptLiteral(p)}`)];
}
