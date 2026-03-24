import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const DEFAULT_MODEL = "opus";
export const DEFAULT_SYSTEM_PROMPT =
  "Reply concisely. Execute commands when asked.";
export const TERMINAL_JOB_STATES = new Set([
  "finished",
  "failed",
  "cancelled",
  "paused",
]);

export function utcNow(): string {
  return new Date().toISOString();
}

/** Recursively sort object keys to match Python `json.dumps(sort_keys=True)`. */
function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function sortedStringify(
  data: unknown,
  indent: number = 2,
): string {
  return JSON.stringify(sortKeys(data), null, indent);
}

export function writeText(filePath: string, data: string): void {
  writeFileSync(filePath, data);
}

export function writeJson(filePath: string, data: unknown): void {
  const tmpPath = filePath + ".tmp";
  writeFileSync(tmpPath, sortedStringify(data));
  renameSync(tmpPath, filePath);
}

export function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as Record<
    string,
    unknown
  >;
}

export function buildArtifactsDir(root: string): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "T",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const dir = path.join(root, ts, randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface ArtifactPaths {
  artifactsDir: string;
  events: string;
  handoff: string;
  job: string;
  lock: string;
  normalized: string;
  patch: string;
  request: string;
  stderr: string;
  stdout: string;
}

export function artifactPaths(artifactsDir: string): ArtifactPaths {
  return {
    artifactsDir,
    events: path.join(artifactsDir, "events.jsonl"),
    handoff: path.join(artifactsDir, "handoff.json"),
    job: path.join(artifactsDir, "job.json"),
    lock: path.join(artifactsDir, "job.lock"),
    normalized: path.join(artifactsDir, "normalized.json"),
    patch: path.join(artifactsDir, "workspace.patch"),
    request: path.join(artifactsDir, "request.json"),
    stderr: path.join(artifactsDir, "stderr.txt"),
    stdout: path.join(artifactsDir, "stdout.jsonl"),
  };
}

export function printJson(data: unknown): void {
  console.log(sortedStringify(data));
}
