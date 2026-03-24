import { readJsonInput, splitCsv } from "../lib/contracts.js";
import { deriveRequestFromJob } from "../lib/lineage.js";
import { finalizeRequest } from "../lib/request.js";
import { applyCliOverrides, lineageAction, readText } from "./args.js";

export { finalizeRequest } from "../lib/request.js";

export function buildRequest(
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const promptText = readText(
    opts.prompt as string | undefined,
    opts.promptFile as string | undefined,
    "prompt",
  );
  const deltaPrompt = readText(
    opts.deltaPrompt as string | undefined,
    opts.deltaPromptFile as string | undefined,
    "delta",
  );
  const rawTaskPacket = readJsonInput(
    (opts.taskPacketJson as string) ?? null,
    (opts.taskPacketFile as string) ?? null,
    "task packet",
  );

  if (opts.schemaJson && opts.completionContractJson) {
    throw new Error(
      "Use either --schema-json or --completion-contract-json, not both.",
    );
  }
  if (opts.schemaFile && opts.completionContractFile) {
    throw new Error(
      "Use either --schema-file or --completion-contract-file, not both.",
    );
  }

  const rawCompletionContract = readJsonInput(
    ((opts.completionContractJson as string) ??
      (opts.schemaJson as string)) ??
      null,
    ((opts.completionContractFile as string) ??
      (opts.schemaFile as string)) ??
      null,
    "completion contract",
  );

  const [action, sourceJobPath] = lineageAction({
    resumeJob: opts.resumeJob as string | undefined,
    forkJob: opts.forkJob as string | undefined,
    retryJob: opts.retryJob as string | undefined,
  });

  if (action !== null && sourceJobPath !== null) {
    if (opts.sessionId && opts.resumeSessionId) {
      throw new Error(
        "Use either --session-id or --resume-session-id, not both.",
      );
    }
    let request = deriveRequestFromJob(sourceJobPath, {
      action,
      deltaPrompt,
    });
    request = applyCliOverrides(request, opts, {
      promptText,
      deltaPrompt,
      rawTaskPacket,
      rawCompletionContract,
    });
    return finalizeRequest(request);
  }

  const request: Record<string, unknown> = {
    assistant_role: opts.assistantRole ?? null,
    artifacts_root: opts.artifactsRoot ?? null,
    base_system_prompt: opts.systemPrompt ?? null,
    completion_contract: rawCompletionContract,
    cwd: opts.cwd ?? null,
    delta_prompt: deltaPrompt,
    goal: promptText,
    lineage: null,
    max_budget_usd: opts.maxBudgetUsd ?? null,
    model: opts.model ?? null,
    runtime: opts.runtime ?? null,
    runtime_bin: (opts.runtimeBin as string) ?? (opts.cccBin as string) ?? null,
    runtime_config: opts.runtimeConfig ?? null,
    provider: opts.provider ?? null,
    resume_session_id: opts.resumeSessionId ?? null,
    session_routing: opts.sessionRouting ?? null,
    session_id: opts.sessionId ?? null,
    settings: opts.settings ?? null,
    skip_ledger: false,
    task_packet: rawTaskPacket,
    task_type: opts.taskType ?? null,
    timeout_seconds: opts.timeoutSeconds ?? null,
    tools: opts.tools ?? null,
    workflow_roles: opts.workflowRoles
      ? splitCsv(opts.workflowRoles as string)
      : [],
  };
  return finalizeRequest(request);
}
