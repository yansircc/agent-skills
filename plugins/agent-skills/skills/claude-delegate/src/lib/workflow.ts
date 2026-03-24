import { mkdirSync } from "node:fs";
import path from "node:path";

import { artifactPaths, readJson, utcNow, writeJson } from "./common.js";
import { dedupeStrings } from "./contracts.js";
import { baseEnvelope, writeFailureEnvelope } from "./delegate.js";
import { shapeHandoff } from "./handoff.js";
import {
  finalizeJobState,
  initializeJob,
  updateJob,
} from "./job-state.js";
import { executeRequestPipeline } from "./pipeline.js";
import {
  aggregateBoundary,
  aggregateVerification,
  stepSummary,
} from "./workflow-aggregation.js";
import { prepareRoleRequest } from "./workflow-inheritance.js";

function appendStepJobPath(
  parentJobPaths: string[],
  jobPath: string,
): string[] {
  if (parentJobPaths.includes(jobPath)) return [...parentJobPaths];
  return [...parentJobPaths, jobPath];
}

async function executeChildStep(
  childRequest: Record<string, unknown>,
  childDir: string,
  opts: {
    role: string;
    workflowStep: number;
    updateParentJob: (changes: Record<string, unknown>) => void;
    parentPaths: ReturnType<typeof artifactPaths>;
    parentEventCount: number;
  },
): Promise<[Record<string, unknown>, number]> {
  const childPaths = artifactPaths(childDir);
  // Ensure lock file exists
  const { writeFileSync, existsSync } = await import("node:fs");
  if (!existsSync(childPaths.lock)) {
    writeFileSync(childPaths.lock, "");
  }
  writeJson(childPaths.request, childRequest);
  initializeJob(childPaths, childRequest);
  updateJob(childPaths, {
    state: "running",
    started_at: utcNow(),
    pid: process.pid,
    current_role: opts.role,
    last_error: null,
  });

  const parentJob = readJson(opts.parentPaths.job) ?? {};
  const stepJobPaths = appendStepJobPath(
    (parentJob.step_job_paths as string[]) ?? [],
    childDir,
  );
  opts.updateParentJob({
    current_role: opts.role,
    current_step_job_path: childDir,
    step_job_paths: stepJobPaths,
    workflow_step: opts.workflowStep,
  });

  let parentEventCount = opts.parentEventCount;

  function onSpawn(delegatePid: number): void {
    updateJob(childPaths, { delegate_pid: delegatePid });
    opts.updateParentJob({
      delegate_pid: delegatePid,
      current_step_job_path: childDir,
    });
  }

  function onEvent(
    event: Record<string, unknown>,
    eventCount: number,
  ): void {
    parentEventCount += 1;
    const timestamp = utcNow();
    updateJob(childPaths, {
      event_count: eventCount,
      last_event_at: timestamp,
      last_event_type: event.type,
    });
    opts.updateParentJob({
      event_count: parentEventCount,
      last_event_at: timestamp,
      last_event_type: event.type,
      current_step_job_path: childDir,
    });
  }

  let envelope: Record<string, unknown>;
  try {
    envelope = await executeRequestPipeline(childRequest, childDir, {
      onSpawn,
      onEvent,
    });
  } catch (exc) {
    writeFailureEnvelope(
      childRequest,
      childDir,
      "workflow_step_error",
      String(exc),
      { exitCode: 1 },
    );
    updateJob(childPaths, {
      state: "failed",
      finished_at: utcNow(),
      current_role: null,
      delegate_pid: null,
      last_error: String(exc),
    });
    opts.updateParentJob({
      delegate_pid: null,
      current_step_job_path: null,
    });
    throw exc;
  }

  updateJob(childPaths, {
    state: finalizeJobState(envelope),
    finished_at: utcNow(),
    assistant_role:
      (envelope.assistant_role as string) ??
      (childRequest.assistant_role as string),
    current_role: null,
    delegate_pid: null,
    last_error: envelope.error_message ?? null,
    task_type:
      (envelope.task_type as string) ??
      (childRequest.task_type as string) ??
      null,
    workflow_roles:
      (envelope.workflow_roles as string[]) ??
      (childRequest.workflow_roles as string[]),
    workflow_step: 1,
    workflow_total_steps: 1,
  });
  opts.updateParentJob({
    delegate_pid: null,
    current_step_job_path: null,
  });
  return [envelope, parentEventCount];
}

