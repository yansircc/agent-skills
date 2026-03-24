import { readFileSync } from "node:fs";

import { normalizeScopePaths } from "./workspace-identity.js";

export function readJsonInput(
  value: string | null,
  filePath: string | null,
  _label: string,
): Record<string, unknown> | null {
  if (value !== null && value !== undefined) {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (filePath !== null && filePath !== undefined) {
    return JSON.parse(
      readFileSync(filePath, "utf-8"),
    ) as Record<string, unknown>;
  }
  return null;
}

export function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function splitCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (
    base !== null &&
    typeof base === "object" &&
    !Array.isArray(base) &&
    override !== null &&
    typeof override === "object" &&
    !Array.isArray(override)
  ) {
    const merged = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(
      override as Record<string, unknown>,
    )) {
      merged[key] =
        key in merged ? deepMerge(merged[key], value) : value;
    }
    return merged;
  }
  return structuredClone(override);
}

export function defaultVerificationContract(
  role: string,
): Record<string, unknown> {
  return {
    auto: role === "implementer",
    commands: [],
    fail_on_error: role === "implementer",
  };
}

export function defaultExecutionPolicy(
  role: string,
  cwd: string,
  maxBudgetUsd: number | null,
): Record<string, unknown> {
  return {
    allow_edits: role === "implementer",
    allowed_write_paths: role === "implementer" ? [cwd] : [],
    command_allowlist: [],
    exclude_globs: ["**/__pycache__/**", "**/*.pyc", "**/*.pyo"],
    max_budget_usd: maxBudgetUsd,
    max_changed_files: null,
    max_turns: null,
    observe_roots: role === "implementer" ? [cwd] : [],
    workspace_mode: role === "implementer" ? "auto" : "shared",
  };
}

export function defaultTaskPacket(opts: {
  goal: string;
  cwd: string;
  role: string;
  taskType: string;
  workflowRoles: string[];
  tools: string | null;
  maxBudgetUsd: number | null;
}): Record<string, unknown> {
  return {
    goal: opts.goal,
    task_type: opts.taskType,
    constraints: [],
    context: [],
    expected_artifacts: [],
    operator_notes: [],
    review_focus: [],
    verification_contract: defaultVerificationContract(opts.role),
    execution_policy: defaultExecutionPolicy(
      opts.role,
      opts.cwd,
      opts.maxBudgetUsd,
    ),
    allowed_tools: splitCsv(opts.tools),
    assistant_role: opts.role,
    workflow_roles: opts.workflowRoles,
  };
}

export function defaultCompletionContract(
  role: string,
): Record<string, unknown> {
  const baseCompletion: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: [
          "completed",
          "blocked",
          "failed",
          "needs_review",
          "no_findings",
        ],
      },
      summary: { type: "string" },
      changed_files: { type: "array", items: { type: "string" } },
      diff_summary: { type: "array", items: { type: "string" } },
      test_commands: { type: "array", items: { type: "string" } },
      open_risks: { type: "array", items: { type: "string" } },
      files_examined: { type: "array", items: { type: "string" } },
      suggested_actions: { type: "array", items: { type: "string" } },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            severity: {
              type: "string",
              enum: ["critical", "high", "medium", "low"],
            },
            file: { type: "string" },
            line: { type: "integer" },
            issue: { type: "string" },
          },
          required: ["severity", "issue"],
        },
      },
    },
    required: ["status", "summary"],
  };

  if (role === "explorer") {
    baseCompletion.required = [
      "status",
      "summary",
      "files_examined",
      "findings",
      "suggested_actions",
    ];
  } else if (role === "critic") {
    baseCompletion.required = [
      "status",
      "summary",
      "findings",
      "open_risks",
    ];
  } else if (role === "supervisor") {
    (baseCompletion.properties as Record<string, unknown>).steps = {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: { type: "string" },
          job_path: { type: "string" },
          ok: { type: "boolean" },
          summary: { type: "string" },
        },
        required: ["role", "job_path", "ok", "summary"],
      },
    };
    baseCompletion.required = [
      "status",
      "summary",
      "steps",
      "open_risks",
    ];
  } else {
    baseCompletion.required = [
      "status",
      "summary",
      "changed_files",
      "diff_summary",
      "test_commands",
      "open_risks",
    ];
  }

  return {
    name: `${role}-completion-v1`,
    role,
    schema: baseCompletion,
  };
}

