import { appendFileSync, writeFileSync } from "node:fs";

import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";

import type { ArtifactPaths } from "./common.js";
import { artifactPaths, readJson, writeJson, writeText } from "./common.js";
import {
  type SdkMessage,
  extractToolUsesFromMessages,
  messageToEvent,
  resultToEnvelopeFields,
} from "./sdk-message-convert.js";
import { buildSdkOptions } from "./sdk-transport.js";

export function baseEnvelope(
  paths: ArtifactPaths,
  request: Record<string, unknown>,
): Record<string, unknown> {
  const job = readJson(paths.job) ?? {};
  return {
    ok: false,
    error_type: null,
    error_message: null,
    exit_code: null,
    session_id: request.session_id,
    runtime: request.runtime ?? null,
    model: request.model,
    provider: request.provider ?? null,
    duration_ms: null,
    model_usage: null,
    num_turns: null,
    total_cost_usd: null,
    result: null,
    stop_reason: null,
    structured_output: null,
    permission_denials: [],
    routing: request.routing ?? null,
    tool_use_count: 0,
    tool_uses: [],
    artifacts: {
      artifacts_dir: paths.artifactsDir,
      handoff_path: paths.handoff,
      job_metadata_path: paths.job,
      ledger_path: (job.ledger_path as string) ?? null,
      patch_path: paths.patch,
      request_path: paths.request,
      normalized_path: paths.normalized,
    },
  };
}

function writeOutputs(
  paths: ArtifactPaths,
  stdout: string,
  _stderr: string,
): void {
  writeText(paths.events, stdout);
  writeText(paths.stdout, stdout);
  writeText(paths.stderr, _stderr);
}

export function writeFailureEnvelope(
  request: Record<string, unknown>,
  artifactsDir: string,
  errorType: string,
  errorMessage: string,
  opts?: { exitCode?: number },
): Record<string, unknown> {
  const paths = artifactPaths(artifactsDir);
  const envelope = baseEnvelope(paths, request);
  envelope.error_type = errorType;
  envelope.error_message = errorMessage;
  envelope.exit_code = opts?.exitCode ?? null;
  writeJson(paths.normalized, envelope);
  return envelope;
}

export interface DelegateRuntimeOptions {
  request: Record<string, unknown>;
  artifactsDir: string;
  onSpawn?: ((pid: number) => void) | null;
  onEvent?: ((event: Record<string, unknown>, count: number) => void) | null;
}

export async function executeDelegateRuntime(
  opts: DelegateRuntimeOptions,
): Promise<Record<string, unknown>> {
  const { request, artifactsDir, onEvent } = opts;
  const paths = artifactPaths(artifactsDir);

  // Cancel / signal state
  let cancelRequested = false;
  let cancelExitCode = 143;
  let cancelReason = "job cancelled";

  // Abort controller for the SDK query and timeout
  const ac = new AbortController();

  function handleSignal(sigName: string, sigNum: number): void {
    cancelRequested = true;
    cancelExitCode = 128 + sigNum;
    cancelReason = `job cancelled by signal ${sigName}`;
    ac.abort();
  }

  const sigTermHandler = (): void => handleSignal("SIGTERM", 15);
  const sigIntHandler = (): void => handleSignal("SIGINT", 2);

  process.on("SIGTERM", sigTermHandler);
  process.on("SIGINT", sigIntHandler);

  try {
    // Pre-cancel check
    if (cancelRequested) {
      writeOutputs(paths, "", "");
      return writeFailureEnvelope(
        request,
        artifactsDir,
        "cancelled",
        cancelReason,
        { exitCode: cancelExitCode },
      );
    }

    return await executeAsync({
      request,
      paths,
      artifactsDir,
      ac,
      onEvent: onEvent ?? null,
      isCancelled: () => cancelRequested,
      getCancelReason: () => cancelReason,
      getCancelExitCode: () => cancelExitCode,
    });
  } finally {
    process.removeListener("SIGTERM", sigTermHandler);
    process.removeListener("SIGINT", sigIntHandler);
  }
}

interface ExecuteAsyncContext {
  request: Record<string, unknown>;
  paths: ArtifactPaths;
  artifactsDir: string;
  ac: AbortController;
  onEvent: ((event: Record<string, unknown>, count: number) => void) | null;
  isCancelled: () => boolean;
  getCancelReason: () => string;
  getCancelExitCode: () => number;
}

