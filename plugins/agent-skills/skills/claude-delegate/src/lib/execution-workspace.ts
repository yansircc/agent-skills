import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { gitRepoIsClean, gitRepoRoot } from "./workspace-identity.js";

const SUPPORTED_WORKSPACE_MODES = new Set([
  "auto",
  "shared",
  "copy",
  "worktree",
]);

export interface ExecutionWorkspace {
  requestedMode: string;
  mode: string;
  sourceCwd: string;
  sourceRoot: string;
  executionCwd: string;
  executionRoot: string;
  sourceRepoRoot: string | null;
  cleanupRoot: string | null;
  cleanedUp: boolean;
  cleanupError: string | null;
}

export function resolveSourcePath(
  ws: ExecutionWorkspace,
  rawPath: string,
): string {
  const p = path.isAbsolute(rawPath)
    ? rawPath
    : path.join(ws.sourceCwd, rawPath);
  return path.resolve(p);
}

export function mapSourceToExecution(
  ws: ExecutionWorkspace,
  sourcePath: string,
): string {
  const resolved = path.resolve(sourcePath);
  const sourceRoot = path.resolve(ws.sourceRoot);
  const rel = path.relative(sourceRoot, resolved);
  if (rel.startsWith("..") && resolved !== sourceRoot) {
    throw new Error(
      `Path is outside execution workspace source root: ${resolved}`,
    );
  }
  return path.resolve(ws.executionRoot, rel);
}

export function mapExecutionToSource(
  ws: ExecutionWorkspace,
  executionPath: string,
): string {
  const resolved = path.resolve(executionPath);
  const executionRoot = path.resolve(ws.executionRoot);
  const rel = path.relative(executionRoot, resolved);
  if (rel.startsWith("..") && resolved !== executionRoot) {
    throw new Error(
      `Path is outside execution workspace root: ${resolved}`,
    );
  }
  return path.resolve(ws.sourceRoot, rel);
}

export function displayPath(ws: ExecutionWorkspace, rawPath: string): string {
  const executionPath = mapSourceToExecution(ws, resolveSourcePath(ws, rawPath));
  const executionCwd = path.resolve(ws.executionCwd);
  if (executionPath === executionCwd) return ".";
  const rel = path.relative(executionCwd, executionPath);
  return rel.startsWith("..") ? executionPath : rel;
}

