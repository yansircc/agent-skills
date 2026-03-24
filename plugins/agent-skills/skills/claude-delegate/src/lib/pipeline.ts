import { artifactPaths, writeJson } from "./common.js";
import { buildDelegatePrompt } from "./delegate-prompt.js";
import { executeDelegateRuntime } from "./delegate.js";
import {
  buildExecutionTaskPacket,
  prepareExecutionWorkspace,
  cleanupWorkspace,
  workspaceToDict,
  type ExecutionWorkspace,
} from "./execution-workspace.js";
import { generatePatch, writePatchArtifact } from "./patch-artifact.js";
import { shapeHandoff } from "./handoff.js";
import { loadParentHandoff } from "./handoff.js";
import { summarizeToolUses } from "./transport.js";
import {
  evaluateExecutionPolicy,
  normalizeCompletionFields,
  runVerification,
} from "./verifier.js";
import {
  captureWorkspaceState,
  diffWorkspaceState,
} from "./workspace.js";

function shouldCaptureWorkspace(
  request: Record<string, unknown>,
): boolean {
  const policy = (request.task_packet as Record<string, unknown>)
    .execution_policy as Record<string, unknown>;
  const observeRoots =
    (policy.observe_roots as string[]) ?? [];
  return (
    request.assistant_role === "implementer" ||
    Boolean(
      (policy.allowed_write_paths as string[] | undefined)?.length,
    ) ||
    policy.max_changed_files != null ||
    observeRoots.length > 0
  );
}

function loadParentHandoffForRequest(
  request: Record<string, unknown>,
): Record<string, unknown> | null {
  const lineage = (request.lineage ?? {}) as Record<string, unknown>;
  const parentJobPath = lineage.parent_job_path as string | undefined;
  if (!parentJobPath) return null;
  return loadParentHandoff(parentJobPath);
}

function requestForExecution(
  request: Record<string, unknown>,
  workspace: ExecutionWorkspace,
): Record<string, unknown> {
  const updated = { ...request };
  updated.execution_workspace = workspaceToDict(workspace);
  updated.task_packet = buildExecutionTaskPacket(
    request.task_packet as Record<string, unknown>,
    workspace,
  );
  updated.prompt = buildDelegatePrompt(
    updated.task_packet as Record<string, unknown>,
    {
      assistantRole: request.assistant_role as string,
      completionContract: request.completion_contract as Record<
        string,
        unknown
      >,
      deltaPrompt:
        (request.delta_prompt as string) ??
        ((request.lineage as Record<string, unknown>) ?? {})
          .delta_prompt as string | null ??
        null,
      parentHandoff: loadParentHandoffForRequest(request),
    },
  );
  return updated;
}

export async function executeRequestPipeline(
  request: Record<string, unknown>,
  artifactsDir: string,
  opts?: {
    onSpawn?: ((pid: number) => void) | null;
    onEvent?:
      | ((event: Record<string, unknown>, count: number) => void)
      | null;
  },
): Promise<Record<string, unknown>> {
  const paths = artifactPaths(artifactsDir);
  const policy = (request.task_packet as Record<string, unknown>)
    .execution_policy as Record<string, unknown>;
  const observeRoots = (policy.observe_roots as string[]) ?? (
    request.assistant_role === "implementer"
      ? [request.cwd as string]
      : []
  );
  const excludeGlobs = (policy.exclude_globs as string[]) ?? [];
  const workspace = prepareExecutionWorkspace(request);
  const execRequest = requestForExecution(request, workspace);

  let snapshotBefore: Record<string, Record<string, unknown>> | null = null;
  let envelope: Record<string, unknown> | null = null;

  try {
    if (shouldCaptureWorkspace(request)) {
      snapshotBefore = captureWorkspaceState({
        workspace,
        observeRoots,
        excludeRoots: [paths.artifactsDir],
        excludeGlobs,
      });
    }

    envelope = await executeDelegateRuntime({
      request: execRequest,
      artifactsDir,
      onSpawn: opts?.onSpawn ?? null,
      onEvent: opts?.onEvent ?? null,
    });

    let workspaceChanges: Record<string, unknown>[] = [];
    if (snapshotBefore !== null) {
      const snapshotAfter = captureWorkspaceState({
        workspace,
        observeRoots,
        excludeRoots: [paths.artifactsDir],
        excludeGlobs,
      });
      workspaceChanges = diffWorkspaceState(
        snapshotBefore,
        snapshotAfter,
        request.cwd as string,
      );

      const patchContent = generatePatch(
        snapshotBefore,
        snapshotAfter,
        request.cwd as string,
      );
      writePatchArtifact(patchContent, paths.patch);
    }

    envelope = normalizeCompletionFields(request, envelope, workspaceChanges);
    envelope.task_packet_summary = {
      goal: (request.task_packet as Record<string, unknown>).goal,
      task_type: (request.task_packet as Record<string, unknown>).task_type,
    };

    const boundary = evaluateExecutionPolicy(request, envelope);
    envelope.boundary = boundary;

    const verification = runVerification(
      request,
      envelope,
      { executionCwd: workspace.executionCwd },
    );
    envelope.verification = verification;

    if ((boundary as Record<string, unknown>).status === "violated") {
      envelope.ok = false;
      envelope.error_type = envelope.error_type ?? "boundary_violation";
      envelope.error_message =
        envelope.error_message ??
        (
          (boundary as Record<string, unknown>).violations as Record<
            string,
            unknown
          >[]
        )
          .map((item) => item.message as string)
          .join("; ");
    }

    if (
      (verification as Record<string, unknown>).status === "failed" &&
      (verification as Record<string, unknown>).fail_on_error
    ) {
      envelope.ok = false;
      envelope.error_type =
        envelope.error_type ?? "verification_failed";
      if (envelope.error_message == null) {
        envelope.error_message = "verification commands failed";
      }
    }

    const rawToolUses = (envelope.tool_uses as Record<string, unknown>[]) ?? [];
    envelope.tool_use_count = rawToolUses.length;
    envelope.tool_uses = summarizeToolUses(rawToolUses);
  } finally {
    cleanupWorkspace(workspace);
  }

  envelope!.execution_workspace = workspaceToDict(workspace);
  writeJson(paths.normalized, envelope);

  const handoff = shapeHandoff(envelope!);
  writeJson(paths.handoff, handoff);

  return envelope!;
}
