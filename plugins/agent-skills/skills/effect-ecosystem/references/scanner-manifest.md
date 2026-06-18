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
  ],
  "aiProviderTransports": [
    {
      "path": "src/ai/provider-transport.ts",
      "owner": "@ai-transport",
      "reason": "terminal provider HTTP transport; @effect/ai owns loop semantics"
    }
  ]
}
```

Cloudflare targets can add `wranglerPath` to declare the runtime fact source.
Only `wrangler.json` and `wrangler.jsonc` are supported until a real TOML parser
with source positions owns TOML:

```json
{
  "shape": ["http-server"],
  "wranglerPath": "wrangler.jsonc"
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

`worker` is not a semantic profile by itself. A package that declares
`shape: ["worker"]` must also declare `wranglerPath`; otherwise the scanner
emits `EFF906` because the runtime role is ambiguous.

`ai` requires `@effect/ai`. Provider execution can be satisfied either by an
`@effect/ai-*` provider package or by explicit `aiProviderTransports[]` owner
entries. The second form is for repos that keep provider HTTP/SSE transports as
terminal adapters while `@effect/ai` owns the agent loop and tool semantics.
Direct provider SDK dependencies such as `openai` or `@anthropic-ai/sdk` remain
forbidden.

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

`effectMajorPolicy: "dual-track"` is the only manifest escape hatch for a
package that intentionally publishes both v3 and v4 runtime variants. Without
that declaration, mixing `effect@4` with v3-era `@effect/*` runtime packages, or
`effect@3` with v4 `@effect/*` packages, is a package-rule error.

## Agent Workflow

1. Run `effect-skill-scan <repo> --strict --json --profile`.
2. Treat `findings` as mechanical evidence. Fix the code or add a structured,
   owned suppression.
3. If `profile.effectVersionsResolution` is `unresolved`, stop and fix
   dependency ownership before semantic review.
4. Treat `signals` as review prompts. Read each referenced file, compare it to
   `SKILL.md`, and write an explicit judgment.
5. Do not batch-fix signals by name. A signal is an atomic fact, not a verdict.

`observability-wiring-facts` reports dependency presence plus discovered
`@effect/opentelemetry` layer factories such as `NodeSdk.layer`, `WebSdk.layer`,
or `Otlp.layer`. The scanner does not choose the correct runtime SDK for the
target package; the reviewer must judge the emitted facts against the declared
runtime shape.

`cloudflare-runtime-facts` reports facts read from supported `wranglerPath`
files: platform,
compat date, compat flags, entry point, bindings, and configured limits. It must
not infer Node runtime support from `nodejs_compat`, binding Layer correctness,
request-scope safety, or any other runtime verdict. Use
`references/runtime-boundaries.md` and record `validUnder` before claiming
support.

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

`allowedAdapters.path` uses the same glob matcher as generated and host-tooling
paths, so one owner entry can cover a coherent adapter family such as
`src/lib/**/*.test.ts`.

Use `--fail-on-suppression-drift` to reject expired, orphaned, or ownerless
suppressions.
