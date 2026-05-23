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
  },
  EFF200: {
    name: "effect-test-without-effect-vitest",
    family: "file-pair",
    severity: "error",
    message: "Effect tests must import @effect/vitest.",
  },
  EFF300: {
    name: "pg-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:pg requires @effect/sql-pg and forbids direct pg dependency.",
  },
  EFF301: {
    name: "mysql-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:mysql requires @effect/sql-mysql2 and forbids direct mysql2 dependency.",
  },
  EFF302: {
    name: "sqlite-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:sqlite requires @effect/sql-sqlite-node or @effect/sql-sqlite-bun and forbids direct better-sqlite3 dependency.",
  },
  EFF303: {
    name: "d1-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:d1 requires @effect/sql-d1.",
  },
  EFF304: {
    name: "clickhouse-without-effect-sql",
    family: "package",
    severity: "error",
    message: "shape db:clickhouse requires @effect/sql-clickhouse and forbids direct @clickhouse/client dependency.",
  },
  EFF310: {
    name: "http-server-without-effect-platform",
    family: "package",
    severity: "error",
    message: "shape http-server requires @effect/platform and a platform runtime adapter.",
  },
  EFF311: {
    name: "http-client-without-effect-platform",
    family: "package",
    severity: "error",
    message: "shape http-client requires @effect/platform and forbids direct axios/got/node-fetch dependencies.",
  },
  EFF312: {
    name: "ai-without-effect-ai",
    family: "package",
    severity: "error",
    message: "shape ai requires an @effect/ai provider and forbids direct provider SDK dependencies.",
  },
  EFF313: {
    name: "workflow-without-effect-workflow",
    family: "package",
    severity: "error",
    message: "shape workflow requires @effect/workflow.",
  },
  EFF314: {
    name: "rpc-without-effect-rpc",
    family: "package",
    severity: "error",
    message: "shape rpc requires @effect/rpc.",
  },
  EFF315: {
    name: "frontend-without-effect-atom",
    family: "package",
    severity: "error",
    message: "shape frontend requires @effect-atom/atom-react.",
  },
  EFF320: {
    name: "app-without-effect-opentelemetry",
    family: "package",
    severity: "error",
    message: "non-library/non-tool shapes require @effect/opentelemetry dependency presence.",
  },
  EFF321: {
    name: "missing-effect-vitest",
    family: "package",
    severity: "error",
    message: "non-empty shape requires @effect/vitest in devDependencies.",
  },
  EFF400: {
    name: "run-outside-executable-edge",
    family: "edge",
    severity: "error",
    message: "Effect.run* is only allowed in manifest executableEdges.",
  },
  EFF401: {
    name: "edge-without-runmain",
    family: "edge",
    severity: "error",
    message: "executableEdges must use NodeRuntime.runMain, BunRuntime.runMain, or BrowserRuntime.runMain.",
  },
  EFF402: {
    name: "platform-constructor-outside-adapter",
    family: "edge",
    severity: "error",
    message: "Response/Request/WebSocket/EventSource constructors are only allowed in manifest allowedAdapters.",
  },
  EFF403: {
    name: "namespace-import-effect",
    family: "edge",
    severity: "error",
    message: "Namespace imports from effect or @effect/* are forbidden.",
  },
  EFF404: {
    name: "dynamic-import-require-in-src",
    family: "edge",
    severity: "error",
    message: "require() and top-level dynamic import() are forbidden in source files.",
  },
  EFF500: {
    name: "floating-effect",
    family: "lsp",
    severity: "error",
    message: "Effect language-service reported a floating Effect.",
  },
  EFF501: {
    name: "missing-effect-context",
    family: "lsp",
    severity: "error",
    message: "Effect language-service reported an unprovided service dependency.",
  },
  EFF502: {
    name: "missing-effect-error",
    family: "lsp",
    severity: "error",
    message: "Effect language-service reported an unhandled error channel.",
  },
  EFF503: {
    name: "unclosed-layer",
    family: "lsp",
    severity: "error",
    message: "Effect language-service reported an unclosed Layer dependency/error channel.",
  },
  EFF900: {
    name: "invalid-manifest",
    family: "infra",
    severity: "error",
    message: ".effect-skill.json failed schema validation.",
  },
  EFF901: {
    name: "missing-tsc",
    family: "infra",
    severity: "error",
    message: "--strict requires a project-local TypeScript compiler.",
  },
  EFF902: {
    name: "missing-effect-language-service",
    family: "infra",
    severity: "error",
    message: "--strict requires @effect/language-service in devDependencies.",
  },
  EFF903: {
    name: "empty-shape",
    family: "infra",
    severity: "error",
    message: "--strict requires a non-empty package shape.",
  },
  EFF904: {
    name: "lsp-probe-failed",
    family: "infra",
    severity: "error",
    message: "Effect language-service probe did not prove bridge availability.",
  },
}

export const PACKAGE_REQUIREMENTS = [
  {
    ruleId: "EFF300",
    shapes: ["db:pg"],
    anyOf: ["@effect/sql-pg"],
    forbidden: ["pg"],
  },
  {
    ruleId: "EFF301",
    shapes: ["db:mysql"],
    anyOf: ["@effect/sql-mysql2"],
    forbidden: ["mysql2"],
  },
  {
    ruleId: "EFF302",
    shapes: ["db:sqlite"],
    anyOf: ["@effect/sql-sqlite-node", "@effect/sql-sqlite-bun"],
    forbidden: ["better-sqlite3"],
  },
  {
    ruleId: "EFF303",
    shapes: ["db:d1"],
    anyOf: ["@effect/sql-d1"],
    forbidden: [],
  },
  {
    ruleId: "EFF304",
    shapes: ["db:clickhouse"],
    anyOf: ["@effect/sql-clickhouse"],
    forbidden: ["@clickhouse/client"],
  },
  {
    ruleId: "EFF310",
    shapes: ["http-server"],
    allOf: ["@effect/platform"],
    anyOf: ["@effect/platform-node", "@effect/platform-bun", "@effect/platform-browser"],
    forbidden: ["express", "fastify", "hono", "koa", "hapi"],
  },
  {
    ruleId: "EFF311",
    shapes: ["http-client"],
    allOf: ["@effect/platform"],
    forbidden: ["axios", "got", "node-fetch"],
  },
  {
    ruleId: "EFF312",
    shapes: ["ai"],
    prefixAnyOf: ["@effect/ai-"],
    forbidden: ["openai", "@anthropic-ai/sdk", "@google/genai"],
  },
  {
    ruleId: "EFF313",
    shapes: ["workflow"],
    anyOf: ["@effect/workflow"],
    forbidden: [],
  },
  {
    ruleId: "EFF314",
    shapes: ["rpc"],
    anyOf: ["@effect/rpc"],
    forbidden: [],
  },
  {
    ruleId: "EFF315",
    shapes: ["frontend"],
    anyOf: ["@effect-atom/atom-react"],
    forbidden: [],
  },
]

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
    ref: partial.ref ?? null,
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
