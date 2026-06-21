import { existsSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { collectSourceFiles } from "./file-classifier.js"
import { loadLineRules, scanLineRules } from "./line-rules.js"
import { loadManifest, rootPackageJson } from "./manifest.js"
import { scanEdgeRules } from "./edge-rules.js"
import { scanPackageRules } from "./package-rules.js"
import { scanFilePairRules } from "./file-pair.js"
import { applySuppressions, validateSuppressionDrift } from "./suppression.js"
import { runLocalTsc, strictPrerequisites } from "./strict-gate.js"
import { scanLspDiagnostics } from "./lsp-bridge.js"
import { activeProfilesFor, buildProfile, buildSignals } from "./profile.js"
import { scanRuntimeFactRules } from "./runtime-facts.js"
import { resolveScanState } from "./resolver.js"
import { buildScanProjection, writeScanBundle } from "./evidence.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = resolve(__dirname, "..", "rules.jsonl")

export function runScan(inputRoot: string, options: any = {}) {
  const timings = createTimings()
  const root = resolve(inputRoot)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`root is not a directory: ${root}`)
  }
  const strict = Boolean(options.strict)
  const warnings = []
  const manifestResult = timings.measure("manifest", () => loadManifest(root, { strict }))
  warnings.push(...manifestResult.warnings)
  let findings = [...manifestResult.findings]
  const manifest = manifestResult.manifest
  const files = timings.measure("collectSourceFiles", () => collectSourceFiles(root, manifest))
  const activeProfiles = timings.measure("activeProfiles", () => activeProfilesFor(manifest))
  const scanState = timings.measure("resolver", () => resolveScanState(root, manifest, activeProfiles))
  const lineRules = timings.measure("loadLineRules", () => loadLineRules(options.rulesPath ?? RULES_PATH))
  findings.push(...timings.measure("lineRules", () => scanLineRules(root, files, lineRules)))

  if (manifest) {
    findings.push(...timings.measure("filePairRules", () => scanFilePairRules(root, files)))
    findings.push(...timings.measure("packageRules", () => scanPackageRules(root, manifest, scanState)))
    findings.push(...timings.measure("edgeRules", () => scanEdgeRules(root, files, manifest)))
    findings.push(...timings.measure("runtimeFactRules", () => scanRuntimeFactRules(root, manifest)))
  }

  if (strict && manifest) {
    findings.push(...timings.measure("strictPrerequisites", () => strictPrerequisites(root, manifest)))
  }

  const lsp = strict && manifest
    ? scanLspDiagnostics(root, files, { strict, timings })
    : { findings: [], compilerDiagnostics: [], probeOk: true, cache: null, diagnosticNames: [] }
  findings.push(...lsp.findings)

  const suppressed = timings.measure("suppressions", () => applySuppressions(root, findings, manifest))
  findings = [...suppressed.findings, ...suppressed.suppressionFindings]
  if (options.failOnSuppressionDrift) {
    findings.push(...timings.measure("suppressionDrift", () => validateSuppressionDrift(root, files, manifest, findings)))
  }

  findings = timings.measure("sortFindings", () => sortFindings(findings))
  const summary = timings.measure("summarize", () => summarize(findings))
  const pkg = timings.measure("rootPackageJson", () => rootPackageJson(root))
  const tscVersion = timings.measure("tscVersion", () => runLocalTsc(root, ["--version"]))
  const lspMeta = {
    available: Boolean(pkg.devDependencies?.["@effect/language-service"]),
    tscVersion: tscVersion.status === 0 ? tscVersion.stdout.trim() : null,
    languageServiceVersion: pkg.devDependencies?.["@effect/language-service"] ?? null,
    cache: lsp.cache ?? null,
  }
  const result: any = {
    findings,
    summary,
    warnings,
  }
  if (lsp.compilerDiagnostics.length > 0) result.compilerDiagnostics = lsp.compilerDiagnostics
  if (options.profile || options.evidenceDir || options.gateSummary) {
    result.profile = timings.measure("profile", () => buildProfile(root, manifest, files, lspMeta, scanState))
    result.signals = timings.measure("signals", () => buildSignals(root, manifest, files, scanState))
  }
  if (options.evidenceDir) {
    const written = timings.measure("evidence", () => writeScanBundle(root, manifest, files, lspMeta, scanState, options.evidenceDir, result))
    result.evidence = written.bundle
    if (options.gateSummary) result.gateSummary = written.gateSummary
  } else if (options.gateSummary) {
    result.gateSummary = timings.measure("gateSummary", () => buildScanProjection(root, manifest, lspMeta, scanState, result, null).gateSummary)
  }
  if (options.timings) {
    result.timings = {
      ...timings.snapshot(),
      lspCache: lsp.cache ?? null,
    }
  }
  return result
}

export function summarize(findings: any[]) {
  const byRule: Record<string, number> = {}
  for (const finding of findings) byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1
  return {
    total: findings.length,
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    byRule,
  }
}

export function exitCodeFor(result: any) {
  return result.summary.errors > 0 ? 1 : 0
}

function sortFindings(findings: any[]) {
  return findings.sort((a, b) => {
    const file = a.file.localeCompare(b.file)
    if (file !== 0) return file
    const line = a.line - b.line
    if (line !== 0) return line
    return a.ruleId.localeCompare(b.ruleId)
  })
}

export function defaultRulesPath() {
  return RULES_PATH
}

function createTimings() {
  const stages: Record<string, number> = {}
  const start = process.hrtime.bigint()
  return {
    measure<T>(name: string, fn: () => T): T {
      const before = process.hrtime.bigint()
      try {
        return fn()
      } finally {
        const ms = Number(process.hrtime.bigint() - before) / 1e6
        stages[name] = Math.round((stages[name] ?? 0) + ms)
      }
    },
    add(name: string, ms: number) {
      stages[name] = Math.round((stages[name] ?? 0) + ms)
    },
    snapshot() {
      return {
        totalMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
        stages: Object.fromEntries(Object.entries(stages).sort(([a], [b]) => a.localeCompare(b))),
      }
    },
  }
}
