import { dedupeStrings } from "./contracts.js";

export function stepSummary(
  envelope: Record<string, unknown>,
  role: string,
  jobPath: string,
): Record<string, unknown> {
  const completion = (envelope.completion ?? {}) as Record<string, unknown>;
  return {
    role,
    job_path: jobPath,
    ok: (envelope.ok as boolean) ?? false,
    session_id: envelope.session_id ?? null,
    summary:
      (completion.summary as string) ?? (envelope.result as string) ?? "",
    error_type: envelope.error_type ?? null,
    boundary_status:
      ((envelope.boundary as Record<string, unknown>) ?? {}).status ?? null,
    findings: (envelope.findings as unknown[]) ?? [],
    open_risks: (envelope.open_risks as unknown[]) ?? [],
    changed_files: (envelope.changed_files as unknown[]) ?? [],
    diff_summary: (envelope.diff_summary as unknown[]) ?? [],
    files_examined: (envelope.files_examined as unknown[]) ?? [],
    test_commands: (envelope.test_commands as unknown[]) ?? [],
    suggested_actions: (envelope.suggested_actions as unknown[]) ?? [],
    verification_status:
      ((envelope.verification as Record<string, unknown>) ?? {}).status ?? null,
  };
}

export function aggregateBoundary(
  stepEnvelopes: Record<string, unknown>[],
): Record<string, unknown> {
  const violations: Record<string, unknown>[] = [];
  for (const envelope of stepEnvelopes) {
    const boundary = (envelope.boundary ?? {}) as Record<string, unknown>;
    const vs = (boundary.violations ?? []) as Record<string, unknown>[];
    violations.push(...vs);
  }
  return {
    status: violations.length > 0 ? "violated" : "passed",
    violations,
  };
}

export function aggregateVerification(
  stepEnvelopes: Record<string, unknown>[],
): Record<string, unknown> {
  const statuses = stepEnvelopes.map(
    (envelope) =>
      ((envelope.verification as Record<string, unknown>) ?? {}).status as
        | string
        | undefined,
  );
  const commands: string[] = [];
  const results: Record<string, unknown>[] = [];
  let failOnError = false;

  for (const envelope of stepEnvelopes) {
    const verification = (envelope.verification ?? {}) as Record<
      string,
      unknown
    >;
    commands.push(...((verification.commands as string[]) ?? []));
    results.push(
      ...((verification.results as Record<string, unknown>[]) ?? []),
    );
    failOnError =
      failOnError || ((verification.fail_on_error as boolean) ?? false);
  }

  let status: string;
  if (statuses.some((s) => s === "failed")) {
    status = "failed";
  } else if (statuses.some((s) => s === "passed")) {
    status = "passed";
  } else {
    status = "skipped";
  }

  return {
    status,
    fail_on_error: failOnError,
    commands: dedupeStrings(commands),
    results,
  };
}
