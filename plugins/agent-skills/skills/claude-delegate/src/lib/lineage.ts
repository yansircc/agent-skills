import { randomUUID } from "node:crypto";

import { artifactPaths, readJson } from "./common.js";
import { finalizeRequest } from "./request.js";

export function readParentRequest(
  jobPath: string,
): Record<string, unknown> {
  const paths = artifactPaths(jobPath);
  const request = readJson(paths.request);
  if (request === null) {
    throw new Error(`Missing request.json for job: ${jobPath}`);
  }
  return request;
}

export function deriveRequestFromJob(
  jobPath: string,
  opts: {
    action: string;
    deltaPrompt: string | null;
  },
): Record<string, unknown> {
  const parentRequest = readParentRequest(jobPath);
  const derived = structuredClone(parentRequest);
  const parentSessionId = parentRequest.session_id as string;

  derived.lineage = {
    action: opts.action,
    parent_job_path: jobPath,
    parent_session_id: parentSessionId,
  };
  derived.delta_prompt = opts.deltaPrompt;

  delete derived.command;
  delete derived.created_at;
  delete derived.prompt;
  delete derived.system_prompt;
  derived.skip_ledger = false;

  if (opts.action === "resume") {
    derived.resume_session_id = parentSessionId;
    derived.session_id = parentSessionId;
  } else if (opts.action === "fork" || opts.action === "retry") {
    derived.resume_session_id = null;
    derived.session_id = randomUUID();
  } else {
    throw new Error(`Unsupported lineage action: ${opts.action}`);
  }

  return finalizeRequest(derived);
}
