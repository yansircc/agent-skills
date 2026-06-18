import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import ts from "typescript"
import { makeFinding } from "./rule-policy.js"
import { runLocalLanguageService, runLocalTsc } from "./strict-gate.js"
import { readJsonFile, toPosix } from "./util.js"

export const LSP_DIAGNOSTIC_MAP = [
  { name: "floatingEffect", ruleId: "EFF500" },
  { name: "missingEffectContext", ruleId: "EFF501" },
  { name: "missingEffectError", ruleId: "EFF502", proofRequired: false },
  { name: "missingLayerContext", ruleId: "EFF503" },
  { name: "unclosedLayer", ruleId: "EFF503", proofRequired: false },
]

const LSP_CONFIG = JSON.stringify({
  diagnostics: true,
  diagnosticsName: true,
  diagnosticSeverity: {
    floatingEffect: "error",
    missingEffectContext: "error",
    missingEffectError: "error",
    missingLayerContext: "error",
  },
})

export function scanLspDiagnostics(root, files, { strict = false, timings = null } = {}) {
  if (!strict) return { findings: [], compilerDiagnostics: [], probeOk: true, cache: null, diagnosticNames: [] }
  const tscFindings = timings?.measure
    ? timings.measure("strictTsc", () => runTscBridge(root))
    : runTscBridge(root)
  const lspFindings = timings?.measure
    ? timings.measure("strictLsp", () => runLanguageServiceBridge(root))
    : runLanguageServiceBridge(root)
  return {
    findings: lspFindings.findings,
    compilerDiagnostics: tscFindings.compilerDiagnostics,
    cache: lspFindings.cache,
    diagnosticNames: lspFindings.diagnosticNames,
    probeOk: lspFindings.findings.some((finding) => finding.ruleId === "EFF500") || files.length === 0 || !hasProbeFixture(files),
  }
}

function runTscBridge(root) {
  const tsconfig = resolve(root, "tsconfig.json")
  if (!existsSync(tsconfig)) return { findings: [], compilerDiagnostics: [] }
  const result = runLocalTsc(root, ["--noEmit", "--pretty", "false", "-p", tsconfig])
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  const compilerDiagnostics = []
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (/error TS\d+/.test(line)) compilerDiagnostics.push(line.trim())
  }
  return { findings: [], compilerDiagnostics }
}

function runLanguageServiceBridge(root) {
  const tsconfig = resolve(root, "tsconfig.json")
  if (!existsSync(tsconfig)) return { findings: [], cache: { status: "no-tsconfig", hit: false, key: null, fileCount: 0 }, diagnosticNames: [] }
  const cacheKey = lspProgramCacheKey(root, tsconfig)
  const cached = readLspCache(cacheKey)
  const parsed = cached.value ?? runAndCacheLanguageService(root, tsconfig, cacheKey)
  const findings = []
  for (const diagnostic of parsed.diagnostics ?? []) {
    const ruleId = ruleIdForDiagnostic(diagnostic)
    if (!ruleId) continue
    findings.push(makeFinding(root, {
      ruleId,
      file: toRelativeDiagnosticFile(root, diagnostic.file),
      line: Number(diagnostic.line ?? 1),
      lineText: diagnostic.message ?? diagnostic.name ?? "",
    }))
  }
  return {
    findings,
    cache: {
      status: cached.value ? "hit" : cacheKey.status === "ready" ? "miss" : cacheKey.status,
      hit: Boolean(cached.value),
      key: cacheKey.key,
      fileCount: cacheKey.fileCount,
    },
    diagnosticNames: [...new Set((parsed.diagnostics ?? []).map((diagnostic) => diagnostic.name).filter(Boolean))].sort(),
  }
}

function parseTscLocation(line) {
  const match = line.match(/^(.+?)\((\d+),(\d+)\):/)
  return {
    file: match?.[1] ?? "tsconfig.json",
    line: match ? Number(match[2]) : 1,
  }
}

function parseLanguageServiceJson(output) {
  if (!output.trim()) return { diagnostics: [] }
  return JSON.parse(output)
}

function ruleIdForDiagnostic(diagnostic) {
  if (diagnostic.name === "missingEffectContext" && /Effect errors/.test(diagnostic.message ?? "")) return "EFF502"
  return LSP_DIAGNOSTIC_MAP.find((item) => item.name === diagnostic.name)?.ruleId ?? null
}

function toRelativeDiagnosticFile(root, file) {
  if (!file) return "tsconfig.json"
  if (!file.startsWith("/")) return file
  return relative(root, file).split(/[/\\]/).join("/")
}

