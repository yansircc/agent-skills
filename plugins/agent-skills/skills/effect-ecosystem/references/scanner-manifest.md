# Scanner v2 Manifest And Agent Workflow

Scanner v2 has three outputs with different authority:

- `findings`: deterministic, mechanically falsifiable evidence. Error findings
  decide exit code; warning findings are report-only.
- `profile`: resolved routing state for the reviewer. It is not a semantic
  verdict.
- `signals`: atomic observations for agent review. They never prove the review
  is complete.

`effect-skill-scan --strict` passing means the mechanical layer found no
violations. It does not mean the agent completed the semantic review required by
`SKILL.md`.

Gate actionability is fixed: error findings are `BLOCK`, warning findings are
`REPORT`, and signals are `REVIEW`.

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
with source positions owns TOML.

Monorepos use `packages[]`. `dependencyOwner: "workspace-root"` means the
workspace root owns dependency intent for that package; otherwise the package
local `package.json` is the dependency owner.

`worker` is not a semantic profile by itself. A package that declares
`shape: ["worker"]` must also declare `wranglerPath`; otherwise the scanner
emits `EFF906` because the runtime role is ambiguous.

Targets may append product-specific non-proof boundaries to the gate summary:

```json
{
  "shape": ["library"],
  "gate": {
    "notProven": [
      {
        "id": "live-recorded-authored",
        "owner": "agentOS",
        "reason": "agentOS architecture invariant outside Effect scanner scope"
      }
    ]
  }
}
```

The scanner default `notProven` list contains only generic categories such as
type-level limits beyond LSP, runtime behavior, and architecture boundaries.
Product-specific names belong in the target manifest, not scanner code.

## Contract Owners

Growing scanner contract enumerations must live in a checked owner. Unchecked
prose is not a contract surface.

### Contract Owner: rules

`contracts/rules.json` owns line-regex rules `EFF001`-`EFF032`. Generated docs
and `validator/rules.jsonl` are derived from this file.

### Contract Owner: signals

`contracts/signals.schema.json` owns signal kinds, required top-level fields,
fact schemas, `skill_ref`, and `agent_action`.

### Contract Owner: effect-capabilities

`contracts/effect-capabilities.json` owns v3/v4 package requirements, import
roots, runtime adapters, v4 unstable boundaries, tooling packages, dual-track
policy, and OTel peer closure policy.

### Contract Owner: scan-evidence

`contracts/scan-evidence.schema.json` owns `ScanEvidenceV1`. The hash-stable
input subtree is `target + resolution + capabilities + references`; scanner
provenance is stored separately and only affects `fullHash`.

### Contract Owner: gate-summary

`contracts/gate-summary.schema.json` owns the CST/CI gate projection. It is
derived from raw scan output and scan evidence; it must not recompute resolver
or provenance facts.

## Strict Contract

`--strict` has no fallback:

### EFF000 missing-manifest

Missing `.effect-skill.json` is an infra error.

### EFF900 invalid-manifest

Invalid manifest JSON or schema shape is an infra error.

### EFF901 missing-tsc

Strict mode requires a project-local TypeScript compiler.

### EFF902 missing-effect-language-service

Strict mode requires project-local `@effect/language-service`.

### EFF903 empty-shape

Strict mode requires at least one declared package shape.

### EFF904 lsp-probe-failed

The language-service bridge must prove availability before LSP diagnostics are
trusted.

Profile routing has no fallback. The resolver separates declared intent from
installed reality:

- `declaredMajor`: manifest dependency owner -> `package.json` range.
- `installedMajor`: supported lockfile -> local non-symlink
  `node_modules/effect/package.json`.
- comparison: `matched | conflict | declared-only | installed-only |
  unresolved`.

If `profile.effectVersionsResolution` is `unresolved`, fix dependency ownership
before semantic review. If it is `conflict`, fix the declared/installed major
drift before trusting v3-only or v4-only findings.

