import path from "node:path";

import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, utcNow } from "./common.js";
import {
  ensureCompletionContract,
  normalizeTaskPacket,
  normalizeWorkflowRoles,
  splitCsv,
} from "./contracts.js";
import { buildDelegatePrompt, buildSystemPrompt, ROLE_SYSTEM_INSTRUCTIONS } from "./delegate-prompt.js";
import { loadParentHandoff } from "./handoff.js";
import { resolveRuntimeRequest } from "./runtime-profiles.js";
import { resolveSessionRouting, resolveSessionFields } from "./session-routing.js";
import { buildWorkspaceIdentity } from "./workspace-identity.js";

export function validateRole(role: string): string {
  if (!(role in ROLE_SYSTEM_INSTRUCTIONS)) {
    throw new Error(`Unsupported assistant role: ${role}`);
  }
  return role;
}

export function finalizeRequest(
  request: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = structuredClone(request);
  resolved.created_at = utcNow();
  resolved.cwd = path.resolve(
    (resolved.cwd as string) ?? process.cwd(),
  );

  const rawProvider = resolved.provider;
  if (rawProvider == null) {
    resolved.provider = null;
  } else {
    const provider = String(rawProvider).trim();
    resolved.provider = provider || null;
  }

  const rawModel = resolved.model;
  if (rawModel == null) {
    resolved.model =
      resolved.provider === null ? DEFAULT_MODEL : null;
  } else {
    const model = String(rawModel).trim();
    resolved.model = model || null;
  }
  resolved.settings = resolved.settings ?? null;

  const rawTimeout = resolved.timeout_seconds;
  if (rawTimeout == null) {
    resolved.timeout_seconds = null;
  } else {
    const timeoutSeconds = Number(rawTimeout);
    resolved.timeout_seconds =
      timeoutSeconds > 0 ? timeoutSeconds : null;
  }
  resolved.skip_ledger = Boolean(resolved.skip_ledger ?? false);

  let rawRoles = resolved.workflow_roles;
  if (typeof rawRoles === "string") {
    rawRoles = splitCsv(rawRoles);
  } else if (rawRoles == null) {
    rawRoles = [];
  }

  let assistantRole = resolved.assistant_role as string | null;
  if ((rawRoles as string[]).length > 1) {
    assistantRole = "supervisor";
  } else if (
    assistantRole == null &&
    (rawRoles as string[]).length === 1
  ) {
    assistantRole = (rawRoles as string[])[0];
  }
  assistantRole = validateRole(assistantRole ?? "implementer");
  const workflowRoles = normalizeWorkflowRoles(
    rawRoles as string[],
    assistantRole,
  );

  const taskType = (resolved.task_type as string) ?? "general";
  resolved.assistant_role = assistantRole;
  resolved.task_type = taskType;

  let goalText = resolved.goal as string | null;
  if (goalText == null && !("task_packet" in resolved)) {
    goalText = (resolved.prompt as string) ?? null;
  }

  const completionContract = ensureCompletionContract(
    (resolved.completion_contract ?? resolved.schema) as Record<
      string,
      unknown
    > | null,
    assistantRole,
  );

  let tools = resolved.tools as string | null;
  const rawTaskPacket = resolved.task_packet as Record<string, unknown> | null;
  if (
    tools == null &&
    rawTaskPacket != null &&
    "allowed_tools" in rawTaskPacket
  ) {
    tools = ((rawTaskPacket.allowed_tools as string[]) ?? []).join(",");
  }

  const taskPacket = normalizeTaskPacket(rawTaskPacket ?? null, {
    promptText: goalText,
    cwd: resolved.cwd as string,
    assistantRole,
    taskType,
    workflowRoles,
    tools,
    maxBudgetUsd: (resolved.max_budget_usd as number) ?? null,
    deltaPrompt:
      (resolved.delta_prompt as string) ??
      (
        (resolved.lineage as Record<string, unknown>) ?? {}
      ).delta_prompt as string | null ??
      null,
  });

  if (!taskPacket.goal) {
    throw new Error(
      "Provide --prompt, --prompt-file, stdin, or a task packet with a non-empty goal.",
    );
  }

  resolved.task_packet = taskPacket;
  resolved.workspace_identity = buildWorkspaceIdentity({
    cwd: resolved.cwd as string,
    executionPolicy:
      (taskPacket.execution_policy as Record<string, unknown>) ?? null,
  });
  resolved.runtime_resolution = resolveRuntimeRequest(resolved);
  resolved.runtime = (
    resolved.runtime_resolution as Record<string, unknown>
  ).name;
  resolved.runtime_bin = (
    resolved.runtime_resolution as Record<string, unknown>
  ).bin;

  resolved.session_routing =
    (resolved.session_routing as string) ?? "new";
  resolveSessionRouting(
    resolved,
    (resolved.artifacts_root as string) ?? "/tmp/claude-delegate-runs",
  );

  const [sessionId, resumeSessionId] = resolveSessionFields(
    resolved.session_id as string | null,
    resolved.resume_session_id as string | null,
  );

  const baseSystemPrompt =
    (resolved.base_system_prompt as string) ??
    (resolved.system_prompt as string) ??
    DEFAULT_SYSTEM_PROMPT;

  let parentHandoff = resolved.parent_handoff as Record<
    string,
    unknown
  > | null;
  if (parentHandoff == null) {
    const lineage = (resolved.lineage ?? {}) as Record<string, unknown>;
    const parentJobPath = lineage.parent_job_path as string | undefined;
    if (parentJobPath) {
      parentHandoff = loadParentHandoff(parentJobPath);
    }
  }

  const prompt = buildDelegatePrompt(taskPacket, {
    assistantRole,
    completionContract,
    deltaPrompt:
      (resolved.delta_prompt as string) ??
      ((resolved.lineage as Record<string, unknown>) ?? {})
        .delta_prompt as string | null ??
      null,
    parentHandoff,
  });
  const systemPrompt = buildSystemPrompt(baseSystemPrompt, assistantRole);

  return {
    assistant_role: assistantRole,
    base_system_prompt: baseSystemPrompt,
    completion_contract: completionContract,
    created_at: resolved.created_at,
    cwd: resolved.cwd,
    delta_prompt: resolved.delta_prompt ?? null,
    lineage: resolved.lineage ?? null,
    model: resolved.model,
    provider: resolved.provider,
    prompt,
    resume_session_id: resumeSessionId,
    routing: resolved.routing ?? null,
    runtime: resolved.runtime,
    runtime_bin: resolved.runtime_bin,
    runtime_config: resolved.runtime_config ?? null,
    runtime_resolution: resolved.runtime_resolution,
    schema: (completionContract as Record<string, unknown>).schema,
    session_id: sessionId,
    session_routing: resolved.session_routing ?? null,
    settings: resolved.settings,
    skip_ledger: resolved.skip_ledger,
    system_prompt: systemPrompt,
    task_packet: taskPacket,
    task_type: taskType,
    timeout_seconds: resolved.timeout_seconds,
    tools,
    workflow_roles: workflowRoles,
    workspace_identity: resolved.workspace_identity,
  };
}
