import { execFileSync } from "node:child_process";
import path from "node:path";

export function normalizeCompletionFields(
  request: Record<string, unknown>,
  envelope: Record<string, unknown>,
  workspaceChanges: Record<string, unknown>[],
): Record<string, unknown> {
  const completion =
    (envelope.structured_output as Record<string, unknown>) ?? {};
  const taskPacket = request.task_packet as Record<string, unknown>;
  const completionContract = request.completion_contract as Record<
    string,
    unknown
  >;

  envelope.assistant_role = request.assistant_role;
  envelope.task_type = taskPacket.task_type;
  envelope.completion_contract = {
    name: completionContract.name,
    role: completionContract.role,
  };
  envelope.completion = completion;
  envelope.workflow_roles = (request.workflow_roles as string[]) ?? [
    request.assistant_role as string,
  ];
  envelope.lineage = request.lineage ?? null;
  envelope.workspace_changes = workspaceChanges;
  envelope.changed_files = workspaceChanges.map(
    (item) => item.relative_path as string,
  );
  envelope.declared_changed_files =
    (completion.changed_files as string[]) ?? [];
  envelope.diff_summary = (completion.diff_summary as unknown[]) ?? [];
  envelope.open_risks = (completion.open_risks as unknown[]) ?? [];
  envelope.test_commands = (completion.test_commands as unknown[]) ?? [];
  envelope.findings = (completion.findings as unknown[]) ?? [];
  envelope.files_examined = (completion.files_examined as unknown[]) ?? [];
  envelope.suggested_actions =
    (completion.suggested_actions as unknown[]) ?? [];
  return envelope;
}

function withinAllowed(
  filePath: string,
  allowed: string[],
  cwd: string,
): boolean {
  const resolved = path.resolve(filePath);
  for (const allowedPath of allowed) {
    const allowedResolved = path.isAbsolute(allowedPath)
      ? path.resolve(allowedPath)
      : path.resolve(cwd, allowedPath);
    if (
      resolved === allowedResolved ||
      resolved.startsWith(allowedResolved + path.sep)
    ) {
      return true;
    }
  }
  return false;
}

export function evaluateExecutionPolicy(
  request: Record<string, unknown>,
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  const taskPacket = request.task_packet as Record<string, unknown>;
  const policy = taskPacket.execution_policy as Record<string, unknown>;
  const violations: Record<string, unknown>[] = [];
  const changes = (envelope.workspace_changes ?? []) as Record<
    string,
    unknown
  >[];
  const role = request.assistant_role as string;

  if (!policy.allow_edits && changes.length > 0) {
    violations.push({
      kind: "unexpected_edits",
      message: `${role} is not allowed to edit files`,
    });
  }

  const allowedWritePaths = (policy.allowed_write_paths ?? []) as string[];
  if (allowedWritePaths.length > 0) {
    for (const item of changes) {
      if (
        !withinAllowed(
          item.path as string,
          allowedWritePaths,
          request.cwd as string,
        )
      ) {
        violations.push({
          kind: "write_scope_violation",
          message: `Changed file outside allowed write paths: ${item.relative_path}`,
          path: item.path,
        });
      }
    }
  }

  const maxChangedFiles = policy.max_changed_files;
  if (
    typeof maxChangedFiles === "number" &&
    Number.isInteger(maxChangedFiles) &&
    changes.length > maxChangedFiles
  ) {
    violations.push({
      kind: "max_changed_files_exceeded",
      message: `Changed ${changes.length} files, limit is ${maxChangedFiles}`,
    });
  }

  const maxTurns = policy.max_turns;
  if (
    typeof maxTurns === "number" &&
    Number.isInteger(maxTurns) &&
    typeof envelope.num_turns === "number" &&
    envelope.num_turns > maxTurns
  ) {
    violations.push({
      kind: "max_turns_exceeded",
      message: `Used ${envelope.num_turns} turns, limit is ${maxTurns}`,
    });
  }

  const maxBudget = policy.max_budget_usd;
  if (
    typeof maxBudget === "number" &&
    typeof envelope.total_cost_usd === "number"
  ) {
    if (envelope.total_cost_usd > maxBudget) {
      violations.push({
        kind: "max_budget_exceeded",
        message: `Spent ${envelope.total_cost_usd}, limit is ${maxBudget}`,
      });
    }
  }

  const allowlist = (policy.command_allowlist ?? []) as string[];
  if (allowlist.length > 0) {
    const toolUses = (envelope.tool_uses ?? []) as Record<string, unknown>[];
    for (const toolUse of toolUses) {
      if (toolUse.name !== "Bash") continue;
      const command =
        ((toolUse.input as Record<string, unknown>) ?? {}).command ?? "";
      if (typeof command !== "string") continue;
      if (
        !allowlist.some(
          (prefix) =>
            command === prefix || command.startsWith(`${prefix} `),
        )
      ) {
        violations.push({
          kind: "command_allowlist_violation",
          message: `Command outside allowlist: ${command}`,
        });
      }
    }
  }

  const status = violations.length === 0 ? "passed" : "violated";
  return { status, violations };
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function deriveVerificationCommands(
  request: Record<string, unknown>,
  envelope: Record<string, unknown>,
): string[] {
  const taskPacket = request.task_packet as Record<string, unknown>;
  const verificationContract = taskPacket.verification_contract as Record<
    string,
    unknown
  >;
  const commands = [
    ...((verificationContract.commands ?? []) as string[]),
  ];

  if (commands.length === 0 && verificationContract.auto) {
    const workspaceChanges = (envelope.workspace_changes ?? []) as Record<
      string,
      unknown
    >[];
    const changedFiles = workspaceChanges.map(
      (item) => item.relative_path as string,
    );
    const pythonFiles = changedFiles.filter((item) => item.endsWith(".py"));
    if (pythonFiles.length > 0) {
      const quoted = pythonFiles.map(shellQuote).join(" ");
      commands.push(`python3 -m py_compile ${quoted}`);
    }
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const command of commands) {
    if (seen.has(command)) continue;
    seen.add(command);
    deduped.push(command);
  }
  return deduped;
}

export function runVerification(
  request: Record<string, unknown>,
  envelope: Record<string, unknown>,
  opts?: { executionCwd?: string },
): Record<string, unknown> {
  const taskPacket = request.task_packet as Record<string, unknown>;
  const verificationContract = taskPacket.verification_contract as Record<
    string,
    unknown
  >;
  const commands = deriveVerificationCommands(request, envelope);

  if (commands.length === 0) {
    return {
      status: "skipped",
      fail_on_error: verificationContract.fail_on_error ?? false,
      commands: [],
      results: [],
    };
  }

  const results: Record<string, unknown>[] = [];
  let failed = false;
  const cwd = opts?.executionCwd ?? (request.cwd as string);

  for (const command of commands) {
    let exitCode: number;
    let stdout = "";
    let stderr = "";
    try {
      const output = execFileSync("/bin/zsh", ["-lc", command], {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      });
      stdout = output;
      exitCode = 0;
    } catch (err) {
      const execErr = err as {
        status?: number;
        stdout?: string;
        stderr?: string;
      };
      exitCode = execErr.status ?? 1;
      stdout = execErr.stdout ?? "";
      stderr = execErr.stderr ?? "";
    }

    if (exitCode !== 0) failed = true;
    results.push({
      command,
      exit_code: exitCode,
      ok: exitCode === 0,
      stdout,
      stderr,
    });
  }

  return {
    status: failed ? "failed" : "passed",
    fail_on_error: verificationContract.fail_on_error ?? false,
    commands,
    results,
  };
}
