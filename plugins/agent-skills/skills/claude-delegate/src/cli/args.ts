import { readFileSync } from "node:fs";
import { Command } from "commander";

import { ROLE_SYSTEM_INSTRUCTIONS } from "../lib/delegate-prompt.js";
import { deepMerge, splitCsv } from "../lib/contracts.js";

export function readText(
  value: string | null | undefined,
  filePath: string | null | undefined,
  label: string,
): string | null {
  if (value != null) return value;
  if (filePath != null) return readFileSync(filePath, "utf-8");
  if (label === "prompt" && !process.stdin.isTTY) {
    // stdin reading handled at call site — return null here
    return null;
  }
  return null;
}

export function validateRole(role: string): string {
  if (!(role in ROLE_SYSTEM_INSTRUCTIONS)) {
    throw new Error(`Unsupported assistant role: ${role}`);
  }
  return role;
}

export function lineageAction(opts: {
  resumeJob?: string;
  forkJob?: string;
  retryJob?: string;
}): [string | null, string | null] {
  const actions: [string, string | undefined][] = [
    ["resume", opts.resumeJob],
    ["fork", opts.forkJob],
    ["retry", opts.retryJob],
  ];
  const selected = actions.filter(([, v]) => v);
  if (selected.length > 1) {
    throw new Error(
      "Use only one of --resume-job, --fork-job, or --retry-job.",
    );
  }
  if (selected.length === 0) return [null, null];
  return [selected[0][0], selected[0][1]!];
}

export function applyCliOverrides(
  request: Record<string, unknown>,
  opts: Record<string, unknown>,
  extras: {
    promptText: string | null;
    deltaPrompt: string | null;
    rawTaskPacket: Record<string, unknown> | null;
    rawCompletionContract: Record<string, unknown> | null;
  },
): Record<string, unknown> {
  const updated = structuredClone(request);

  if (opts.runtime != null) updated.runtime = opts.runtime;
  if (opts.runtimeBin != null) updated.runtime_bin = opts.runtimeBin;
  if (opts.runtimeConfig != null)
    updated.runtime_config = opts.runtimeConfig;
  if (opts.cccBin != null) updated.runtime_bin = opts.cccBin;
  if (opts.cwd != null) updated.cwd = opts.cwd;
  if (opts.provider != null) updated.provider = opts.provider;
  if (opts.model != null) updated.model = opts.model;
  if (opts.tools != null) updated.tools = opts.tools;
  if (opts.systemPrompt != null)
    updated.base_system_prompt = opts.systemPrompt;
  if (opts.settings != null) updated.settings = opts.settings;
  if (opts.timeoutSeconds != null)
    updated.timeout_seconds = opts.timeoutSeconds;
  if (opts.assistantRole != null)
    updated.assistant_role = opts.assistantRole;
  if (opts.workflowRoles != null)
    updated.workflow_roles = splitCsv(opts.workflowRoles as string);
  if (opts.taskType != null) updated.task_type = opts.taskType;
  if (opts.maxBudgetUsd != null)
    updated.max_budget_usd = opts.maxBudgetUsd;
  if (opts.artifactsRoot != null)
    updated.artifacts_root = opts.artifactsRoot;
  if (opts.sessionId != null) updated.session_id = opts.sessionId;
  if (opts.resumeSessionId != null)
    updated.resume_session_id = opts.resumeSessionId;
  if (opts.sessionRouting != null)
    updated.session_routing = opts.sessionRouting;
  if (extras.promptText != null) updated.goal = extras.promptText;
  if (extras.deltaPrompt != null)
    updated.delta_prompt = extras.deltaPrompt;
  if (extras.rawTaskPacket != null) {
    updated.task_packet = deepMerge(
      updated.task_packet,
      extras.rawTaskPacket,
    );
  }
  if (extras.rawCompletionContract != null)
    updated.completion_contract = extras.rawCompletionContract;
  return updated;
}

