import { artifactPaths, readJson } from "./common.js";
import { compactParentHandoff, renderStructuredItem } from "./prompt-context.js";

export function shapeHandoff(
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  const completion = (envelope.completion ?? {}) as Record<string, unknown>;

  return {
    ok: (envelope.ok as boolean) ?? false,
    error_type: envelope.error_type ?? null,
    error_message: envelope.error_message ?? null,
    summary:
      (completion.summary as string) ?? (envelope.result as string) ?? "",
    findings: (envelope.findings as unknown[]) ?? [],
    open_risks: (envelope.open_risks as unknown[]) ?? [],
    changed_files: (envelope.changed_files as unknown[]) ?? [],
    diff_summary: (envelope.diff_summary as unknown[]) ?? [],
    files_examined: (envelope.files_examined as unknown[]) ?? [],
    test_commands: (envelope.test_commands as unknown[]) ?? [],
    suggested_actions: (envelope.suggested_actions as unknown[]) ?? [],
    task_packet_summary: (envelope.task_packet_summary as Record<string, unknown>) ?? {},
    execution_summary: {
      duration_ms: envelope.duration_ms ?? null,
      num_turns: envelope.num_turns ?? null,
      total_cost_usd: envelope.total_cost_usd ?? null,
    },
    boundary_status:
      ((envelope.boundary as Record<string, unknown>) ?? {}).status ?? null,
    verification_status:
      ((envelope.verification as Record<string, unknown>) ?? {}).status ?? null,
    assistant_role: envelope.assistant_role ?? null,
  };
}

export function loadParentHandoff(
  jobPath: string,
): Record<string, unknown> | null {
  const paths = artifactPaths(jobPath);
  return readJson(paths.handoff);
}

export function renderParentHandoff(
  parentHandoff: Record<string, unknown> | null,
): string[] {
  if (!parentHandoff) return [];
  return renderStructuredItem(
    "Parent handoff:",
    compactParentHandoff(parentHandoff),
  );
}