function hasProbeFixture(files) {
  return files.some((file) => file.relative.includes("floating-effect"))
}

function runAndCacheLanguageService(root, tsconfig, cacheKey) {
  const result = runLocalLanguageService(root, [
    "diagnostics",
    "--project",
    tsconfig,
    "--format",
    "json",
    "--strict",
    "--lspconfig",
    LSP_CONFIG,
  ])
  const parsed = parseLanguageServiceJson(result.stdout)
  writeLspCache(cacheKey, parsed)
  return parsed
}

function lspProgramCacheKey(root, tsconfig) {
  const program = tsconfigProgramFiles(tsconfig)
  if (!program.ok) return { status: "program-list-failed", key: null, fileCount: 0 }
  const files = program.files
  if (![...program.configs, ...files].every((file) => isInsideRoot(root, file))) {
    return { status: "external-program-path", key: null, fileCount: files.length }
  }
  const hash = createHash("sha256")
  hash.update("lsp-diagnostics-v1\0")
  for (const configFile of program.configs) hashFileIfExists(hash, root, configFile, "tsconfig")
  for (const file of ["package.json", "package-lock.json", "pnpm-lock.yaml", "bun.lock", "yarn.lock"]) {
    hashFileIfExists(hash, root, resolve(root, file), file)
  }
  for (const file of files) hashFileIfExists(hash, root, file, "program")
  hash.update(`lsp:${packageVersion(root, "@effect/language-service") ?? "missing"}\0`)
  hash.update(`typescript:${packageVersion(root, "typescript") ?? "missing"}\0`)
  hash.update(`effect:${packageVersion(root, "effect") ?? "missing"}\0`)
  return {
    status: "ready",
    key: hash.digest("hex"),
    fileCount: files.length,
  }
}

function tsconfigProgramFiles(tsconfig) {
  const files = new Set<string>()
  const configs = new Set<string>()
  const seen = new Set<string>()
  visit(resolve(tsconfig))
  return { ok: configs.size > 0, files: [...files].sort(), configs: [...configs].sort() }

  function visit(configPath) {
    const normalized = resolve(configPath)
    if (seen.has(normalized)) return
    seen.add(normalized)
    if (!existsSync(normalized)) return
    configs.add(normalized)
    const read = ts.readConfigFile(normalized, ts.sys.readFile)
    if (read.error) return
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(normalized), undefined, normalized)
    for (const file of parsed.fileNames ?? []) files.add(resolve(file))
    for (const ref of parsed.projectReferences ?? []) {
      const refPath = resolve(ref.path)
      visit(existsSync(refPath) && !refPath.endsWith(".json") ? resolve(refPath, "tsconfig.json") : refPath)
    }
  }
}

function readLspCache(cacheKey) {
  if (cacheKey.status !== "ready" || !cacheKey.key) return { value: null }
  const path = lspCachePath(cacheKey.key)
  if (!existsSync(path)) return { value: null }
  try {
    const record = JSON.parse(readFileSync(path, "utf8"))
    return record.schemaVersion === 1 && record.key === cacheKey.key
      ? { value: record.value }
      : { value: null }
  } catch {
    return { value: null }
  }
}

function writeLspCache(cacheKey, value) {
  if (cacheKey.status !== "ready" || !cacheKey.key) return
  const path = lspCachePath(cacheKey.key)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    key: cacheKey.key,
    value,
  }))
}

function lspCachePath(key) {
  const base = process.env.EFFECT_SKILL_CACHE_DIR
    ? resolve(process.env.EFFECT_SKILL_CACHE_DIR)
    : resolve(homedir(), ".cache", "effect-skill")
  return resolve(base, "lsp-diagnostics-v1", `${key}.json`)
}

function hashFileIfExists(hash, root, path, label) {
  if (!existsSync(path)) return
  hash.update(`${label}:${relativeCachePath(root, path)}\0`)
  hash.update(readFileSync(path))
  hash.update("\0")
}

function relativeCachePath(root, path) {
  return toPosix(relative(resolve(root), resolve(path))) || "."
}

function isInsideRoot(root, path) {
  const relativePath = relative(resolve(root), resolve(path))
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function packageVersion(root, name) {
  const packageJson = resolve(root, "node_modules", ...name.split("/"), "package.json")
  if (!existsSync(packageJson)) return null
  try {
    return readJsonFile(packageJson).version ?? null
  } catch {
    return null
  }
}