export function buildProgram(): Command {
  const program = new Command()
    .description(
      "Run a local Claude-compatible CLI runtime through a stable JSON envelope.",
    )
    .option("--submit", "Submit a background job")
    .option("--status", "Get job status")
    .option("--wait", "Wait for a single job")
    .option("--wait-any", "Wait for any of multiple jobs")
    .option("--wait-all", "Wait for all of multiple jobs")
    .option("--cancel", "Cancel a running job")
    .option("--pause", "Pause a running job")
    .option("--ledger", "List ledger entries")
    .option("--ledger-stats", "Show ledger statistics")
    .option("--list-sessions", "List sessions")
    .option(
      "--prune-terminal-older-than-hours <hours>",
      "Prune terminal jobs older than N hours",
      parseFloat,
    )
    .option(
      "--compact-terminal-older-than-hours <hours>",
      "Compact terminal job artifacts older than N hours",
      parseFloat,
    )
    .option("--job-worker", "Internal: run as worker process")
    .option("--runtime <runtime>", "Runtime name", process.env.CLAUDE_DELEGATE_RUNTIME)
    .option(
      "--runtime-bin <path>",
      "Runtime binary path",
      process.env.CLAUDE_DELEGATE_RUNTIME_BIN,
    )
    .option(
      "--runtime-config <path>",
      "Runtime config path",
      process.env.CLAUDE_DELEGATE_RUNTIME_CONFIG,
    )
    .option("--ccc-bin <path>", undefined, process.env.CCC_BIN)
    .option("--cwd <dir>", "Working directory")
    .option("--provider <provider>", "Provider name")
    .option("--model <model>", "Model name")
    .option("--tools <tools>", "Comma-separated tool list")
    .option("--system-prompt <prompt>", "System prompt")
    .option("--settings <json>", "Settings JSON string")
    .option("--timeout-seconds <seconds>", "Timeout in seconds", parseInt)
    .option(
      "--artifacts-root <dir>",
      "Artifacts root directory",
      "/tmp/claude-delegate-runs",
    )
    .option("--session-id <id>", "Session ID")
    .option("--resume-session-id <id>", "Resume session ID")
    .option(
      "--session-routing <mode>",
      "Session routing mode (new|auto)",
    )
    .option("--resume-job <path>", "Resume from job path")
    .option("--fork-job <path>", "Fork from job path")
    .option("--retry-job <path>", "Retry from job path")
    .option("--job-path <path>", "Job path(s)", collect, [])
    .option("--prompt <text>", "Prompt text")
    .option("--prompt-file <path>", "Prompt file path")
    .option("--schema-json <json>", "Schema JSON string")
    .option("--schema-file <path>", "Schema file path")
    .option(
      "--assistant-role <role>",
      "Assistant role",
    )
    .option("--workflow-roles <roles>", "Comma-separated workflow roles")
    .option("--task-type <type>", "Task type")
    .option("--task-packet-json <json>", "Task packet JSON string")
    .option("--task-packet-file <path>", "Task packet file path")
    .option(
      "--completion-contract-json <json>",
      "Completion contract JSON string",
    )
    .option(
      "--completion-contract-file <path>",
      "Completion contract file path",
    )
    .option("--delta-prompt <text>", "Delta prompt text")
    .option("--delta-prompt-file <path>", "Delta prompt file path")
    .option(
      "--max-budget-usd <amount>",
      "Max budget in USD",
      parseFloat,
    )
    .option("--startup-fd <fd>", "Internal: startup FD", parseInt)
    .option("--ledger-limit <n>", "Ledger listing limit", parseInt, 20)
    .option("--ledger-session-id <id>", "Filter ledger by session ID")
    .option("--ledger-runtime <runtime>", "Filter ledger by runtime")
    .option("--ledger-provider <provider>", "Filter ledger by provider")
    .option("--ledger-state <state>", "Filter ledger by state")
    .option(
      "--list-sessions-limit <n>",
      "Sessions listing limit",
      parseInt,
    )
    .option("--list-sessions-cwd <dir>", "Filter sessions by cwd")
    .option(
      "--list-sessions-provider <provider>",
      "Filter sessions by provider",
    )
    .option(
      "--list-sessions-runtime <runtime>",
      "Filter sessions by runtime",
    )
    .option(
      "--list-sessions-state <state>",
      "Filter sessions by state",
    )
    .option(
      "--list-sessions-role <role>",
      "Filter sessions by assistant role",
    )
    .option(
      "--list-sessions-task-type <type>",
      "Filter sessions by task type",
    );

  return program;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function determineMode(
  opts: Record<string, unknown>,
): string {
  if (opts.jobWorker) return "worker";
  if (opts.submit) return "submit";
  if (opts.status) return "status";
  if (opts.wait) return "wait";
  if (opts.waitAny) return "wait_any";
  if (opts.waitAll) return "wait_all";
  if (opts.cancel) return "cancel";
  if (opts.pause) return "pause";
  if (opts.ledger) return "ledger";
  if (opts.ledgerStats) return "ledger_stats";
  if (opts.listSessions) return "list_sessions";
  if (opts.pruneTerminalOlderThanHours != null) return "prune";
  if (opts.compactTerminalOlderThanHours != null) return "compact";
  return "run";
}
