import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { flockSync } from "fs-ext";

import { artifactPaths, readJson, utcNow, writeJson } from "./common.js";
import { writeFailureEnvelope } from "./delegate.js";
import { finalizeJobState, updateJob } from "./job-state.js";
import { renderJobView } from "./job-views.js";
import { executeRequestPipeline } from "./pipeline.js";
import { executeWorkflow } from "./workflow.js";

export function submitRequest(
  request: Record<string, unknown>,
  artifactsDir: string,
  entrypoint: string,
): [Record<string, unknown>, number] {
  const paths = artifactPaths(artifactsDir);
  if (!existsSync(paths.lock)) {
    writeFileSync(paths.lock, "");
  }
  writeJson(paths.request, request);

  const workerCommand = [
    entrypoint,
    "--job-worker",
    "--job-path",
    artifactsDir,
  ];

  return new Promise<[Record<string, unknown>, number]>(
    (resolve) => {
      const child = spawn(process.execPath, workerCommand, {
        cwd: request.cwd as string,
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });

      const onMessage = (msg: unknown): void => {
        child.removeListener("message", onMessage);
        child.removeListener("exit", onExit);
        child.disconnect();
        child.unref();
        if (msg === "started") {
          resolve([renderJobView(artifactsDir), 0]);
        } else {
          const view = renderJobView(artifactsDir);
          resolve([
            {
              ok: false,
              error_type: "submit_error",
              error_message: "worker failed to start cleanly",
              job: view.job ?? null,
              request: view.request ?? null,
              delegate: view.delegate ?? null,
              ready: view.ready ?? null,
            },
            1,
          ]);
        }
      };

      const onExit = (): void => {
        child.removeListener("message", onMessage);
        const view = renderJobView(artifactsDir);
        resolve([
          {
            ok: false,
            error_type: "submit_error",
            error_message: "worker failed to start cleanly",
            job: view.job ?? null,
            request: view.request ?? null,
            delegate: view.delegate ?? null,
            ready: view.ready ?? null,
          },
          1,
        ]);
      };

      child.once("message", onMessage);
      child.once("exit", onExit);
    },
  ) as unknown as [Record<string, unknown>, number];
}

export async function runWorker(
  jobPath: string,
  startupNotify: (() => void) | null,
): Promise<number> {
  const artifactsDir = jobPath;
  const paths = artifactPaths(artifactsDir);
  const request = readJson(paths.request);
  if (request === null) return 2;

  const fd = openSync(paths.lock, "r+");
  try {
    flockSync(fd, "ex");

    function safeUpdate(
      changes: Record<string, unknown>,
    ): Record<string, unknown> {
      return updateJob(paths, changes);
    }

    let startupDone = false;
    function acknowledgeStartup(): void {
      if (startupDone) return;
      startupDone = true;
      if (startupNotify) startupNotify();
    }

    function onSpawn(delegatePid: number): void {
      safeUpdate({ delegate_pid: delegatePid });
    }

    function onEvent(
      event: Record<string, unknown>,
      eventCount: number,
    ): void {
      safeUpdate({
        event_count: eventCount,
        last_event_at: utcNow(),
        last_event_type: event.type,
      });
    }

    const workflowRoles =
      (request.workflow_roles as string[]) ?? [];

    safeUpdate({
      state: "running",
      started_at: utcNow(),
      pid: process.pid,
      delegate_pid: null,
      current_role:
        workflowRoles.length > 1
          ? null
          : (request.assistant_role as string) ?? null,
      last_error: null,
      completed_roles: [],
      termination_intent: null,
      workflow_step: 0,
    });
    acknowledgeStartup();

    let envelope: Record<string, unknown>;
    try {
      if (workflowRoles.length > 1) {
        envelope = await executeWorkflow(request, artifactsDir, {
          updateParentJob: safeUpdate,
        });
      } else {
        envelope = await executeRequestPipeline(
          request,
          artifactsDir,
          { onSpawn, onEvent },
        );
      }
    } catch (exc) {
      writeFailureEnvelope(
        request,
        artifactsDir,
        "worker_error",
        String(exc),
        { exitCode: 1 },
      );
      updateJob(paths, {
        state: "failed",
        finished_at: utcNow(),
        last_error: String(exc),
      });
      if (!startupDone && startupNotify) {
        startupNotify();
      }
      return 1;
    }

    const job = readJson(paths.job) ?? {};
    const terminationIntent = job.termination_intent as
      | string
      | null;
    if (
      terminationIntent === "pause" &&
      envelope.error_type === "cancelled"
    ) {
      envelope.error_type = "paused";
      envelope.error_message = "job paused";
      writeJson(paths.normalized, envelope);
    }

    const finalState = finalizeJobState(envelope);
    const workflow = (envelope.workflow ?? {}) as Record<
      string,
      unknown
    >;
    const workflowSteps = (workflow.steps as Record<string, unknown>[]) ?? [];

    safeUpdate({
      state: finalState,
      finished_at: utcNow(),
      assistant_role:
        (envelope.assistant_role as string) ??
        (request.assistant_role as string),
      completed_roles: workflowSteps.map(
        (step) => step.role as string,
      ),
      current_role: null,
      current_step_job_path: null,
      delegate_pid: null,
      execution_workspace: envelope.execution_workspace ?? null,
      last_error: envelope.error_message ?? null,
      task_type:
        (envelope.task_type as string) ??
        (request.task_type as string) ??
        null,
      termination_intent: null,
      workflow_roles:
        (envelope.workflow_roles as string[]) ??
        (request.workflow_roles as string[]),
      workflow_step: workflowSteps.length > 0
        ? workflowSteps.length
        : 1,
      workflow_total_steps: (
        (envelope.workflow_roles as string[]) ??
        (request.workflow_roles as string[]) ??
        []
      ).length,
    });
    return envelope.ok ? 0 : 1;
  } finally {
    flockSync(fd, "un");
    closeSync(fd);
  }
}