export async function executeWorkflow(
  request: Record<string, unknown>,
  artifactsDir: string,
  opts: {
    updateParentJob: (changes: Record<string, unknown>) => void;
  },
): Promise<Record<string, unknown>> {
  const paths = artifactPaths(artifactsDir);
  const workflowEnvelope = baseEnvelope(paths, request);
  workflowEnvelope.assistant_role = "supervisor";
  workflowEnvelope.task_type = (
    request.task_packet as Record<string, unknown>
  ).task_type;
  workflowEnvelope.workflow_roles = request.workflow_roles;
  workflowEnvelope.lineage = request.lineage ?? null;
  workflowEnvelope.completion_contract = {
    name: (request.completion_contract as Record<string, unknown>).name,
    role: (request.completion_contract as Record<string, unknown>).role,
  };

  const stepArtifactsDir = path.join(artifactsDir, "steps");
  mkdirSync(stepArtifactsDir, { recursive: true });
  (workflowEnvelope.artifacts as Record<string, unknown>).steps_dir =
    stepArtifactsDir;

  const priorSteps: Record<string, unknown>[] = [];
  const stepSummaries: Record<string, unknown>[] = [];
  const stepEnvelopes: Record<string, unknown>[] = [];
  let parentEventCount = 0;
  const workflowRoles = request.workflow_roles as string[];

  for (let index = 0; index < workflowRoles.length; index++) {
    const role = workflowRoles[index];
    const stepNum = index + 1;

    opts.updateParentJob({
      current_role: role,
      workflow_step: stepNum,
      workflow_total_steps: workflowRoles.length,
      completed_roles: stepSummaries.map(
        (s) => s.role as string,
      ),
    });

    const childDir = path.join(
      stepArtifactsDir,
      `${String(stepNum).padStart(2, "0")}-${role}`,
    );
    mkdirSync(childDir, { recursive: true });

    const childRequest = prepareRoleRequest(
      request,
      role,
      priorSteps,
      paths.artifactsDir,
    );

    const [childEnvelope, newParentEventCount] =
      await executeChildStep(childRequest, childDir, {
        role,
        workflowStep: stepNum,
        updateParentJob: opts.updateParentJob,
        parentPaths: paths,
        parentEventCount,
      });

    parentEventCount = newParentEventCount;
    stepEnvelopes.push(childEnvelope);
    const summary = stepSummary(childEnvelope, role, childDir);
    stepSummaries.push(summary);
    priorSteps.push(summary);

    if (role !== "critic" && !(childEnvelope.ok as boolean)) {
      break;
    }
  }

  const finalChild =
    stepEnvelopes.length > 0
      ? stepEnvelopes[stepEnvelopes.length - 1]
      : {};
  const allFindings: unknown[] = [];
  const criticFindings: unknown[] = [];
  const openRisks: string[] = [];
  let totalCostUsd = 0;
  let totalCostSeen = false;
  let durationMs = 0;
  let durationSeen = false;
  let numTurns = 0;
  let turnsSeen = false;
  const permissionDenials: Record<string, unknown>[] = [];
  const toolUses: Record<string, unknown>[] = [];
  let toolUseCount = 0;

  for (const summary of stepSummaries) {
    allFindings.push(
      ...((summary.findings as unknown[]) ?? []),
    );
    if (summary.role === "critic") {
      criticFindings.push(
        ...((summary.findings as unknown[]) ?? []),
      );
    }
    openRisks.push(
      ...((summary.open_risks as string[]) ?? []),
    );
  }

  for (const envelope of stepEnvelopes) {
    const cost = envelope.total_cost_usd;
    if (typeof cost === "number") {
      totalCostSeen = true;
      totalCostUsd += cost;
    }
    const childDuration = envelope.duration_ms;
    if (typeof childDuration === "number" && Number.isInteger(childDuration)) {
      durationSeen = true;
      durationMs += childDuration;
    }
    const childTurns = envelope.num_turns;
    if (typeof childTurns === "number" && Number.isInteger(childTurns)) {
      turnsSeen = true;
      numTurns += childTurns;
    }
    permissionDenials.push(
      ...((envelope.permission_denials as Record<string, unknown>[]) ?? []),
    );
    toolUses.push(
      ...((envelope.tool_uses as Record<string, unknown>[]) ?? []),
    );
    toolUseCount += Number(
      envelope.tool_use_count ??
        (envelope.tool_uses as unknown[])?.length ??
        0,
    );
  }

  const stepsFailed = stepEnvelopes.some(
    (envelope) => !(envelope.ok as boolean),
  );
  const boundary = aggregateBoundary(stepEnvelopes);
  const verification = aggregateVerification(stepEnvelopes);
  const status = stepsFailed
    ? "failed"
    : criticFindings.length > 0
      ? "needs_review"
      : "completed";

  workflowEnvelope.workflow = {
    roles: workflowRoles,
    steps: stepSummaries,
  };
  workflowEnvelope.structured_output = {
    status,
    summary:
      ((finalChild.completion as Record<string, unknown>) ?? {})
        .summary ??
      (finalChild.result as string) ??
      "workflow finished",
    steps: stepSummaries.map((item) => ({
      role: item.role,
      job_path: item.job_path,
      ok: item.ok,
      summary: item.summary,
    })),
    open_risks: dedupeStrings(openRisks),
  };
  workflowEnvelope.completion = workflowEnvelope.structured_output;
  workflowEnvelope.findings = allFindings;
  workflowEnvelope.open_risks = dedupeStrings(openRisks);
  workflowEnvelope.result = finalChild.result ?? null;
  workflowEnvelope.total_cost_usd = totalCostSeen
    ? totalCostUsd
    : null;
  workflowEnvelope.duration_ms = durationSeen ? durationMs : null;
  workflowEnvelope.num_turns = turnsSeen ? numTurns : null;
  workflowEnvelope.permission_denials = permissionDenials;
  workflowEnvelope.tool_use_count = toolUseCount;
  workflowEnvelope.tool_uses = toolUses;
  workflowEnvelope.boundary = boundary;
  workflowEnvelope.verification = verification;
  workflowEnvelope.session_id = request.session_id;
  workflowEnvelope.ok =
    !stepsFailed && criticFindings.length === 0;

  if (stepsFailed) {
    const failedStep =
      stepEnvelopes.find((e) => !(e.ok as boolean)) ?? {};
    workflowEnvelope.error_type =
      (failedStep.error_type as string) ?? "workflow_step_failed";
    workflowEnvelope.error_message =
      (failedStep.error_message as string) ?? "workflow step failed";
  } else if (criticFindings.length > 0) {
    workflowEnvelope.ok = false;
    workflowEnvelope.error_type = "critic_findings";
    workflowEnvelope.error_message = "critic found issues";
  }

  opts.updateParentJob({
    completed_roles: stepSummaries.map(
      (step) => step.role as string,
    ),
    current_role: null,
    workflow_step: stepSummaries.length,
  });

  writeJson(paths.normalized, workflowEnvelope);
  writeJson(paths.handoff, shapeHandoff(workflowEnvelope));
  return workflowEnvelope;
}
