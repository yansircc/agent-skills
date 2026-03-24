import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HookCallback, HookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseRefFrontmatter(
  filePath: string,
): [string | null, string, string | null, string | null] {
  const text = readFileSync(filePath, "utf-8");
  let matchVal: string | null = null;
  let action = "inject";
  let message: string | null = null;
  let title: string | null = null;

  let inFm = false;
  for (const line of text.split("\n")) {
    const stripped = line.trim();
    if (stripped === "---") {
      if (!inFm) {
        inFm = true;
        continue;
      } else {
        inFm = false;
        continue;
      }
    }
    if (inFm) {
      if (stripped.startsWith("match:")) {
        matchVal = stripped.slice("match:".length).trim();
      } else if (stripped.startsWith("action:")) {
        action = stripped.slice("action:".length).trim() || "inject";
      } else if (stripped.startsWith("message:")) {
        message = stripped.slice("message:".length).trim() || null;
      }
    } else if (stripped.startsWith("# ") && title === null) {
      title = stripped.slice(2).trim() || null;
    }
  }

  return [matchVal, action, message, title];
}

export const bashGuardrail: HookCallback = async (
  input: HookInput,
  _toolUseId: string | undefined,
  _options: { signal: AbortSignal },
): Promise<SyncHookJSONOutput> => {
  if (input.hook_event_name !== "PreToolUse") return {};

  const toolInput = ((input as Record<string, unknown>).tool_input ?? {}) as Record<string, unknown>;
  const command = (toolInput.command as string) ?? "";
  if (!command) return {};

  // Navigate from compiled dist/lib/ up to project root, then into references/bash
  const refsDir = path.resolve(__dirname, "..", "..", "references", "bash");
  if (!existsSync(refsDir)) return {};

  const warnings: string[] = [];
  const blocks: string[] = [];

  const refFiles = readdirSync(refsDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  for (const refFile of refFiles) {
    const refPath = path.join(refsDir, refFile);
    const [matchPattern, action, message, title] =
      parseRefFrontmatter(refPath);
    if (matchPattern === null) continue;
    if (!new RegExp(matchPattern).test(command)) continue;

    if (action === "block") {
      let label = message ?? `See ${refFile}`;
      if (title) label += ` (${title})`;
      blocks.push(label);
    } else {
      let label = `\u26a0\ufe0f Read ${refPath}`;
      if (title) label += ` \u2014 ${title}`;
      warnings.push(label);
    }
  }

  if (blocks.length > 0) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: "BLOCKED:\n" + blocks.join("\n"),
      },
    };
  }
  if (warnings.length > 0) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        additionalContext: warnings.join("\n"),
      },
    };
  }
  return {};
};
