import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

import type { ExecutionWorkspace } from "./execution-workspace.js";
import {
  mapExecutionToSource,
  mapSourceToExecution,
  resolveSourcePath,
} from "./execution-workspace.js";

/** Maximum file size (bytes) to include content in snapshot for patch generation. */
const MAX_CONTENT_SIZE = 1024 * 1024; // 1 MB

function fingerprint(filePath: string): Record<string, unknown> {
  const hasher = createHash("sha1");
  const data = readFileSync(filePath);
  hasher.update(data);
  const stat = statSync(filePath);
  return {
    mtime_ns: Math.round(stat.mtimeMs * 1e6),
    sha1: hasher.digest("hex"),
    size: stat.size,
  };
}

function captureContent(filePath: string): string | null {
  const stat = statSync(filePath);
  if (stat.size > MAX_CONTENT_SIZE) return null;
  try {
    const buf = readFileSync(filePath);
    // Reject non-UTF-8: decode with throw option equivalent
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return text;
  } catch {
    return null;
  }
}

export function hasSemanticChange(
  beforeEntry: Record<string, unknown> | null,
  afterEntry: Record<string, unknown> | null,
): boolean {
  if ((beforeEntry === null) !== (afterEntry === null)) return true;
  if (beforeEntry === null) return false;
  return (
    beforeEntry.sha1 !== afterEntry!.sha1 ||
    beforeEntry.size !== afterEntry!.size
  );
}

function shouldExcludePath(
  resolved: string,
  excludes: string[],
  excludeGlobs: string[],
): boolean {
  for (const excluded of excludes) {
    if (resolved === excluded || resolved.startsWith(excluded + path.sep)) {
      return true;
    }
  }
  for (const pattern of excludeGlobs) {
    // path.basename match for simple glob patterns (e.g. "*.pyc", "node_modules")
    const basename = path.basename(resolved);
    if (simpleGlobMatch(basename, pattern) || simpleGlobMatch(resolved, pattern)) {
      return true;
    }
  }
  return false;
}

/** Minimal glob matching: supports * as wildcard for simple patterns. */
function simpleGlobMatch(text: string, pattern: string): boolean {
  // Convert glob to regex: escape dots, replace * with .*
  const regexStr =
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\0")
      .replace(/\*/g, "[^/]*")
      .replace(/\0/g, ".*") +
    "$";
  return new RegExp(regexStr).test(text);
}

/** Recursively walk a directory, returning sorted file paths. */
function walkFiles(root: string): string[] {
  const result: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result.sort();
}

function existsSync(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function captureWorkspaceState(opts: {
  workspace: ExecutionWorkspace;
  observeRoots: string[];
  excludeRoots: string[];
  excludeGlobs: string[];
}): Record<string, Record<string, unknown>> {
  const state: Record<string, Record<string, unknown>> = {};
  const excludes = opts.excludeRoots.map((item) => path.resolve(item));

  for (const rawRoot of opts.observeRoots) {
    const sourceRoot = resolveSourcePath(opts.workspace, rawRoot);
    const executionRoot = mapSourceToExecution(opts.workspace, sourceRoot);
    if (!existsSync(executionRoot)) continue;

    const candidates = isFile(executionRoot)
      ? [executionRoot]
      : walkFiles(executionRoot);

    for (const executionPath of candidates) {
      const resolved = path.resolve(executionPath);
      if (shouldExcludePath(resolved, excludes, opts.excludeGlobs)) continue;

      const sourcePath = mapExecutionToSource(opts.workspace, resolved);
      const entry = fingerprint(resolved);
      entry.execution_path = resolved;
      entry.source_path = sourcePath;

      const content = captureContent(resolved);
      if (content !== null) {
        entry.content = content;
      }
      state[sourcePath] = entry;
    }
  }
  return state;
}

export function diffWorkspaceState(
  before: Record<string, Record<string, unknown>>,
  after: Record<string, Record<string, unknown>>,
  sourceCwd: string,
): Record<string, unknown>[] {
  const changes: Record<string, unknown>[] = [];
  const allPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const cwdPath = path.resolve(sourceCwd);

  for (const pathStr of allPaths) {
    const beforeEntry = before[pathStr] ?? null;
    const afterEntry = after[pathStr] ?? null;
    if (!hasSemanticChange(beforeEntry, afterEntry)) continue;

    let relative: string;
    const rel = path.relative(cwdPath, pathStr);
    relative = rel.startsWith("..") ? pathStr : rel;

    let change: string;
    if (beforeEntry === null) {
      change = "added";
    } else if (afterEntry === null) {
      change = "deleted";
    } else {
      change = "modified";
    }

    const executionPath =
      (afterEntry ?? beforeEntry ?? {}).execution_path ?? null;
    changes.push({
      change,
      path: pathStr,
      execution_path: executionPath,
      relative_path: relative,
    });
  }

  return changes;
}