## Package And Capability Rules

### EFF300 pg-without-effect-sql

`db:pg` must be owned by the Effect SQL capability for the resolved Effect
major.

### EFF301 mysql-without-effect-sql

`db:mysql` must be owned by the Effect SQL capability for the resolved Effect
major.

### EFF302 sqlite-without-effect-sql

`db:sqlite` must be owned by the Effect SQL capability for the resolved Effect
major.

### EFF303 d1-without-effect-sql

`db:d1` must be owned by the Effect SQL/D1 capability for the resolved Effect
major.

### EFF304 clickhouse-without-effect-sql

`db:clickhouse` must be owned by the Effect SQL capability for the resolved
Effect major.

### EFF310 http-server-without-effect-platform

HTTP server capability must follow the resolved major contract. v3 requires
`@effect/platform` plus an adapter; v4 may be satisfied by the v4 `effect`
unstable HTTP capability.

### EFF311 http-client-without-effect-platform

HTTP client capability must follow the resolved major contract and avoid direct
HTTP client libraries.

### EFF312 ai-without-effect-ai

AI capability must be owned by `@effect/ai` in v3 or the v4 capability
contract. Provider SDKs are terminal adapters only.

### EFF313 workflow-without-effect-workflow

Workflow capability must be owned by the resolved Effect workflow contract.

### EFF314 rpc-without-effect-rpc

RPC capability must be owned by the resolved Effect RPC contract.

### EFF315 frontend-without-effect-atom

Frontend React state integration still requires a proven React adapter. v4
browser runtime proof is not React integration proof.

### EFF320 app-without-effect-opentelemetry

Non-library/non-tool shapes require `@effect/opentelemetry` dependency presence.

### EFF321 missing-effect-vitest

Any non-empty shape requires `@effect/vitest` in `devDependencies`.

### EFF322 mixed-effect-major

A package must not mix v3 and v4 Effect runtime ecosystem packages unless the
manifest explicitly declares `effectMajorPolicy: "dual-track"`.

### EFF323 v4-opentelemetry-missing-peer

For pinned `effect@4.0.0-beta.84`, v4 `@effect/opentelemetry` requires the full
`@opentelemetry/*` peer closure declared in `effect-capabilities.json`. When the
v4 beta or peer closure changes, run `make verify-v4-acceptance` before keeping
this as a deterministic finding; otherwise the condition is downgraded to the
`effect-capability-proof-gap` signal.

### EFF324 effect-version-conflict

Declared and installed Effect major versions disagree. The scanner emits this
finding and pauses version-gated package rules until dependency reality matches
declared intent.

## Executable And Adapter Rules

### EFF200 effect-test-without-effect-vitest

Effect tests must use `@effect/vitest`.

### EFF400 run-outside-executable-edge

`Effect.run*` is only allowed in manifest-owned executable edges.

### EFF401 edge-without-runmain

Executable edges must use the runtime `runMain` boundary.

### EFF402 platform-constructor-outside-adapter

Platform constructors such as `Response`, `Request`, `WebSocket`, and
`EventSource` are only allowed in manifest-owned adapters.

### EFF403 namespace-import-effect

Namespace imports from `effect` or `@effect/*` are forbidden.

### EFF404 dynamic-import-require-in-src

`require()` and top-level dynamic `import()` are forbidden in source files.

### EFF905 invalid-runtime-fact-source

Declared runtime fact source could not be read as supported facts.

### EFF906 ambiguous-worker-shape

`shape: ["worker"]` is ambiguous without a runtime fact source such as
`wranglerPath`.

## LSP Rules

`EFF500`-`EFF503` are emitted only from `@effect/language-service`; the scanner
does not reimplement Effect typeflow.

## Agent Workflow

1. Run `effect-skill-scan <repo> --strict --json --profile --evidence <dir>`.
2. Read `profile.effectVersionsResolution`, `profile.effectVersionsProof`, and
   evidence/resolver output. Do not manually infer version truth from package
   files when resolver output exists.
