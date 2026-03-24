import {
  createReadStream,
  existsSync,
  readFileSync,
} from "node:fs";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { Readable } from "node:stream";

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Command } from "commander";

import { artifactPaths, readJson } from "../lib/common.js";
import { renderJobView } from "../lib/job-views.js";
import { listLedger, listSessions } from "../lib/ledger-query.js";

function uiDistDir(): string {
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "ui",
    "dist",
  );
}

function isWithin(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + path.sep)
  );
}

function readLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  let content: string;
  if (filePath.endsWith(".gz")) {
    const buf = readFileSync(filePath);
    const { gunzipSync } = require("node:zlib") as typeof import("node:zlib");
    content = gunzipSync(buf).toString("utf-8");
  } else {
    content = readFileSync(filePath, "utf-8");
  }
  return content.split("\n").map((line) => line.replace(/\n$/, ""));
}

interface StreamPage {
  items: Record<string, unknown>[];
  cursor: number;
  next_cursor: number;
  total_lines: number;
  has_more: boolean;
  reset: boolean;
}

function streamPage(
  lines: string[],
  opts: {
    cursor: number | null;
    limit: number;
    formatter: (lines: string[]) => Record<string, unknown>[];
  },
): StreamPage {
  const total = lines.length;

  if (opts.cursor === null) {
    const start = Math.max(0, total - opts.limit);
    return {
      items: opts.formatter(lines.slice(start, total)),
      cursor: start,
      next_cursor: total,
      total_lines: total,
      has_more: false,
      reset: false,
    };
  }

  let cursor = opts.cursor;
  const reset = cursor > total;
  if (reset) cursor = 0;
  const end = Math.min(cursor + opts.limit, total);
  return {
    items: opts.formatter(lines.slice(cursor, end)),
    cursor,
    next_cursor: end,
    total_lines: total,
    has_more: end < total,
    reset,
  };
}

function fmtRaw(
  lines: string[],
): Record<string, unknown>[] {
  return lines.map((line) => ({ raw: line }));
}

function parseJsonl(
  lines: string[],
): Record<string, unknown>[] {
  return lines.map((raw) => {
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    return { raw, parsed };
  });
}

function parseLimit(raw: string, defaultVal: number): number {
  const value = parseInt(raw, 10);
  if (isNaN(value)) return defaultVal;
  return Math.max(1, Math.min(value, 1000));
}

function parseCursor(raw: string | undefined): number | null {
  if (raw == null) return null;
  const value = parseInt(raw, 10);
  if (isNaN(value)) return null;
  return Math.max(0, value);
}

function errorPayload(
  errorType: string,
  errorMessage: string,
): Record<string, unknown> {
  return {
    ok: false,
    error_type: errorType,
    error_message: errorMessage,
  };
}