export function cleanupWorkspace(ws: ExecutionWorkspace): void {
  if (ws.cleanupRoot === null || ws.cleanedUp) return;

  try {
    if (ws.mode === "worktree") {
      execFileSync(
        "git",
        [
          "-C",
          ws.sourceRepoRoot ?? ws.sourceRoot,
          "worktree",
          "remove",
          "--force",
          ws.cleanupRoot,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    } else {
      rmSync(ws.cleanupRoot, { recursive: true, force: true });
    }
    ws.cleanedUp = true;
  } catch (exc) {
    ws.cleanupError = String(exc);
  }
}

export function workspaceToDict(
  ws: ExecutionWorkspace,
): Record<string, unknown> {
  return {
    requested_mode: ws.requestedMode,
    mode: ws.mode,
    source_cwd: ws.sourceCwd,
    source_root: ws.sourceRoot,
    execution_cwd: ws.executionCwd,
    execution_root: ws.executionRoot,
    source_repo_root: ws.sourceRepoRoot,
    cleanup_root: ws.cleanupRoot,
    cleaned_up: ws.cleanedUp,
    cleanup_error: ws.cleanupError,
  };
}

function requestedWorkspaceMode(request: Record<string, unknown>): string {
  const taskPacket = (request.task_packet ?? {}) as Record<string, unknown>;
  const policy = (taskPacket.execution_policy ?? {}) as Record<
    string,
    unknown
  >;
  const rawMode = policy.workspace_mode;
  if (rawMode === null || rawMode === undefined) {
    return request.assistant_role === "implementer" ? "auto" : "shared";
  }
  const mode = String(rawMode).trim().toLowerCase();
  if (!SUPPORTED_WORKSPACE_MODES.has(mode)) {
    throw new Error(`Unsupported workspace_mode: ${rawMode}`);
  }
  return mode;
}

function makeWorkspace(fields: Omit<ExecutionWorkspace, "cleanedUp" | "cleanupError">): ExecutionWorkspace {
  return { ...fields, cleanedUp: false, cleanupError: null };
}

function sharedWorkspace(
  sourceCwd: string,
  sourceRoot: string,
  requestedMode: string,
  repoRoot: string | null,
): ExecutionWorkspace {
  return makeWorkspace({
    requestedMode,
    mode: "shared",
    sourceCwd,
    sourceRoot,
    executionCwd: sourceCwd,
    executionRoot: sourceRoot,
    sourceRepoRoot: repoRoot,
    cleanupRoot: null,
  });
}

function copyWorkspace(opts: {
  sourceCwd: string;
  sourceRoot: string;
  requestedMode: string;
  repoRoot: string | null;
}): ExecutionWorkspace {
  const copyRoot = path.resolve(
    mkdtempSync(path.join(tmpdir(), "claude-delegate-copy-")),
  );
  // mkdtemp creates the directory; remove it so cpSync can use it as destination
  rmSync(copyRoot, { recursive: true, force: true });
  cpSync(opts.sourceRoot, copyRoot, { recursive: true });
  const rel = path.relative(
    path.resolve(opts.sourceRoot),
    path.resolve(opts.sourceCwd),
  );
  const executionCwd = path.resolve(copyRoot, rel);
  return makeWorkspace({
    requestedMode: opts.requestedMode,
    mode: "copy",
    sourceCwd: opts.sourceCwd,
    sourceRoot: opts.sourceRoot,
    executionCwd,
    executionRoot: copyRoot,
    sourceRepoRoot: opts.repoRoot,
    cleanupRoot: copyRoot,
  });
}

function worktreeWorkspace(opts: {
  sourceCwd: string;
  repoRoot: string;
  requestedMode: string;
}): ExecutionWorkspace {
  const worktreeRoot = path.resolve(
    mkdtempSync(path.join(tmpdir(), "claude-delegate-worktree-")),
  );
  execFileSync(
    "git",
    [
      "-C",
      opts.repoRoot,
      "worktree",
      "add",
      "--detach",
      worktreeRoot,
      "HEAD",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const rel = path.relative(
    path.resolve(opts.repoRoot),
    path.resolve(opts.sourceCwd),
  );
  const executionCwd = path.resolve(worktreeRoot, rel);
  return makeWorkspace({
    requestedMode: opts.requestedMode,
    mode: "worktree",
    sourceCwd: opts.sourceCwd,
    sourceRoot: opts.repoRoot,
    executionCwd,
    executionRoot: worktreeRoot,
    sourceRepoRoot: opts.repoRoot,
    cleanupRoot: worktreeRoot,
  });
}

export function prepareExecutionWorkspace(
  request: Record<string, unknown>,
): ExecutionWorkspace {
  const sourceCwd = path.resolve(request.cwd as string);
  const repoRoot = gitRepoRoot(sourceCwd);
  const sourceRoot = repoRoot ?? sourceCwd;
  const mode = requestedWorkspaceMode(request);

  if (mode === "shared") {
    return sharedWorkspace(sourceCwd, sourceRoot, mode, repoRoot);
  }

  if (mode === "copy") {
    return copyWorkspace({
      sourceCwd,
      sourceRoot,
      requestedMode: mode,
      repoRoot,
    });
  }

  if (mode === "worktree") {
    if (repoRoot === null) {
      throw new Error("workspace_mode=worktree requires a git repository.");
    }
    if (!gitRepoIsClean(repoRoot)) {
      throw new Error(
        "workspace_mode=worktree requires a clean git repository; " +
          "dirty and untracked state are not yet seeded into worktrees.",
      );
    }
    return worktreeWorkspace({
      sourceCwd,
      repoRoot,
      requestedMode: mode,
    });
  }

  // auto mode
  if (request.assistant_role !== "implementer") {
    return sharedWorkspace(sourceCwd, sourceRoot, mode, repoRoot);
  }

  if (repoRoot !== null && gitRepoIsClean(repoRoot)) {
    return worktreeWorkspace({
      sourceCwd,
      repoRoot,
      requestedMode: mode,
    });
  }

  return copyWorkspace({
    sourceCwd,
    sourceRoot,
    requestedMode: mode,
    repoRoot,
  });
}

export function buildExecutionTaskPacket(
  taskPacket: Record<string, unknown>,
  workspace: ExecutionWorkspace,
): Record<string, unknown> {
  const packet = structuredClone(taskPacket);
  const policy = structuredClone(
    (packet.execution_policy ?? {}) as Record<string, unknown>,
  );
  for (const key of ["allowed_write_paths", "observe_roots"] as const) {
    if (key in policy) {
      policy[key] = ((policy[key] ?? []) as string[]).map((item) =>
        displayPath(workspace, item),
      );
    }
  }
  packet.execution_policy = policy;
  return packet;
}
