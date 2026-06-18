export const SHAPES = [
  "http-server",
  "http-client",
  "db:pg",
  "db:mysql",
  "db:sqlite",
  "db:d1",
  "db:clickhouse",
  "ai",
  "rpc",
  "frontend",
  "node",
  "bun",
  "browser",
  "worker",
  "library",
  "node-tool",
  "workflow",
]

export const RULES = {
  EFF000: {
    name: "missing-manifest",
    family: "infra",
    severity: "error",
    message: "--strict requires .effect-skill.json",
    ref: "references/scanner-manifest.md §EFF000 missing-manifest",
  },
  EFF200: {
    name: "effect-test-without-effect-vitest",
    family: "file-pair",
    severity: "error",
    message: "Effect tests must import @effect/vitest.",
    ref: "references/scanner-manifest.md §EFF200 effect-test-without-effect-vitest",
  },
  EFF300: {
    name: "pg-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:pg requires @effect/sql-pg and forbids direct pg dependency.",
    ref: "references/scanner-manifest.md §EFF300 pg-without-effect-sql",
  },
  EFF301: {
    name: "mysql-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:mysql requires @effect/sql-mysql2 and forbids direct mysql2 dependency.",
    ref: "references/scanner-manifest.md §EFF301 mysql-without-effect-sql",
  },
  EFF302: {
    name: "sqlite-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:sqlite requires @effect/sql-sqlite-node or @effect/sql-sqlite-bun and forbids direct better-sqlite3 dependency.",
    ref: "references/scanner-manifest.md §EFF302 sqlite-without-effect-sql",
  },
  EFF303: {
    name: "d1-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:d1 requires @effect/sql-d1.",
    ref: "references/scanner-manifest.md §EFF303 d1-without-effect-sql",
  },
  EFF304: {
    name: "clickhouse-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:clickhouse requires @effect/sql-clickhouse and forbids direct @clickhouse/client dependency.",
    ref: "references/scanner-manifest.md §EFF304 clickhouse-without-effect-sql",
  },
  EFF310: {
    name: "http-server-without-effect-platform",
    family: "package",
    severity: "error",
    message: "shape http-server requires @effect/platform and a platform runtime adapter.",
    ref: "references/scanner-manifest.md §EFF310 http-server-without-effect-platform",
  },
  EFF311: {
    name: "http-client-without-effect-platform",
    family: "package",
    severity: "error",
    message: "shape http-client requires @effect/platform and forbids direct axios/got/node-fetch dependencies.",
    ref: "references/scanner-manifest.md §EFF311 http-client-without-effect-platform",
  },
  EFF312: {
    name: "ai-without-effect-ai",
    family: "package",
    severity: "error",
    message: "shape ai requires @effect/ai plus either an @effect/ai-* provider package or manifest-owned aiProviderTransports; direct provider SDK dependencies are forbidden.",
    ref: "references/scanner-manifest.md §EFF312 ai-without-effect-ai",
  },
  EFF313: {
    name: "workflow-without-effect-workflow",
    family: "package",
    severity: "error",
    message: "shape workflow requires @effect/workflow.",
    ref: "references/scanner-manifest.md §EFF313 workflow-without-effect-workflow",
  },
  EFF314: {
    name: "rpc-without-effect-rpc",
    family: "package",
    severity: "error",
    message: "shape rpc requires @effect/rpc.",
    ref: "references/scanner-manifest.md §EFF314 rpc-without-effect-rpc",
  },
  EFF315: {
    name: "frontend-without-effect-atom",
    family: "package",
    severity: "error",
    message: "shape frontend requires @effect-atom/atom-react.",
    ref: "references/scanner-manifest.md §EFF315 frontend-without-effect-atom",
  },
  EFF320: {
    name: "app-without-effect-opentelemetry",
    family: "package",
    severity: "error",
    message: "non-library/non-tool shapes require @effect/opentelemetry dependency presence.",
    ref: "references/scanner-manifest.md §EFF320 app-without-effect-opentelemetry",
  },
  EFF321: {
    name: "missing-effect-vitest",
    family: "package",
    severity: "error",
    message: "non-empty shape requires @effect/vitest in devDependencies.",
    ref: "references/scanner-manifest.md §EFF321 missing-effect-vitest",
  },
  EFF322: {
    name: "mixed-effect-major",
    family: "package",
    severity: "error",
    message: "A package must not mix Effect v3 and v4 runtime ecosystem packages unless manifest effectMajorPolicy is dual-track.",
    ref: "references/scanner-manifest.md §EFF322 mixed-effect-major",
  },
  EFF323: {
    name: "v4-opentelemetry-missing-peer",
    family: "package",
    severity: "error",
    message: "Effect v4 @effect/opentelemetry requires the full @opentelemetry/* peer closure.",
    ref: "references/scanner-manifest.md §EFF323 v4-opentelemetry-missing-peer",
  },
  EFF324: {
    name: "effect-version-conflict",
    family: "package",
    severity: "error",
    message: "Declared and installed Effect major versions disagree; version-gated rules are paused until dependency reality matches intent.",
    ref: "references/scanner-manifest.md §EFF324 effect-version-conflict",
  },
  EFF400: {
    name: "run-outside-executable-edge",
    family: "edge",
    severity: "error",
    message: "Effect.run* is only allowed in manifest executableEdges.",
    ref: "references/scanner-manifest.md §EFF400 run-outside-executable-edge",
  },
  EFF401: {
    name: "edge-without-runmain",
    family: "edge",
    severity: "error",
    message: "executableEdges must use NodeRuntime.runMain, BunRuntime.runMain, or BrowserRuntime.runMain.",
    ref: "references/scanner-manifest.md §EFF401 edge-without-runmain",
  },
  EFF402: {
    name: "platform-constructor-outside-adapter",
    family: "edge",
    severity: "error",
    message: "Response/Request/WebSocket/EventSource constructors are only allowed in manifest allowedAdapters.",
    ref: "references/scanner-manifest.md §EFF402 platform-constructor-outside-adapter",
  },
  EFF403: {
    name: "namespace-import-effect",
    family: "edge",
    severity: "error",
    message: "Namespace imports from effect or @effect/* are forbidden.",
    ref: "references/scanner-manifest.md §EFF403 namespace-import-effect",
  },
  EFF404: {
    name: "dynamic-import-require-in-src",
    family: "edge",
    severity: "error",
    message: "require() and top-level dynamic import() are forbidden in source files.",
    ref: "references/scanner-manifest.md §EFF404 dynamic-import-require-in-src",
  },
  EFF500: {
    name: "floating-effect",
    family: "lsp",
    severity: "error",
    message: "Effect language-service reported a floating Effect.",
    ref: "references/language-service.md §3. 关键诊断",
  },
  EFF501: {
    name: "missing-effect-context",
    family: "lsp",
    severity: "error",
    message: "Effect language-service reported an unprovided service dependency.",
    ref: "references/language-service.md §3. 关键诊断",
  },
  EFF502: {
    name: "missing-effect-error",
    family: "lsp",
    severity: "error",
    message: "Effect language-service reported an unhandled error channel.",
    ref: "references/language-service.md §3. 关键诊断",
  },
  EFF503: {
    name: "unclosed-layer",
    family: "lsp",
    severity: "error",
    message: "Effect language-service reported an unclosed Layer dependency/error channel.",
    ref: "references/language-service.md §3. 关键诊断",
  },
  EFF900: {
    name: "invalid-manifest",
    family: "infra",
    severity: "error",
    message: ".effect-skill.json failed schema validation.",
    ref: "references/scanner-manifest.md §EFF900 invalid-manifest",
  },
  EFF901: {
    name: "missing-tsc",
    family: "infra",
    severity: "error",
    message: "--strict requires a project-local TypeScript compiler.",
    ref: "references/scanner-manifest.md §EFF901 missing-tsc",
  },
  EFF902: {
    name: "missing-effect-language-service",
    family: "infra",
    severity: "error",
    message: "--strict requires @effect/language-service in devDependencies.",
    ref: "references/scanner-manifest.md §EFF902 missing-effect-language-service",
  },
  EFF903: {
    name: "empty-shape",
    family: "infra",
    severity: "error",
    message: "--strict requires a non-empty package shape.",
    ref: "references/scanner-manifest.md §EFF903 empty-shape",
  },
  EFF904: {
    name: "lsp-probe-failed",
    family: "infra",
    severity: "error",
    message: "Effect language-service probe did not prove bridge availability.",
    ref: "references/scanner-manifest.md §EFF904 lsp-probe-failed",
  },
  EFF905: {
    name: "invalid-runtime-fact-source",
    family: "infra",
    severity: "error",
    message: "Declared runtime fact source could not be read as supported facts.",
    ref: "references/scanner-manifest.md §EFF905 invalid-runtime-fact-source",
  },
  EFF906: {
    name: "ambiguous-worker-shape",
    family: "infra",
    severity: "error",
    message: "shape worker is ambiguous without a declared runtime fact source such as wranglerPath.",
    ref: "references/scanner-manifest.md §EFF906 ambiguous-worker-shape",
  },
}

export function ruleMeta(ruleId) {
  return RULES[ruleId] ?? {
    name: ruleId,
    family: "unknown",
    severity: "error",
    message: ruleId,
  }
}

export function makeFinding(root, partial) {
  const meta = ruleMeta(partial.ruleId)
  return {
    file: partial.file ?? ".",
    line: partial.line ?? 1,
    lineText: partial.lineText ?? "",
    ruleId: partial.ruleId,
    ruleName: partial.ruleName ?? meta.name,
    severity: partial.severity ?? meta.severity,
    message: partial.message ?? meta.message,
    ref: partial.ref ?? meta.ref ?? null,
    package: partial.package ?? null,
    family: partial.family ?? meta.family,
  }
}

export function isCoreBan(ruleId) {
  const n = Number(ruleId.replace(/^EFF/, ""))
  return n >= 1 && n <= 32
}

export function isToolLikeShape(shape) {
  return shape === "library" || shape === "node-tool"
}

export function packageRequiresOtel(shape) {
  return shape.length > 0 && !shape.every(isToolLikeShape)
}
