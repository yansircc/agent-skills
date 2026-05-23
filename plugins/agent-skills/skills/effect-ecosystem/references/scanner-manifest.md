# Scanner v2 Manifest And Agent Workflow

Scanner v2 has two outputs with different authority:

- `findings`: deterministic, mechanically falsifiable evidence. These decide
  exit code.
- `profile` and `signals`: substrate for agent review. These never prove the
  semantic review is complete.

`effect-skill-scan --strict` passing means the mechanical layer found no
violations. It does not mean the agent completed the semantic review required by
`SKILL.md`.

## Manifest

Every strict target needs `.effect-skill.json`.

Single package:

```json
{
  "shape": ["http-server", "db:pg", "node"],
  "executableEdges": [
    { "path": "src/main.ts", "owner": "@runtime", "reason": "node entry" }
  ],
  "allowedAdapters": [
    {
      "path": "src/platform/http-edge.ts",
      "owner": "@platform",
      "reason": "terminal HTTP adapter",
      "rules": ["EFF402"]
    }
  ]
}
```

Monorepo:

```json
{
  "packages": [
    { "path": "apps/web", "shape": ["http-server", "frontend"] },
    {
      "path": "apps/worker",
      "shape": ["worker", "db:pg"],
      "dependencyOwner": "workspace-root",
      "dependencyOwnerReason": "workspace root owns shared runtime deps"
    },
    { "path": "packages/runtime", "shape": ["library"] }
  ]
}
```

Supported shapes are defined in `validator/lib/rule-policy.mjs`. That runtime
policy is the source of truth; schema and documentation must stay checked
against it.

## Strict Contract

`--strict` has no fallback:

- missing `.effect-skill.json` -> `EFF000`
- invalid manifest -> `EFF900`
- empty shape -> `EFF903`
- missing `tsc` -> `EFF901`
- missing `@effect/language-service` dev dependency -> `EFF902`

Profile routing also has no fallback. If the scanner cannot resolve an Effect
major version from package dependencies, `profile.effectVersionsResolution` is
`unresolved` and version-specific references are omitted. The agent must fix the
declared dependency owner instead of loading both v3 and v4 references.

## Agent Workflow

1. Run `effect-skill-scan <repo> --strict --json --profile`.
2. Treat `findings` as mechanical evidence. Fix the code or add a structured,
   owned suppression.
3. If `profile.effectVersionsResolution` is `unresolved`, stop and fix
   dependency ownership before semantic review.
4. Treat `signals` as review prompts. Read each referenced file, compare it to
   `SKILL.md`, and write an explicit judgment.
5. Do not batch-fix signals by name. A signal is an atomic fact, not a verdict.

## Suppression

Line suppression requires a reason:

```ts
Effect.runPromise(program) // eff-ignore EFF400 reason="legacy generated entry"
```

Manifest path suppression requires owner and reason:

```json
{
  "allowedAdapters": [
    {
      "path": "src/platform/http-edge.ts",
      "owner": "@platform",
      "reason": "only terminal adapter may construct Response",
      "rules": ["EFF402"]
    }
  ]
}
```

Use `--fail-on-suppression-drift` to reject expired, orphaned, or ownerless
suppressions.
