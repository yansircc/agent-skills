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
import { buildProfile, buildSignals } from "./profile.js"
import { scanRuntimeFactRules } from "./runtime-facts.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = resolve(__dirname, "..", "rules.jsonl")

export function runScan(inputRoot: string, options: any = {}) {
  const root = resolve(inputRoot)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`root is not a directory: ${root}`)
  }
  const strict = Boolean(options.strict)
  const warnings = []
  const manifestResult = loadManifest(root, { strict })
  warnings.push(...manifestResult.warnings)
  let findings = [...manifestResult.findings]
  const manifest = manifestResult.manifest
  const files = collectSourceFiles(root, manifest)
  const lineRules = loadLineRules(options.rulesPath ?? RULES_PATH)
  findings.push(...scanLineRules(root, files, lineRules))

  if (manifest) {
    findings.push(...scanFilePairRules(root, files))
    findings.push(...scanPackageRules(root, manifest))
    findings.push(...scanEdgeRules(root, files, manifest))
    findings.push(...scanRuntimeFactRules(root, manifest))
  }

  if (strict && manifest) {
    findings.push(...strictPrerequisites(root, manifest))
  }

  const lsp = strict && manifest
    ? scanLspDiagnostics(root, files, { strict })
    : { findings: [], compilerDiagnostics: [], probeOk: true }
  findings.push(...lsp.findings)

  const suppressed = applySuppressions(root, findings, manifest)
  findings = [...suppressed.findings, ...suppressed.suppressionFindings]
  if (options.failOnSuppressionDrift) {
    findings.push(...validateSuppressionDrift(root, files, manifest, findings))
  }

  findings = sortFindings(findings)
  const summary = summarize(findings)
  const pkg = rootPackageJson(root)
  const tscVersion = runLocalTsc(root, ["--version"])
  const lspMeta = {
    available: Boolean(pkg.devDependencies?.["@effect/language-service"]),
    tscVersion: tscVersion.status === 0 ? tscVersion.stdout.trim() : null,
    languageServiceVersion: pkg.devDependencies?.["@effect/language-service"] ?? null,
  }
  const result: any = {
    findings,
    summary,
    warnings,
  }
  if (lsp.compilerDiagnostics.length > 0) result.compilerDiagnostics = lsp.compilerDiagnostics
  if (options.profile) {
    result.profile = buildProfile(root, manifest, files, lspMeta)
    result.signals = buildSignals(root, manifest, files)
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
