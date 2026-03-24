import type { Options, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";

import { buildProcessEnv } from "./runtime-profiles.js";
import { bashGuardrail } from "./sdk-guardrails.js";

function normalizeExtraArgFlag(flag: string): string {
  let normalized = flag.trim();
  while (normalized.startsWith("-")) {
    normalized = normalized.slice(1);
  }
  if (!normalized) {
    throw new Error("Provider profile extra_args contains an empty flag.");
  }
  return normalized;
}

function argvToExtraArgs(argv: string[]): Record<string, string | null> {
  const parsed: Record<string, string | null> = {};
  let index = 0;
  while (index < argv.length) {
    let token = argv[index].trim();
    if (!token) {
      index += 1;
      continue;
    }

    if (token.startsWith("-")) {
      token = token.replace(/^-+/, "");
    }
    if (!token) {
      throw new Error(
        "Provider profile extra_args contains an empty flag token.",
      );
    }

    if (token.includes("=")) {
      const eqIdx = token.indexOf("=");
      const flag = token.slice(0, eqIdx);
      const value = token.slice(eqIdx + 1);
      parsed[normalizeExtraArgFlag(flag)] = value;
      index += 1;
      continue;
    }

    const nextValue =
      index + 1 < argv.length ? argv[index + 1].trim() : null;
    if (nextValue && !nextValue.startsWith("-")) {
      parsed[normalizeExtraArgFlag(token)] = nextValue;
      index += 2;
      continue;
    }

    parsed[normalizeExtraArgFlag(token)] = null;
    index += 1;
  }

  return parsed;
}

export function buildSdkOptions(
  request: Record<string, unknown>,
  opts?: {
    stderrCallback?: ((data: string) => void) | null;
  },
): Options {
  const runtimeResolution =
    (request.runtime_resolution as Record<string, unknown>) ?? {};
  const providerStrategy =
    (runtimeResolution.provider_strategy as Record<string, unknown>) ?? {};
  const executionPolicy =
    (
      ((request.task_packet as Record<string, unknown>) ?? {})
        .execution_policy as Record<string, unknown>
    ) ?? {};

  // Provider routing via extra_args (SDK has no native --provider)
  const extraArgs: Record<string, string | null> = {};
  const nativeProvider = providerStrategy.native_provider as string | null;
  if (nativeProvider) {
    extraArgs.provider = nativeProvider;
  }
  Object.assign(
    extraArgs,
    argvToExtraArgs((providerStrategy.extra_args as string[]) ?? []),
  );

  // Structured output schema
  const schema = request.schema as Record<string, unknown> | null | undefined;
  const outputFormat =
    schema == null
      ? undefined
      : { type: "json_schema" as const, schema };

  // CLI binary override (SDK defaults to bundled CLI)
  const runtimeBin =
    (request.runtime_bin as string) ??
    (runtimeResolution.bin as string) ??
    null;
  const pathToClaudeCodeExecutable =
    runtimeBin && runtimeBin !== "claude" ? runtimeBin : undefined;

  // Environment variables for provider routing
  const env = buildProcessEnv(request);

  // Hooks: bash guardrails as callback
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
    PreToolUse: [{ matcher: "Bash", hooks: [bashGuardrail] }],
  };

  // Tools
  const toolsValue = request.tools as string | null | undefined;
  let tools: string[] | undefined;
  if (toolsValue !== null && toolsValue !== undefined) {
    tools = toolsValue
      ? toolsValue.split(",").filter((t) => t)
      : [];
  }

  const executionWorkspace =
    (request.execution_workspace as Record<string, unknown>) ?? {};

  return {
    systemPrompt: request.system_prompt as string,
    model: (request.model as string) ?? undefined,
    tools,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    cwd:
      (executionWorkspace.execution_cwd as string) ??
      (request.cwd as string),
    pathToClaudeCodeExecutable: pathToClaudeCodeExecutable ?? undefined,
    resume: (request.resume_session_id as string) ?? undefined,
    maxBudgetUsd: (executionPolicy.max_budget_usd as number) ?? undefined,
    settings: (request.settings as string) ?? undefined,
    env,
    settingSources: [],
    includePartialMessages: true,
    hooks,
    extraArgs,
    thinking: { type: "enabled", budgetTokens: 10000 },
    stderr: opts?.stderrCallback ?? undefined,
    outputFormat,
  };
}
