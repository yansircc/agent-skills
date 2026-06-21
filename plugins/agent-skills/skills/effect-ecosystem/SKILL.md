---
name: effect-ecosystem
description: Use when writing, reviewing, or refactoring TypeScript projects that use Effect v3/v4 or Effect ecosystem packages, including effect, @effect/platform, @effect/sql, @effect/rpc, @effect/ai, @effect/workflow, @effect/cluster, @effect/opentelemetry, @effect/vitest, effect-atom, and @lucas-barake/effect-form. Also use when migrating common non-Effect TypeScript patterns into Effect-owned equivalents.
---

# Effect Ecosystem Executor

This skill is an execution entrypoint, not the rule owner. Rule facts live in
`contracts/rules.json`; signal and version capability contracts live in
`contracts/signals.schema.json` and `contracts/effect-capabilities.json`.
Generated summaries live in `references/generated/rules-summary.md` and
`references/generated/checklist.md`.

## Invariant

One Effect semantic rule has one owner. Do not hand-edit the same rule into
`SKILL.md`, scanner rules, and checklist text. Update the owner contract first:
`contracts/rules.json`, `contracts/signals.schema.json`, or
`contracts/effect-capabilities.json`. Then run:

```bash
make build
node dist-dev/scripts/generate-derived-docs.js
```

Fast fail instead of fallback. If required substrate is missing or ambiguous,
stop and repair the owner input; do not load broad references or continue with a
compatibility guess.

## Workflow

1. Read the scanner profile/resolver output for Effect version, proof state,
   active profiles, required references, and signals.
2. Read the target `.effect-skill.json` only to understand manifest ownership
   when the scanner reports a finding or unresolved proof.
3. Run the scanner:

   ```bash
   effect-skill-scan <repo> --strict --output gate-json --evidence <dir>
   ```

4. Record `<dir>/gate-summary.json` as the Effect mechanical compliance gate.
   Keep `<dir>/scan-result.json` as an artifact path instead of pasting raw JSON
   into task evidence.
5. Treat error findings as mechanical blockers. Warning findings are report-only.
   Fix blockers or add an owned, reasoned suppression.
6. Treat `signals` as agent review prompts. Read the referenced files and make
   a written judgment against the relevant references.
7. Load only `effect.requiredReferences` from the gate output. If the field
   is missing, the installed scanner is stale; run `make install` for release and
   `make verify`. If `effect.resolution` is `unresolved` or
   `conflict`, fix declared intent or installed reality before continuing.
8. If the same friction class lands in project evidence twice, graduate it into
   a skill artifact instead of leaving another project-only note.
9. Each new spike must name its own invariant; do not reuse an existing
   reference theme unless the generator is actually shared.
10. Before delivery, run the verification gates listed below.

## Reference Routing

The scanner owns reference routing. `effect-skill-scan <repo> --strict --output
gate-json` emits `effect.activeProfiles`, `effect.versions`, and
`effect.requiredReferences`. Load those exact files.

The generated references `references/generated/rules-summary.md` and
`references/generated/checklist.md` are included by `effect.requiredReferences`.

Existing deep references remain available for API details:
`references/core-modules.md`, `references/platform-http.md`,
`references/schema.md`, `references/sql-and-rpc.md`,
`references/effect-ai.md`, `references/effect-atom.md`,
`references/effect-form.md`, `references/observability.md`,
`references/concurrency-primitives.md`, `references/scheduling.md`,
`references/resource-management.md`, `references/language-service.md`,
`references/errors-and-layers.md`, `references/testing.md`,
`references/runtime-boundaries.md`, `references/workflow.md`,
`references/v4-migration.md`.

CST store migration for old task graphs: `references/cst-migration.md`.

## Verification

For this skill repository:

```bash
make verify
```

`make install` publishes an immutable `dist-installed/<buildId>/` scanner
artifact and updates the local bin symlink. Do not run it during development
unless releasing the scanner.

v4 acceptance is opt-in and intentionally not part of default `make verify`:

```bash
make verify-v4-acceptance
```

For a target project, run its normal tests plus
`effect-skill-scan <repo> --strict --output gate-json --evidence <dir>`.

## Host Tooling Boundary

This repository contains a Node-based scanner under `validator/**`. That code is
host tooling for the skill, not target application code. The target-project
Effect rules apply to repositories being scanned; host tooling compliance is
tracked separately by this repo's own registry and verification scripts.
