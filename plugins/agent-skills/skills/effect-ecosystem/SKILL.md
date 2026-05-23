---
name: effect-ecosystem
description: Use when writing, reviewing, or refactoring TypeScript projects that use Effect v3/v4 or Effect ecosystem packages, including effect, @effect/platform, @effect/sql, @effect/rpc, @effect/ai, @effect/workflow, @effect/cluster, @effect/opentelemetry, @effect/vitest, effect-atom, and @lucas-barake/effect-form. Also use when migrating common non-Effect TypeScript patterns into Effect-owned equivalents.
---

# Effect Ecosystem Executor

This skill is an execution entrypoint, not the rule owner. Rule facts live in
`contracts/rules.json`; generated summaries live in
`references/generated/rules-summary.md` and `references/generated/checklist.md`.

## Invariant

One Effect semantic rule has one owner. Do not hand-edit the same rule into
`SKILL.md`, scanner rules, and checklist text. Update `contracts/rules.json`,
then run:

```bash
make build
node dist/scripts/generate-derived-docs.js
```

Fast fail instead of fallback. If required substrate is missing or ambiguous,
stop and repair the owner input; do not load broad references or continue with a
compatibility guess.

## Workflow

1. Identify the target Effect version from `package.json`, lockfiles, or local
   `node_modules/effect/package.json`.
2. Read the target `.effect-skill.json` and derive the active profiles from
   `shape` / `packages`.
3. Run the scanner:

   ```bash
   effect-skill-scan <repo> --strict --json --profile
   ```

4. Treat `findings` as mechanical evidence. Fix them or add an owned,
   reasoned suppression.
5. Treat `signals` as agent review prompts. Read the referenced files and make
   a written judgment against the relevant references.
6. Load only `profile.requiredReferences` from the scanner output. If the field
   is missing, the installed scanner is stale; run `make install` and `make verify`.
   If `profile.effectVersionsResolution` is `unresolved`, fix `package.json` or
   the manifest before continuing.
7. If the same friction class lands in project evidence twice, graduate it into
   a skill artifact instead of leaving another project-only note.
8. Each new spike must name its own invariant; do not reuse an existing
   reference theme unless the generator is actually shared.
9. Before delivery, run the verification gates listed below.

## Reference Routing

The scanner owns reference routing. `effect-skill-scan <repo> --strict --json
--profile` emits `profile.activeProfiles`, `profile.effectVersions`, and
`profile.requiredReferences`. Load those exact files.

The generated references `references/generated/rules-summary.md` and
`references/generated/checklist.md` are included by `profile.requiredReferences`.

Existing deep references remain available for API details:
`references/core-modules.md`, `references/platform-http.md`,
`references/schema.md`, `references/sql-and-rpc.md`,
`references/effect-ai.md`, `references/effect-atom.md`,
`references/effect-form.md`, `references/observability.md`,
`references/errors-and-layers.md`, `references/testing.md`,
`references/runtime-boundaries.md`, `references/workflow.md`,
`references/v4-migration.md`.

CST store migration for old task graphs: `references/cst-migration.md`.

## Verification

For this skill repository:

```bash
make install
make verify
```

For a target project, run its normal tests plus
`effect-skill-scan <repo> --strict --json --profile`.

## Host Tooling Boundary

This repository contains a Node-based scanner under `validator/**`. That code is
host tooling for the skill, not target application code. The target-project
Effect rules apply to repositories being scanned; host tooling compliance is
tracked separately by this repo's own registry and verification scripts.
