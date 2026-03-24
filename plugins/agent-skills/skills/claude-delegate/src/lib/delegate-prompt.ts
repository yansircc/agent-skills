import { DEFAULT_SYSTEM_PROMPT } from "./common.js";
import {
  compactParentHandoff,
  compactPriorStep,
  promptLiteral,
  renderStructuredItem,
  renderStructuredItems,
} from "./prompt-context.js";

export const ROLE_SYSTEM_INSTRUCTIONS: Record<string, string> = {
  supervisor:
    "You coordinate bounded work. Keep the contract explicit.",
  implementer:
    "You make bounded changes. Respect write scope and verification bounds.",
  explorer:
    "You gather context. Avoid edits unless the contract allows them.",
  critic:
    "You review for correctness, regressions, and boundary violations. Do not edit files.",
};

export const SHELL_EXECUTION_INSTRUCTIONS =
  "Shell commands must be non-interactive and alias-safe. " +
  "Do not wait for prompts. If input is unavoidable, provide it explicitly.";

export const REQUEST_CONTEXT_FIELD_SPECS: [string, string][] = [
  ["constraints", "Constraints:"],
  ["context", "Context:"],
  ["expected_artifacts", "Expected artifacts:"],
  ["review_focus", "Review focus:"],
  ["operator_notes", "Operator notes:"],
];

export function buildSystemPrompt(
  basePrompt: string | null,
  role: string,
): string {
  const prefix = (basePrompt ?? DEFAULT_SYSTEM_PROMPT).trim();
  return `${prefix}\n\n${ROLE_SYSTEM_INSTRUCTIONS[role]}\n\n${SHELL_EXECUTION_INSTRUCTIONS}`;
}

function renderRequestContext(
  lines: string[],
  taskPacket: Record<string, unknown>,
  deltaPrompt: string | null = null,
): void {
  for (const [fieldName, fieldLabel] of REQUEST_CONTEXT_FIELD_SPECS) {
    const value = taskPacket[fieldName] ?? [];
    if (Array.isArray(value) ? value.length > 0 : !!value) {
      lines.push(
        ...renderStructuredItems(
          fieldLabel,
          value as Record<string, unknown>[],
        ),
      );
    }
  }

  if (deltaPrompt) {
    lines.push(
      ...renderStructuredItems("Continuation:", [
        deltaPrompt as unknown as Record<string, unknown>,
      ]),
    );
  }
}

function appendMappingSection(
  lines: string[],
  title: string,
  values: Record<string, unknown>,
  fieldSpecs: [string, string, boolean][],
): void {
  const sectionLines: string[] = [];
  for (const [key, label, alwaysRender] of fieldSpecs) {
    if (!alwaysRender && !(key in values)) continue;
    const value = values[key] ?? null;
    if (value === null && !alwaysRender) continue;
    sectionLines.push(`- ${label}: ${promptLiteral(value)}`);
  }
  if (sectionLines.length > 0) {
    lines.push(title);
    lines.push(...sectionLines);
  }
}

export function renderPriorSteps(
  priorSteps: Record<string, unknown>[],
): string[] {
  return renderStructuredItems(
    "Prior steps:",
    priorSteps.map((step) => compactPriorStep(step)),
  );
}

export function buildDelegatePrompt(
  taskPacket: Record<string, unknown>,
  opts: {
    assistantRole: string;
    completionContract: Record<string, unknown>;
    deltaPrompt?: string | null;
    priorSteps?: Record<string, unknown>[] | null;
    parentHandoff?: Record<string, unknown> | null;
  },
): string {
  const lines: string[] = [
    `Role: ${opts.assistantRole}`,
    `Task type: ${taskPacket.task_type}`,
    `Goal: ${taskPacket.goal}`,
  ];

  renderRequestContext(lines, taskPacket, opts.deltaPrompt ?? null);

  const policy = taskPacket.execution_policy as Record<string, unknown>;
  appendMappingSection(lines, "Boundaries:", policy, [
    ["allow_edits", "allow_edits", true],
    ["allowed_write_paths", "allowed_write_paths", false],
    ["command_allowlist", "command_allowlist", false],
    ["exclude_globs", "exclude_globs", false],
    ["observe_roots", "observe_roots", false],
    ["workspace_mode", "workspace_mode", false],
    ["max_changed_files", "max_changed_files", false],
    ["max_turns", "max_turns", false],
    ["max_budget_usd", "max_budget_usd", false],
  ]);

  const verification = taskPacket.verification_contract as Record<
    string,
    unknown
  >;
  appendMappingSection(lines, "Verification:", verification, [
    ["auto", "auto", false],
    ["fail_on_error", "fail_on_error", false],
    ["commands", "commands", false],
  ]);

  lines.push(...renderPriorSteps(opts.priorSteps ?? []));

  if (opts.parentHandoff) {
    lines.push(
      ...renderStructuredItem(
        "Parent handoff:",
        compactParentHandoff(opts.parentHandoff),
      ),
    );
  }

  lines.push(`Output schema: ${opts.completionContract.name}`);
  lines.push("Return only JSON that matches the provided schema.");
  return lines.join("\n");
}
