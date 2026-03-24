import { randomUUID } from "node:crypto";

import { defaultCompletionContract } from "./contracts.js";
import { buildDelegatePrompt, buildSystemPrompt } from "./delegate-prompt.js";
import { finalizeRequest } from "./request.js";

export const EXECUTION_POLICY_INHERITANCE_SPEC: Record<string, string[]> = {
  all_roles: [
    "command_allowlist",
    "exclude_globs",
    "max_budget_usd",
    "max_changed_files",
    "max_turns",
    "observe_roots",
  ],
  implementer_only: ["allowed_write_paths"],
};

export const VERIFICATION_CONTRACT_INHERITANCE_SPEC: Record<string, string[]> =
  {
    all_roles: ["commands"],
    implementer_only: ["auto", "fail_on_error"],
    non_implementer_only: ["fail_on_error"],
  };

export function inheritChildTaskPacket(
  parentRequest: Record<string, unknown>,
  role: string,
): Record<string, unknown> {
  const packet = structuredClone(
    parentRequest.task_packet as Record<string, unknown>,
  );
  const policy = structuredClone(
    (packet.execution_policy ?? {}) as Record<string, unknown>,
  );
  const verification = structuredClone(
    (packet.verification_contract ?? {}) as Record<string, unknown>,
  );
  delete packet.execution_policy;
  delete packet.verification_contract;
  delete packet.assistant_role;
  delete packet.workflow_roles;

  const inheritedPolicy: Record<string, unknown> = {};
  for (const key of EXECUTION_POLICY_INHERITANCE_SPEC.all_roles) {
    if (key in policy) {
      inheritedPolicy[key] = policy[key];
    }
  }
  if (role === "implementer") {
    for (const key of EXECUTION_POLICY_INHERITANCE_SPEC.implementer_only) {
      if (key in policy) {
        inheritedPolicy[key] = policy[key];
      }
    }
  }
  if (Object.keys(inheritedPolicy).length > 0) {
    packet.execution_policy = inheritedPolicy;
  }

  const inheritedVerification: Record<string, unknown> = {};
  for (const key of VERIFICATION_CONTRACT_INHERITANCE_SPEC.all_roles) {
    if (key in verification) {
      inheritedVerification[key] = verification[key];
    }
  }
  if (role === "implementer") {
    for (const key of VERIFICATION_CONTRACT_INHERITANCE_SPEC
      .implementer_only) {
      if (key in verification) {
        inheritedVerification[key] = verification[key];
      }
    }
  } else {
    for (const key of VERIFICATION_CONTRACT_INHERITANCE_SPEC
      .non_implementer_only) {
      if (key in verification) {
        inheritedVerification[key] = verification[key];
      }
    }
  }
  if (Object.keys(inheritedVerification).length > 0) {
    packet.verification_contract = inheritedVerification;
  }

  return packet;
}

export function prepareRoleRequest(
  parentRequest: Record<string, unknown>,
  role: string,
  priorSteps: Record<string, unknown>[],
  parentJobPath: string,
): Record<string, unknown> {
  let childRequest = structuredClone(parentRequest);
  childRequest.assistant_role = role;
  childRequest.workflow_roles = [role];
  childRequest.session_id = randomUUID();
  childRequest.resume_session_id = null;
  childRequest.completion_contract = defaultCompletionContract(role);
  childRequest.task_packet = inheritChildTaskPacket(parentRequest, role);
  childRequest.lineage = {
    action: "workflow_step",
    parent_job_path: parentJobPath,
    workflow_root_session_id: parentRequest.session_id,
  };
  childRequest.skip_ledger = true;
  childRequest = finalizeRequest(childRequest);
  childRequest.system_prompt = buildSystemPrompt(
    parentRequest.base_system_prompt as string | null,
    role,
  );
  childRequest.prompt = buildDelegatePrompt(
    childRequest.task_packet as Record<string, unknown>,
    {
      assistantRole: role,
      completionContract: childRequest.completion_contract as Record<
        string,
        unknown
      >,
      deltaPrompt: (childRequest.delta_prompt as string) ?? null,
      priorSteps,
    },
  );
  return childRequest;
}