export function createApp(
  artifactsRoot: string,
  opts?: { distDir?: string | null; serveStaticFiles?: boolean },
): Hono {
  const resolvedRoot = path.resolve(artifactsRoot);
  const app = new Hono();

  app.get("/api/overview", (c) => {
    const limit = parseLimit(
      c.req.query("limit") ?? "30",
      30,
    );
    const sessions = listSessions(resolvedRoot, { limit });
    const recentJobs = listLedger(resolvedRoot, {
      limit,
      sessionId: null,
      runtime: null,
      provider: null,
      state: null,
    });
    const runningJobs = listLedger(resolvedRoot, {
      limit,
      sessionId: null,
      runtime: null,
      provider: null,
      state: "running",
    });
    return c.json({
      ok: true,
      artifacts_root: resolvedRoot,
      sessions: (sessions.items as unknown[]) ?? [],
      recent_jobs: (recentJobs.items as unknown[]) ?? [],
      running_jobs: (runningJobs.items as unknown[]) ?? [],
    });
  });

  app.get("/api/job", (c) => {
    const jobPath = c.req.query("job_path");
    if (!jobPath) {
      return c.json(
        errorPayload("input_error", "job_path is required"),
        400,
      );
    }
    const resolved = path.resolve(jobPath);
    if (!isWithin(resolvedRoot, resolved)) {
      return c.json(
        errorPayload(
          "path_error",
          "job_path is outside artifacts_root",
        ),
      );
    }
    return c.json(renderJobView(resolved));
  });

  app.get("/api/job-output", (c) => {
    const jobPath = c.req.query("job_path");
    if (!jobPath) {
      return c.json(
        errorPayload("input_error", "job_path is required"),
        400,
      );
    }
    const resolved = path.resolve(jobPath);
    if (!isWithin(resolvedRoot, resolved)) {
      return c.json(
        errorPayload(
          "path_error",
          "job_path is outside artifacts_root",
        ),
      );
    }
    const limit = parseLimit(
      c.req.query("limit") ?? "200",
      200,
    );
    const eventsCursor = parseCursor(c.req.query("events_cursor"));
    const stdoutCursor = parseCursor(c.req.query("stdout_cursor"));
    const stderrCursor = parseCursor(c.req.query("stderr_cursor"));

    const paths = artifactPaths(resolved);
    const job = readJson(paths.job) ?? {};
    const eventsPath =
      (job.events_path as string) ?? paths.events;
    const stdoutPath =
      (job.stdout_path as string) ?? paths.stdout;
    const stderrPath =
      (job.stderr_path as string) ?? paths.stderr;

    return c.json({
      ok: true,
      job_path: resolved,
      job_state: job.state ?? null,
      paths: {
        events_path: eventsPath,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
      },
      events: streamPage(readLines(eventsPath), {
        cursor: eventsCursor,
        limit,
        formatter: parseJsonl,
      }),
      stdout: streamPage(readLines(stdoutPath), {
        cursor: stdoutCursor,
        limit,
        formatter: parseJsonl,
      }),
      stderr: streamPage(readLines(stderrPath), {
        cursor: stderrCursor,
        limit,
        formatter: fmtRaw,
      }),
    });
  });

  // Serve static files if configured
  const shouldServe = opts?.serveStaticFiles !== false;
  const distDir = opts?.distDir ?? uiDistDir();
  if (shouldServe && distDir && existsSync(distDir)) {
    app.use(
      "/*",
      serveStatic({
        root: path.relative(process.cwd(), distDir),
      }),
    );
  }

  return app;
}

function parseServerArgs(
  argv?: string[],
): Record<string, unknown> {
  const program = new Command()
    .description("Serve the claude-delegate progress UI.")
    .option(
      "--artifacts-root <dir>",
      "Artifacts root directory",
      "/tmp/claude-delegate-runs",
    )
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--port <port>", "Port to bind", (v: string) => Number(v), 8765)
    .option("--api-only", "Disable static file serving");

  if (argv) {
    program.parse(argv, { from: "user" });
  } else {
    program.parse();
  }
  return program.opts();
}

export function startServer(argv?: string[]): void {
  const opts = parseServerArgs(argv);
  const distDir = (opts.apiOnly as boolean) ? null : uiDistDir();

  if (distDir !== null && !existsSync(distDir)) {
    console.error(
      `UI bundle not found at ${distDir}. Run \`bun install && bun run build\` in ${path.dirname(distDir)} first.`,
    );
    process.exit(1);
  }

  const app = createApp(opts.artifactsRoot as string, {
    distDir,
    serveStaticFiles: !opts.apiOnly,
  });

  const host = opts.host as string;
  const port = opts.port as number;

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: `http://${host}:${port}`,
        artifacts_root: path.resolve(opts.artifactsRoot as string),
        dist_dir: distDir,
        api_only: opts.apiOnly ?? false,
      },
      null,
      2,
    ),
  );

  serve({
    fetch: app.fetch,
    hostname: host,
    port,
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname)
) {
  startServer();
}