3. Treat error findings as mechanical blockers. Warning findings are report-only.
4. If version resolution is `unresolved` or `conflict`, stop and repair the
   dependency owner or install state before version-gated semantic review.
5. Treat `signals` as review prompts. Read each `skill_ref`, compare it to the
   code, and write an explicit judgment.
6. Record `gate-summary.json` in CST/CI evidence and keep raw JSON as an
   artifact path. Do not paste full raw JSON into task evidence.
7. Do not batch-fix signals by name. A signal is an atomic fact, not a verdict.

## Agent Review Signals

### Signal: cloudflare-runtime-facts

Reports supported `wranglerPath` facts: platform, compatibility date, flags,
entry point, bindings, limits, and source-positioned parse errors.

### Signal: http-api-boundary-file

Reports files containing HttpApi tokens and whether Schema imports are visible.

### Signal: rpc-boundary-file

Reports files containing RPC boundary tokens and whether Schema imports are
visible.

### Signal: library-exported-effect-file

Reports exported library Effect files that contain Effect tokens and no visible
`Effect.withSpan` token.

### Signal: library-exported-effect-package

Reports one package-level rollup for exported library Effect files, including
counts with and without visible span tokens.

### Signal: ai-runtime-facts

Reports AI dependency presence, Effect AI provider packages, manifest-declared
provider transports, and direct provider SDK dependencies.

### Signal: observability-wiring-facts

Reports dependency presence and discovered `@effect/opentelemetry` layer
factories such as `NodeSdk.layer`, `WebSdk.layer`, or `Otlp.layer`.

### Signal: resilience-boundary-file

Reports retry/repeat calls, Schedule members, and no semantic judgment about
whether jitter is required.

### Signal: pubsub-ordering-file

Reports PubSub calls and constructors. Subscriber ordering is reviewed by the
agent against replay requirements.

### Signal: effect-capability-proof-gap

Reports a v4 beta capability condition that is not backed by the pinned
acceptance proof. Run the pinned v4 acceptance gate before promoting it back to a
deterministic finding.

## Evidence Bundle

`effect-skill-scan <repo> --strict --json --profile --evidence <dir>` writes:

- `scan-evidence.json`
- `scan-result.json`
- `gate-summary.json`
- `input.sha256`
- `full.sha256`

`input.sha256` covers only `target + resolution + capabilities + references`
and is the target-state replay/debug hash. `full.sha256` covers the whole
evidence record, including scanner `build-info.json`, and is the audit hash.

`gate-summary.json` is the CST/CI consumption surface. It contains
`ok = errors === 0`, block/report/review tiers, scanner provenance references,
and `complianceHash`.

`complianceHash` hashes normalized block/report findings plus scanner build id.
It is comparable only when `scanner.buildId` is equal. If the scanner build
changes, re-baseline the gate instead of treating the hash as comparable. Dirty
scanner builds are not reproducible acceptance evidence.

## Timings And Cache

`--timings` adds non-deterministic stage timings to the scan result. Timings are
debug telemetry only; they must not enter `input.sha256` or any other
hash-stable target-state oracle.

Strict LSP diagnostics remain part of `--strict`. The scanner may cache
`@effect/language-service` diagnostics by full tsconfig program closure, Effect
version, TypeScript version, language-service version, package metadata,
lockfile content, repo-relative program paths, and program file content. It must
not use mtime as a cache correctness input. Cache provenance is scanner
provenance: it can affect `full.sha256`, but it must not affect `input.sha256`.

The LSP mapping proof guards rename drift for diagnostics the scanner maps into
EFF500-EFF503. It does not claim full coverage of every diagnostic currently
emitted by `@effect/language-service`; unmapped diagnostics are signal candidates
for future rule graduation, not current scanner failures.

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