export function ensureCompletionContract(
  rawContract: Record<string, unknown> | null,
  role: string,
): Record<string, unknown> {
  if (rawContract === null || rawContract === undefined) {
    return defaultCompletionContract(role);
  }
  if ("schema" in rawContract) {
    const contract = structuredClone(rawContract);
    if (!("name" in contract)) contract.name = `${role}-completion-custom`;
    if (!("role" in contract)) contract.role = role;
    return contract;
  }
  if (rawContract.type === "object") {
    return {
      name: `${role}-completion-custom`,
      role,
      schema: structuredClone(rawContract),
    };
  }
  throw new Error(
    "Completion contract must be a JSON schema object or an object with a 'schema' field.",
  );
}

export function normalizeWorkflowRoles(
  rawRoles: string[],
  assistantRole: string,
): string[] {
  const roles = dedupeStrings(rawRoles);
  if (roles.length === 0) return [assistantRole];
  return roles;
}

export function normalizeTaskPacket(
  rawPacket: Record<string, unknown> | null,
  opts: {
    promptText: string | null;
    cwd: string;
    assistantRole: string;
    taskType: string;
    workflowRoles: string[];
    tools: string | null;
    maxBudgetUsd: number | null;
    deltaPrompt: string | null;
  },
): Record<string, unknown> {
  const rawGoal = (rawPacket ?? ({} as Record<string, unknown>)).goal;
  if (opts.promptText && rawGoal && opts.promptText !== rawGoal) {
    throw new Error(
      "Conflicting goals: --prompt and task_packet.goal must match.",
    );
  }

  let packet = defaultTaskPacket({
    goal:
      opts.promptText ??
      ((rawPacket ?? ({} as Record<string, unknown>)).goal as string) ??
      "",
    cwd: opts.cwd,
    role: opts.assistantRole,
    taskType: opts.taskType,
    workflowRoles: opts.workflowRoles,
    tools: opts.tools,
    maxBudgetUsd: opts.maxBudgetUsd,
  }) as Record<string, unknown>;

  if (rawPacket !== null && rawPacket !== undefined) {
    packet = deepMerge(packet, rawPacket) as Record<string, unknown>;
  }

  const executionPolicy = {
    ...((packet.execution_policy as Record<string, unknown>) ?? {}),
  };
  executionPolicy.allowed_write_paths = normalizeScopePaths(
    executionPolicy.allowed_write_paths,
    opts.cwd,
  );
  executionPolicy.observe_roots = normalizeScopePaths(
    executionPolicy.observe_roots,
    opts.cwd,
  );
  const workspaceMode = executionPolicy.workspace_mode;
  if (workspaceMode !== null && workspaceMode !== undefined) {
    executionPolicy.workspace_mode = String(workspaceMode).trim().toLowerCase();
  }
  packet.execution_policy = executionPolicy;

  packet.assistant_role = opts.assistantRole;
  packet.workflow_roles = opts.workflowRoles;
  packet.task_type = opts.taskType;
  packet.allowed_tools = dedupeStrings(
    (packet.allowed_tools as string[]) ?? [],
  );
  packet.constraints = dedupeStrings(
    (packet.constraints as string[]) ?? [],
  );
  packet.context = dedupeStrings((packet.context as string[]) ?? []);
  packet.expected_artifacts = dedupeStrings(
    (packet.expected_artifacts as string[]) ?? [],
  );
  packet.operator_notes = dedupeStrings(
    (packet.operator_notes as string[]) ?? [],
  );
  packet.review_focus = dedupeStrings(
    (packet.review_focus as string[]) ?? [],
  );
  return packet;
}