async function executeAsync(
  ctx: ExecuteAsyncContext,
): Promise<Record<string, unknown>> {
  const { request, paths, artifactsDir, ac, onEvent } = ctx;

  const stderrLines: string[] = [];
  function recordStderr(line: string): void {
    const normalized = line.endsWith("\n") ? line : `${line}\n`;
    stderrLines.push(normalized);
    appendFileSync(paths.stderr, normalized);
  }

  const sdkOptions = buildSdkOptions(request, {
    stderrCallback: recordStderr,
  });

  // Wire abort controller into SDK options
  const optionsWithAbort: Options = {
    ...sdkOptions,
    abortController: ac,
  };

  const prompt = request.prompt as string;

  // Initialize artifact files
  writeFileSync(paths.events, "");
  writeFileSync(paths.stdout, "");
  writeFileSync(paths.stderr, "");

  const collectedMessages: SDKMessage[] = [];
  let resultMsg: SDKResultMessage | null = null;
  let eventCount = 0;

  function recordEvent(eventDict: Record<string, unknown>): void {
    const line = JSON.stringify(eventDict) + "\n";
    appendFileSync(paths.events, line);
    appendFileSync(paths.stdout, line);
    eventCount += 1;
    if (onEvent !== null) {
      onEvent(eventDict, eventCount);
    }
  }

  // Timeout handling
  const timeoutSeconds = request.timeout_seconds as number | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  if (timeoutSeconds != null && timeoutSeconds > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutSeconds * 1000);
  }

  let queryHandle: Query | null = null;

  try {
    queryHandle = query({ prompt, options: optionsWithAbort });

    for await (const msg of queryHandle) {
      if (ctx.isCancelled()) break;

      collectedMessages.push(msg);
      const eventDict = messageToEvent(
        msg as unknown as SdkMessage,
      );
      if (eventDict !== null) {
        recordEvent(eventDict);
      }

      if (msg.type === "result") {
        resultMsg = msg as SDKResultMessage;
      }
    }
  } catch (err) {
    // Distinguish timeout from other errors
    if (timedOut) {
      const runtimeLabel =
        (request.runtime as string) ?? "delegate runtime";
      return writeFailureEnvelope(
        request,
        artifactsDir,
        "timeout_error",
        `${runtimeLabel} timed out after ${timeoutSeconds} seconds`,
        { exitCode: 124 },
      );
    }

    if (ctx.isCancelled()) {
      // Cancellation triggered abort — handled below
    } else {
      return writeFailureEnvelope(
        request,
        artifactsDir,
        "sdk_error",
        String(err),
        { exitCode: 1 },
      );
    }
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    // Ensure query resources are cleaned up
    if (queryHandle !== null) {
      try {
        queryHandle.close();
      } catch {
        // Already closed or errored — safe to ignore
      }
    }
  }

  if (ctx.isCancelled()) {
    return writeFailureEnvelope(
      request,
      artifactsDir,
      "cancelled",
      ctx.getCancelReason(),
      { exitCode: ctx.getCancelExitCode() },
    );
  }

  return buildEnvelope({
    paths,
    request,
    collectedMessages,
    resultMsg,
  });
}

function buildEnvelope(ctx: {
  paths: ArtifactPaths;
  request: Record<string, unknown>;
  collectedMessages: SDKMessage[];
  resultMsg: SDKResultMessage | null;
}): Record<string, unknown> {
  const { paths, request, collectedMessages, resultMsg } = ctx;
  const envelope = baseEnvelope(paths, request);
  const toolUses = extractToolUsesFromMessages(
    collectedMessages as unknown as SdkMessage[],
  );

  if (resultMsg === null) {
    envelope.error_type = "protocol_error";
    envelope.error_message = "SDK stream ended without a ResultMessage";
  } else {
    const resultFields = resultToEnvelopeFields(
      resultMsg as unknown as SdkMessage,
    );
    Object.assign(envelope, resultFields);

    if (
      envelope.ok &&
      request.schema != null &&
      (resultMsg as Record<string, unknown>).structured_output == null
    ) {
      envelope.ok = false;
      envelope.error_type = "protocol_error";
      envelope.error_message =
        "schema supplied but structured_output missing from result";
    }
  }

  envelope.tool_uses = toolUses;
  envelope.tool_use_count = toolUses.length;
  writeJson(paths.normalized, envelope);
  return envelope;
}
