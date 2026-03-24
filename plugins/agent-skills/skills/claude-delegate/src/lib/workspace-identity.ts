import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { sortedStringify } from "./common.js";

export function gitRepoRoot(cwd: string): string | null {
  try {
    const stdout = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const root = stdout.trim();
    return root ? path.resolve(root) : null;
  } catch {
    return null;
  }
}

export function gitRepoIsClean(repoRoot: string): boolean {
  try {
    const stdout = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      { cwd: repoRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return !stdout.trim();
  } catch {
    return false;
  }
}

export function normalizeScopePaths(
  rawPaths: unknown,
  cwd: string,
): string[] {
  if (!Array.isArray(rawPaths)) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  const base = path.resolve(cwd);

  for (const rawPath of rawPaths) {
    if (typeof rawPath !== "string" || !rawPath.trim()) continue;
    const resolved = path.resolve(base, rawPath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }

  return result;
}

export interface WorkspaceIdentity {
  workspace_id: string;
  cwd: string;
  source_root: string;
  source_repo_root: string | null;
  repo_is_clean: boolean | null;
  workspace_mode: string | null;
  observe_roots: string[];
  allowed_write_paths: string[];
}

export function buildWorkspaceIdentity(opts: {
  cwd: string;
  executionPolicy: Record<string, unknown> | null;
}): WorkspaceIdentity {
  const sourceCwd = path.resolve(opts.cwd);
  const sourceRepoRoot = gitRepoRoot(sourceCwd);
  const sourceRoot = sourceRepoRoot ?? sourceCwd;
  const policy = opts.executionPolicy ?? {};

  let workspaceMode: string | null = null;
  const rawMode = policy.workspace_mode;
  if (rawMode !== null && rawMode !== undefined) {
    workspaceMode = String(rawMode).trim().toLowerCase();
  }

  const observeRoots = normalizeScopePaths(policy.observe_roots, sourceCwd);
  const allowedWritePaths = normalizeScopePaths(
    policy.allowed_write_paths,
    sourceCwd,
  );

  const material = {
    allowed_write_paths: allowedWritePaths,
    cwd: sourceCwd,
    observe_roots: observeRoots,
    source_root: sourceRoot,
    workspace_mode: workspaceMode,
  };
  const workspaceId = createHash("sha256")
    .update(sortedStringify(material, 0))
    .digest("hex")
    .slice(0, 16);

  return {
    workspace_id: workspaceId,
    cwd: sourceCwd,
    source_root: sourceRoot,
    source_repo_root: sourceRepoRoot,
    repo_is_clean:
      sourceRepoRoot !== null ? gitRepoIsClean(sourceRepoRoot) : null,
    workspace_mode: workspaceMode,
    observe_roots: observeRoots,
    allowed_write_paths: allowedWritePaths,
  };
}
