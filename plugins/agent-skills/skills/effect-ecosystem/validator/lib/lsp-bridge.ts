import { existsSync } from "node:fs"
import { relative, resolve } from "node:path"
import { makeFinding } from "./rule-policy.js"
import { runLocalLanguageService, runLocalTsc } from "./strict-gate.js"

const DIAGNOSTIC_MAP = [
  { name: "floatingEffect", ruleId: "EFF500" },
  { name: "missingEffectContext", ruleId: "EFF501" },
  { name: "missingEffectError", ruleId: "EFF502" },
  { name: "missingLayerContext", ruleId: "EFF503" },
  { name: "unclosedLayer", ruleId: "EFF503" },
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

export function scanLspDiagnostics(root, files, { strict = false } = {}) {
  if (!strict) return { findings: [], compilerDiagnostics: [], probeOk: true }
  const tscFindings = runTscBridge(root)
  const lspFindings = runLanguageServiceBridge(root)
  return {
    findings: lspFindings.findings,
    compilerDiagnostics: tscFindings.compilerDiagnostics,
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
  if (!existsSync(tsconfig)) return { findings: [] }
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
  return { findings }
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
  return DIAGNOSTIC_MAP.find((item) => item.name === diagnostic.name)?.ruleId ?? null
}

function toRelativeDiagnosticFile(root, file) {
  if (!file) return "tsconfig.json"
  if (!file.startsWith("/")) return file
  return relative(root, file).split(/[/\\]/).join("/")
}

function hasProbeFixture(files) {
  return files.some((file) => file.relative.includes("floating-effect"))
}
