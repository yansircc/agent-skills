import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdtempSync } from "node:fs"
import { runScan } from "./scanner.js"
import { RULES } from "./rule-policy.js"
import { compileContractValidators } from "./contract-validation.js"
import { validateReferenceRouting } from "./reference-routing.js"
import { sha256, stableJson } from "./evidence.js"
import { collectSourceFiles } from "./file-classifier.js"
import { LSP_DIAGNOSTIC_MAP, scanLspDiagnostics } from "./lsp-bridge.js"
import { loadManifest } from "./manifest.js"
import { resolveOutputMode, USAGE_EXIT_CODE } from "./output.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, "..", "fixtures", "fixtures.config.json")
const INTERNAL_SUITES = [
  "rule-policy",
  "policy-docs-schema-sync",
  "fixture-coverage",
  "lsp-no-reimplementation",
  "lsp-diagnostic-mapping",
  "lsp-cache",
  "timings-output",
  "profile-manifest-one-truth",
  "signals-no-semantic-verdicts",
  "runtime-facts-schema",
  "signal-contract",
  "reference-routing",
  "effect-capabilities",
  "gate-summary",
  "cli-output",
  "compliance-hash",
  "notProven-manifest",
  "library-exported-effect-rollup",
]

export function runSelfTest(options: any = {}) {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
  const failures = []
  if (options.contract) failures.push(...validateContract(config))
  if (options.suite) failures.push(...validateSuiteExists(config, options.suite))
  if (!options.suite || shouldRunCaseSuite(options.suite)) {
    failures.push(...runCases(config, options))
  }
  failures.push(...runInternalSuiteChecks(config, options))
  return {
    ok: failures.length === 0,
    failures,
    summary: {
      cases: selectedCases(config, options).length,
      internalChecks: selectedInternalSuites(options).length,
      failures: failures.length,
    },
  }
}

function runCases(config: any, options: any) {
  const failures = []
  for (const testCase of selectedCases(config, options)) {
    const root = mkdtempSync(resolve(tmpdir(), "effect-skill-fixture-"))
    try {
      writeFiles(root, testCase.files)
      linkFixtureNodeModules(root)
      const rulesPath = testCase.rulesJsonl ? resolve(root, "fixture-rules.jsonl") : undefined
      if (testCase.rulesJsonl) writeFileSync(rulesPath, testCase.rulesJsonl)
      const evidenceDir = testCase.expectEvidenceHashAxes ? resolve(root, ".scan-evidence") : undefined
      const result = runScan(root, {
        strict: Boolean(testCase.strict),
        profile: Boolean(testCase.profile),
        failOnSuppressionDrift: Boolean(testCase.failOnSuppressionDrift),
        rulesPath,
        evidenceDir,
      })
      const exit = result.summary.errors > 0 ? 1 : 0
      if (exit !== testCase.expectExit) {
        failures.push(`${testCase.name}: expected exit ${testCase.expectExit}, got ${exit}`)
      }
      const actualRules = [...new Set(result.findings.map((finding) => finding.ruleId))].sort()
      const expectedRules = [...(testCase.expectRules ?? [])].sort()
      for (const ruleId of expectedRules) {
        if (!actualRules.includes(ruleId)) failures.push(`${testCase.name}: missing expected ${ruleId}; actual ${actualRules.join(",")}`)
      }
      if (options.exact || testCase.exact) {
        const actualKey = actualRules.join(",")
        const expectedKey = expectedRules.join(",")
        if (actualKey !== expectedKey) failures.push(`${testCase.name}: exact expected [${expectedKey}], got [${actualKey}]`)
      }
      if (testCase.expectProfile && !result.profile) failures.push(`${testCase.name}: expected profile output`)
      for (const profile of testCase.expectActiveProfiles ?? []) {
        if (!result.profile?.activeProfiles?.includes(profile)) {
          failures.push(`${testCase.name}: missing active profile ${profile}`)
        }
      }
      for (const profile of testCase.expectForbiddenActiveProfiles ?? []) {
        if (result.profile?.activeProfiles?.includes(profile)) {
          failures.push(`${testCase.name}: forbidden active profile ${profile}`)
        }
      }
      for (const version of testCase.expectEffectVersions ?? []) {
        if (!result.profile?.effectVersions?.includes(version)) {
          failures.push(`${testCase.name}: missing effect version ${version}`)
        }
      }
      if (testCase.expectEffectVersionsResolution && result.profile?.effectVersionsResolution !== testCase.expectEffectVersionsResolution) {
        failures.push(`${testCase.name}: expected effectVersionsResolution ${testCase.expectEffectVersionsResolution}, got ${result.profile?.effectVersionsResolution}`)
      }
      if (testCase.expectEffectVersionsProof !== undefined && result.profile?.effectVersionsProof !== testCase.expectEffectVersionsProof) {
        failures.push(`${testCase.name}: expected effectVersionsProof ${testCase.expectEffectVersionsProof}, got ${result.profile?.effectVersionsProof}`)
      }
      for (const reference of testCase.expectRequiredReferences ?? []) {
        if (!result.profile?.requiredReferences?.includes(reference)) {
          failures.push(`${testCase.name}: missing required reference ${reference}`)
        }
      }
      for (const reference of testCase.expectForbiddenRequiredReferences ?? []) {
        if (result.profile?.requiredReferences?.includes(reference)) {
          failures.push(`${testCase.name}: forbidden required reference ${reference}`)
        }
      }
      if (typeof testCase.expectSignalCount === "number" && (result.signals?.length ?? 0) !== testCase.expectSignalCount) {
        failures.push(`${testCase.name}: expected ${testCase.expectSignalCount} signals, got ${result.signals?.length ?? 0}`)
      }
      for (const kind of testCase.expectSignals ?? []) {
        if (!result.signals?.some((signal) => signal.kind === kind)) {
          failures.push(`${testCase.name}: missing signal ${kind}`)
        }
      }
      for (const expected of testCase.expectSignalFacts ?? []) {
        const signal = result.signals?.find((item) => item.kind === expected.kind)
        if (!signal) {
          failures.push(`${testCase.name}: missing signal ${expected.kind}`)
          continue
        }
        for (const [key, value] of Object.entries(expected.facts ?? {})) {
          if (!sameJson(signal.facts?.[key], value)) {
            failures.push(`${testCase.name}: expected ${expected.kind}.${key}=${formatJson(value)}, got ${formatJson(signal.facts?.[key])}`)
          }
        }
      }
      for (const expected of testCase.expectSignalFactPaths ?? []) {
        const signal = result.signals?.find((item) => item.kind === expected.kind)
        if (!signal) {
          failures.push(`${testCase.name}: missing signal ${expected.kind}`)
          continue
        }
        for (const [path, value] of Object.entries(expected.facts ?? {})) {
          const actual = valueAtPath(signal.facts, path)
          if (!sameJson(actual, value)) {
            failures.push(`${testCase.name}: expected ${expected.kind}.${path}=${formatJson(value)}, got ${formatJson(actual)}`)
          }
        }
      }
      if (testCase.expectCompilerDiagnostics && !result.compilerDiagnostics?.length) {
        failures.push(`${testCase.name}: expected compilerDiagnostics outside findings`)
      }
      for (const signal of result.signals ?? []) {
        const validation = compileContractValidators().validateSignal(signal)
        if (!validation.ok) failures.push(`${testCase.name}: signal contract rejected ${signal.kind}: ${validation.message}`)
      }
      if (testCase.expectEvidenceHashAxes) {
        failures.push(...validateEvidenceHashAxes(testCase, root, result, rulesPath))
      }
    } catch (error) {
      failures.push(`${testCase.name}: ${error.stack ?? error.message}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  return failures
}

function validateEvidenceHashAxes(testCase, root, result, rulesPath) {
  const failures = []
  const evidencePath = resolve(root, ".scan-evidence", "scan-evidence.json")
  const gatePath = resolve(root, ".scan-evidence", "gate-summary.json")
  const rawPath = resolve(root, ".scan-evidence", "scan-result.json")
  const inputHashPath = resolve(root, ".scan-evidence", "input.sha256")
  const fullHashPath = resolve(root, ".scan-evidence", "full.sha256")
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"))
  const gate = JSON.parse(readFileSync(gatePath, "utf8"))
  const raw = JSON.parse(readFileSync(rawPath, "utf8"))
  const inputHash = readFileSync(inputHashPath, "utf8").trim()
  const fullHash = readFileSync(fullHashPath, "utf8").trim()
  const validators = compileContractValidators()
  const evidenceValidation = validators.validateScanEvidence(evidence)
  if (!evidenceValidation.ok) failures.push(`${testCase.name}: ${evidenceValidation.message}`)
  const gateValidation = validators.validateGateSummary(gate)
  if (!gateValidation.ok) failures.push(`${testCase.name}: ${gateValidation.message}`)
  if (!raw.profile || !raw.signals) failures.push(`${testCase.name}: raw scan-result missing profile/signals`)
  const targetInput = {
    target: evidence.target,
    resolution: evidence.resolution,
    capabilities: evidence.capabilities,
    references: evidence.references,
  }
  if (sha256(stableJson(targetInput)) !== inputHash) failures.push(`${testCase.name}: inputHash does not match stable target subtree`)
  if (gate.scanner.inputHash !== inputHash) failures.push(`${testCase.name}: gate-summary inputHash mismatch`)
  if (gate.scanner.fullHash !== fullHash) failures.push(`${testCase.name}: gate-summary fullHash mismatch`)
  if (gate.complianceHash !== result.evidence?.complianceHash) failures.push(`${testCase.name}: result evidence complianceHash mismatch`)
  const scannerChanged = structuredClone(evidence)
  scannerChanged.scanner.buildInfo.buildId = `${scannerChanged.scanner.buildInfo.buildId}:changed`
  if (sha256(stableJson(scannerChanged)) === fullHash) failures.push(`${testCase.name}: fullHash ignored scanner build-info`)
  if (sha256(stableJson({
    target: scannerChanged.target,
    resolution: scannerChanged.resolution,
    capabilities: scannerChanged.capabilities,
    references: scannerChanged.references,
  })) !== inputHash) failures.push(`${testCase.name}: inputHash changed when scanner build-info changed`)

  const repeatDir = resolve(root, ".scan-evidence-repeat")
  const repeat = runScan(root, {
    strict: Boolean(testCase.strict),
    profile: Boolean(testCase.profile),
    failOnSuppressionDrift: Boolean(testCase.failOnSuppressionDrift),
    rulesPath,
    evidenceDir: repeatDir,
  })
  if (repeat.evidence?.inputHash !== result.evidence?.inputHash) failures.push(`${testCase.name}: repeated evidence inputHash changed`)
  if (repeat.evidence?.complianceHash !== result.evidence?.complianceHash) failures.push(`${testCase.name}: repeated evidence complianceHash changed`)
  return failures
}

function linkFixtureNodeModules(root) {
  const source = resolve(process.cwd(), "node_modules")
  const target = resolve(root, "node_modules")
  if (existsSync(source) && !existsSync(target)) symlinkSync(source, target, "dir")
}

function writeFiles(root, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const absolute = resolve(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function formatJson(value) {
  return JSON.stringify(value)
}

function valueAtPath(value, path) {
  return String(path).split(".").reduce((current, key) => current?.[key], value)
}

function selectedCases(config: any, options: any) {
  if (!options.suite) return config.cases
  return config.cases.filter((testCase) => testCase.suites.includes(options.suite))
}

function selectedInternalSuites(options: any) {
  if (!options.suite) return INTERNAL_SUITES
  return INTERNAL_SUITES.includes(options.suite) ? [options.suite] : []
}

function shouldRunCaseSuite(suite: string) {
  return !INTERNAL_SUITES.includes(suite)
}

function runInternalSuiteChecks(config: any, options: any) {
  const suite = options.suite
  const failures = []
  if (!suite || suite === "rule-policy") {
    for (const ruleId of config.requiredRuleCoverage) {
      if (!RULES[ruleId]) failures.push(`rule-policy: missing ${ruleId}`)
    }
  }
  if (!suite || suite === "policy-docs-schema-sync") {
    if (!existsSync(resolve(__dirname, "..", "manifest.schema.json"))) failures.push("policy-docs-schema-sync: missing manifest.schema.json")
    if (!existsSync(resolve(__dirname, "..", "..", "references", "scanner-manifest.md"))) failures.push("policy-docs-schema-sync: missing references/scanner-manifest.md")
    if (!existsSync(resolve(__dirname, "..", "..", "references", "runtime-boundaries.md"))) failures.push("policy-docs-schema-sync: missing references/runtime-boundaries.md")
    if (!existsSync(resolve(__dirname, "..", "..", "contracts", "runtime-facts.schema.json"))) failures.push("policy-docs-schema-sync: missing contracts/runtime-facts.schema.json")
    if (!existsSync(resolve(__dirname, "..", "..", "contracts", "evidence-schema.json"))) failures.push("policy-docs-schema-sync: missing contracts/evidence-schema.json")
    if (!existsSync(resolve(__dirname, "..", "..", "contracts", "scan-evidence.schema.json"))) failures.push("policy-docs-schema-sync: missing contracts/scan-evidence.schema.json")
    if (!existsSync(resolve(__dirname, "..", "..", "contracts", "gate-summary.schema.json"))) failures.push("policy-docs-schema-sync: missing contracts/gate-summary.schema.json")
  }
  if (!suite || suite === "fixture-coverage") {
    const covered = new Set(config.cases.flatMap((testCase) => testCase.expectRules ?? []))
    for (const ruleId of config.requiredRuleCoverage) {
      if (!covered.has(ruleId)) failures.push(`fixture-coverage: no fixture expects ${ruleId}`)
    }
  }
  if (!suite || suite === "lsp-no-reimplementation") {
    const source = readFileSync(resolve(__dirname, "lsp-bridge.js"), "utf8")
    for (const forbidden of ["Effect.log", "Effect.gen(function", "Layer.provide"]) {
      if (source.includes(forbidden)) failures.push(`lsp-no-reimplementation: bridge contains ${forbidden}`)
    }
  }
  if (!suite || suite === "lsp-diagnostic-mapping") {
    failures.push(...validateLspDiagnosticMapping(config))
  }
  if (!suite || suite === "lsp-cache") {
    failures.push(...validateLspCache())
  }
  if (!suite || suite === "timings-output") {
    failures.push(...validateTimingsOutput())
  }
  if (!suite || suite === "profile-manifest-one-truth") {
    if (!/manifest\??\.packages\.map/.test(readFileSync(resolve(__dirname, "profile.js"), "utf8"))) {
      failures.push("profile-manifest-one-truth: profile must derive package facts from manifest")
    }
  }
  if (!suite || suite === "signals-no-semantic-verdicts") {
    failures.push(...validateSignalFactKeys())
  }
  if (!suite || suite === "runtime-facts-schema") {
    failures.push(...validateRuntimeFactsSchema())
  }
  if (!suite || suite === "signal-contract") {
    failures.push(...validateSignalContract())
  }
  if (!suite || suite === "reference-routing") {
    failures.push(...validateReferenceRouting(process.cwd()))
  }
  if (!suite || suite === "effect-capabilities") {
    failures.push(...validateEffectCapabilitiesContract())
  }
  if (!suite || suite === "gate-summary") {
    failures.push(...validateGateSummaryBundle())
  }
  if (!suite || suite === "cli-output") {
    failures.push(...validateCliOutputProjection())
  }
  if (!suite || suite === "compliance-hash") {
    failures.push(...validateComplianceHash())
  }
  if (!suite || suite === "notProven-manifest") {
    failures.push(...validateNotProvenManifest())
  }
  if (!suite || suite === "library-exported-effect-rollup") {
    failures.push(...validateLibraryExportedEffectRollup())
  }
  return failures
}

function validateGateSummaryBundle() {
  const failures = []
  const root = mkdtempSync(resolve(tmpdir(), "effect-skill-gate-summary-"))
  try {
    writeFiles(root, {
      ".effect-skill.json": "{\"shape\":[\"library\"],\"generatedPaths\":[{\"glob\":\"src/generated/**\",\"owner\":\"@codegen\",\"reason\":\"generated output\"}]}",
      "package.json": "{\"dependencies\":{\"effect\":\"3.21.2\"},\"devDependencies\":{\"@effect/vitest\":\"1.0.0\",\"@effect/language-service\":\"1.0.0\"}}",
      "src/warn.ts": "export const now = new Date()\n",
      "src/signal.ts": "export const program = Effect.succeed(1)\n",
    })
    linkFixtureNodeModules(root)
    const evidenceDir = resolve(root, ".scan-evidence")
    const result = runScan(root, { evidenceDir })
    const gate = readGateSummary(evidenceDir)
    const raw = JSON.parse(readFileSync(resolve(evidenceDir, "scan-result.json"), "utf8"))
    const evidence = JSON.parse(readFileSync(resolve(evidenceDir, "scan-evidence.json"), "utf8"))
    const validators = compileContractValidators()
    const gateValidation = validators.validateGateSummary(gate)
    if (!gateValidation.ok) failures.push(`gate-summary: ${gateValidation.message}`)
    if (!existsSync(resolve(evidenceDir, "scan-result.json"))) failures.push("gate-summary: missing scan-result.json")
    if (!existsSync(resolve(evidenceDir, "scan-evidence.json"))) failures.push("gate-summary: missing scan-evidence.json")
    if (!existsSync(resolve(evidenceDir, "gate-summary.json"))) failures.push("gate-summary: missing gate-summary.json")
    if (gate.ok !== true) failures.push("gate-summary: warning-only scan should be ok")
    if (gate.exitCode !== 0) failures.push("gate-summary: warning-only exitCode should be 0")
    if (!gate.tiers.report.some((finding) => finding.ruleId === "EFF032")) failures.push("gate-summary: warning missing from report tier")
    if (gate.tiers.block.length !== 0) failures.push("gate-summary: warning-only scan populated block tier")
    if (gate.tiers.review.signals.blocking !== false) failures.push("gate-summary: signals must be non-blocking")
    if (gate.scanner.inputHash !== result.evidence?.inputHash) failures.push("gate-summary: inputHash does not reference evidence result")
    if (gate.scanner.fullHash !== result.evidence?.fullHash) failures.push("gate-summary: fullHash does not reference evidence result")
    if (gate.scanner.inputHash !== readFileSync(resolve(evidenceDir, "input.sha256"), "utf8").trim()) failures.push("gate-summary: inputHash file mismatch")
    if (gate.scanner.fullHash !== readFileSync(resolve(evidenceDir, "full.sha256"), "utf8").trim()) failures.push("gate-summary: fullHash file mismatch")
    if (gate.scanner.inputHash !== sha256(stableJson({
      target: evidence.target,
      resolution: evidence.resolution,
      capabilities: evidence.capabilities,
      references: evidence.references,
    }))) failures.push("gate-summary: inputHash does not match evidence target subtree")
    if (JSON.stringify(gate).includes("\"packages\"")) failures.push("gate-summary: summary leaked raw profile packages")
    if (Array.isArray(gate.tiers.review.signals.items)) failures.push("gate-summary: summary leaked signal items")
    if (!raw.profile || !raw.signals) failures.push("gate-summary: raw scan-result missing profile/signals")

    writeFileSync(resolve(root, "src/error.ts"), "try { work() } catch (e) {}\n")
    const errorDir = resolve(root, ".scan-evidence-error")
    const errorResult = runScan(root, { evidenceDir: errorDir })
    const errorGate = readGateSummary(errorDir)
    if (errorResult.summary.errors === 0) failures.push("gate-summary: error fixture did not emit errors")
    if (errorGate.ok !== false) failures.push("gate-summary: error scan should not be ok")
    if (!errorGate.tiers.block.some((finding) => finding.ruleId === "EFF001")) failures.push("gate-summary: error missing from block tier")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  return failures
}

function validateCliOutputProjection() {
  const failures = []
  const ttyDefault = resolveOutputMode([], true)
  const pipeDefault = resolveOutputMode([], false)
  if (!ttyDefault.ok || ttyDefault.mode !== "human") failures.push("cli-output: TTY default must be human")
  if (!pipeDefault.ok || pipeDefault.mode !== "gate-json") failures.push("cli-output: non-TTY default must be gate-json")

  const root = mkdtempSync(resolve(tmpdir(), "effect-skill-cli-output-"))
  try {
    writeFiles(root, {
      ".effect-skill.json": "{\"shape\":[\"library\"],\"generatedPaths\":[{\"glob\":\"src/generated/**\",\"owner\":\"@codegen\",\"reason\":\"generated output\"}]}",
      "package.json": "{\"dependencies\":{\"effect\":\"3.21.2\"},\"devDependencies\":{\"@effect/vitest\":\"1.0.0\",\"@effect/language-service\":\"1.0.0\"}}",
      "src/warn.ts": "export const now = new Date()\n",
      "src/signal.ts": "export const program = Effect.succeed(1)\n",
    })
    linkFixtureNodeModules(root)

    const defaultGate = parseJsonRun(failures, "cli-output: default non-TTY gate-json", root)
    if (defaultGate) {
      const validation = compileContractValidators().validateGateSummary(defaultGate)
      if (!validation.ok) failures.push(`cli-output: default gate-json schema failed: ${validation.message}`)
      if (defaultGate.artifacts !== null) failures.push("cli-output: gate-json without evidence must use artifacts null")
      if (!defaultGate.effect.activeProfiles.includes("core")) failures.push("cli-output: gate-json did not imply profile activeProfiles")
      if (!defaultGate.effect.requiredReferences.length) failures.push("cli-output: gate-json did not include requiredReferences")
      if (defaultGate.tiers.review.signals.total === 0) failures.push("cli-output: gate-json did not imply signal facts")
    }

    const evidenceDir = resolve(root, ".scan-evidence")
    const evidenceRun = runCli(root, ["--output", "gate-json", "--evidence", evidenceDir])
    if (evidenceRun.status !== 0) failures.push(`cli-output: gate-json evidence exited ${evidenceRun.status}: ${evidenceRun.stderr}`)
    const evidenceStdout = evidenceRun.stdout
    const evidenceFile = readFileSync(resolve(evidenceDir, "gate-summary.json"), "utf8")
    if (evidenceStdout !== evidenceFile) failures.push("cli-output: gate-json stdout differed from gate-summary.json")
    const evidenceGate = parseJsonText(failures, "cli-output: evidence gate-json parse", evidenceStdout)
    if (defaultGate && evidenceGate) {
      for (const key of ["complianceHash"]) {
        if (defaultGate[key] !== evidenceGate[key]) failures.push(`cli-output: ${key} changed when evidence was enabled`)
      }
      for (const key of ["inputHash", "fullHash"]) {
        if (defaultGate.scanner[key] !== evidenceGate.scanner[key]) failures.push(`cli-output: scanner.${key} changed when evidence was enabled`)
      }
    }

    const rawDir = resolve(root, ".scan-evidence-raw")
    const rawRun = runCli(root, ["--output", "raw-json", "--evidence", rawDir])
    const raw = parseJsonText(failures, "cli-output: raw-json parse", rawRun.stdout)
    if (rawRun.status !== 0) failures.push(`cli-output: raw-json exited ${rawRun.status}: ${rawRun.stderr}`)
    if (!raw?.findings || !raw?.evidence) failures.push("cli-output: raw-json did not emit raw scan result")
    if (defaultGate && raw?.evidence) {
      if (raw.evidence.complianceHash !== defaultGate.complianceHash) failures.push("cli-output: raw-json evidence changed complianceHash")
      if (raw.evidence.inputHash !== defaultGate.scanner.inputHash) failures.push("cli-output: raw-json evidence changed inputHash")
      if (raw.evidence.fullHash !== defaultGate.scanner.fullHash) failures.push("cli-output: raw-json evidence changed fullHash")
    }

    const noProfileRaw = parseJsonRun(failures, "cli-output: raw-json no profile", root, ["--output", "raw-json"])
    if (noProfileRaw?.profile || noProfileRaw?.signals) failures.push("cli-output: raw-json without profile/evidence emitted profile facts")

    const humanDir = resolve(root, ".scan-evidence-human")
    const humanRun = runCli(root, ["--output", "human", "--evidence", humanDir])
    if (humanRun.status !== 0) failures.push(`cli-output: human exited ${humanRun.status}: ${humanRun.stderr}`)
    if (!humanRun.stdout.includes("Effect mechanical gate")) failures.push("cli-output: human output missing compact gate label")
    const humanGate = JSON.parse(readFileSync(resolve(humanDir, "gate-summary.json"), "utf8"))
    if (defaultGate) {
      if (humanGate.complianceHash !== defaultGate.complianceHash) failures.push("cli-output: human output mode changed complianceHash")
      if (humanGate.scanner.inputHash !== defaultGate.scanner.inputHash) failures.push("cli-output: human output mode changed inputHash")
      if (humanGate.scanner.fullHash !== defaultGate.scanner.fullHash) failures.push("cli-output: human output mode changed fullHash")
    }

    const jsonRun = runCli(root, ["--json"])
    if (jsonRun.status !== USAGE_EXIT_CODE) failures.push(`cli-output: --json should exit ${USAGE_EXIT_CODE}, got ${jsonRun.status}`)
    if (!jsonRun.stderr.includes("--json was removed")) failures.push("cli-output: --json usage error missing migration hint")
    const invalidOutput = runCli(root, ["--output", "xml"])
    if (invalidOutput.status !== USAGE_EXIT_CODE) failures.push(`cli-output: invalid --output should exit ${USAGE_EXIT_CODE}, got ${invalidOutput.status}`)
    const missingOutput = runCli(root, ["--output"])
    if (missingOutput.status !== USAGE_EXIT_CODE) failures.push(`cli-output: missing --output value should exit ${USAGE_EXIT_CODE}, got ${missingOutput.status}`)
    const missingEvidence = runCli(root, ["--evidence"])
    if (missingEvidence.status !== USAGE_EXIT_CODE) failures.push(`cli-output: missing --evidence value should exit ${USAGE_EXIT_CODE}, got ${missingEvidence.status}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  return failures
}

function validateComplianceHash() {
  const failures = []
  const root = mkdtempSync(resolve(tmpdir(), "effect-skill-compliance-"))
  try {
    writeFiles(root, {
      ".effect-skill.json": "{\"shape\":[\"library\"]}",
      "package.json": "{\"dependencies\":{\"effect\":\"3.21.2\"},\"devDependencies\":{\"@effect/vitest\":\"1.0.0\",\"@effect/language-service\":\"1.0.0\"}}",
      "src/a.ts": "export const program = Effect.succeed(1)\n",
    })
    linkFixtureNodeModules(root)
    const firstDir = resolve(root, ".scan-evidence-first")
    runScan(root, { evidenceDir: firstDir })
    const first = readGateSummary(firstDir)
    writeFileSync(resolve(root, "src/a.ts"), "export const program = Effect.succeed(1).pipe(Effect.withSpan(\"a\"))\n")
    const signalChangedDir = resolve(root, ".scan-evidence-signal-changed")
    runScan(root, { evidenceDir: signalChangedDir })
    const signalChanged = readGateSummary(signalChangedDir)
    if (first.complianceHash !== signalChanged.complianceHash) failures.push("compliance-hash: signal-only change changed complianceHash")

    writeFileSync(resolve(root, "src/warn.ts"), "export const now = new Date()\n")
    const warningDir = resolve(root, ".scan-evidence-warning")
    runScan(root, { evidenceDir: warningDir })
    const warning = readGateSummary(warningDir)
    if (first.complianceHash === warning.complianceHash) failures.push("compliance-hash: warning finding did not change complianceHash")
    const expected = sha256(stableJson({
      scannerBuildId: warning.scanner.buildId,
      findings: [...warning.tiers.block, ...warning.tiers.report],
    }))
    if (warning.complianceHash !== expected) failures.push("compliance-hash: summary hash does not match normalized block/report findings")
    const changedBuild = sha256(stableJson({
      scannerBuildId: `${warning.scanner.buildId}:changed`,
      findings: [...warning.tiers.block, ...warning.tiers.report],
    }))
    if (warning.complianceHash === changedBuild) failures.push("compliance-hash: scanner buildId change did not affect comparison hash")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  return failures
}

function runCli(root, args = []) {
  return spawnSync(process.execPath, [resolve(__dirname, "..", "scan.js"), root, ...args], {
    encoding: "utf8",
  })
}

function parseJsonRun(failures, label, root, args = []) {
  const run = runCli(root, args)
  if (run.status !== 0) {
    failures.push(`${label} exited ${run.status}: ${run.stderr}`)
    return null
  }
  return parseJsonText(failures, label, run.stdout)
}

function parseJsonText(failures, label, text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    failures.push(`${label} emitted invalid JSON: ${error.message}`)
    return null
  }
}

function validateNotProvenManifest() {
  const failures = []
  const root = mkdtempSync(resolve(tmpdir(), "effect-skill-not-proven-"))
  try {
    writeFiles(root, {
      ".effect-skill.json": "{\"shape\":[\"library\"],\"gate\":{\"notProven\":[{\"id\":\"live-recorded-authored\",\"owner\":\"agentOS\",\"reason\":\"agentOS architectural invariant outside Effect scanner scope\"}]}}",
      "package.json": "{\"dependencies\":{\"effect\":\"3.21.2\"},\"devDependencies\":{\"@effect/vitest\":\"1.0.0\",\"@effect/language-service\":\"1.0.0\"}}",
      "src/a.ts": "export const x = 1\n",
    })
    linkFixtureNodeModules(root)
    const evidenceDir = resolve(root, ".scan-evidence")
    runScan(root, { evidenceDir })
    const gate = readGateSummary(evidenceDir)
    if (!gate.notProven.some((item) => item.id === "architecture-boundaries" && item.source === "scanner-default")) failures.push("notProven-manifest: missing scanner default")
    if (!gate.notProven.some((item) => item.id === "live-recorded-authored" && item.source === "manifest" && item.owner === "agentOS")) failures.push("notProven-manifest: missing manifest extension")

    writeFileSync(resolve(root, ".effect-skill.json"), "{\"shape\":[\"library\"]}")
    const defaultDir = resolve(root, ".scan-evidence-default")
    runScan(root, { evidenceDir: defaultDir })
    const defaultGate = readGateSummary(defaultDir)
    if (defaultGate.notProven.some((item) => item.id === "live-recorded-authored")) failures.push("notProven-manifest: default scanner leaked product-specific notProven id")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  return failures
}

function validateLibraryExportedEffectRollup() {
  const failures = []
  const root = mkdtempSync(resolve(tmpdir(), "effect-skill-rollup-"))
  try {
    writeFiles(root, {
      ".effect-skill.json": "{\"shape\":[\"library\"]}",
      "package.json": "{\"dependencies\":{\"effect\":\"3.21.2\"},\"devDependencies\":{\"@effect/vitest\":\"1.0.0\",\"@effect/language-service\":\"1.0.0\"}}",
      "src/no-effect.ts": "export const value = 1\n",
      "src/with-span.ts": "export const withSpan = Effect.succeed(1).pipe(Effect.withSpan(\"with-span\"))\n",
      "src/without-span.ts": "export const withoutSpan = Effect.succeed(1)\n",
    })
    linkFixtureNodeModules(root)
    const evidenceDir = resolve(root, ".scan-evidence")
    const result = runScan(root, { evidenceDir })
    const fileSignals = result.signals.filter((signal) => signal.kind === "library-exported-effect-file")
    const rollups = result.signals.filter((signal) => signal.kind === "library-exported-effect-package")
    if (fileSignals.length !== 1 || fileSignals[0].file !== "src/without-span.ts") failures.push("library-exported-effect-rollup: file-level signal was not narrowed to missing-span Effect export")
    if (rollups.length !== 1) failures.push("library-exported-effect-rollup: expected one package rollup")
    const facts = rollups[0]?.facts ?? {}
    if (facts.exportedEffectFiles !== 2 || facts.withSpanFiles !== 1 || facts.withoutSpanFiles !== 1) failures.push(`library-exported-effect-rollup: bad rollup facts ${formatJson(facts)}`)
    const gate = readGateSummary(evidenceDir)
    const packageRollup = gate.tiers.review.signals.packageRollups[0]
    if (!packageRollup || packageRollup.facts.exportedEffectFiles !== 2) failures.push("library-exported-effect-rollup: gate summary did not project raw package rollup")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  return failures
}

function readGateSummary(evidenceDir) {
  return JSON.parse(readFileSync(resolve(evidenceDir, "gate-summary.json"), "utf8"))
}

function validateLspCache() {
  const failures = []
  const root = mkdtempSync(resolve(tmpdir(), "effect-skill-lsp-cache-"))
  const cacheRoot = mkdtempSync(resolve(tmpdir(), "effect-skill-cache-"))
  const previousCache = process.env.EFFECT_SKILL_CACHE_DIR
  process.env.EFFECT_SKILL_CACHE_DIR = cacheRoot
  try {
    writeFiles(root, {
      ".effect-skill.json": "{\"shape\":[\"library\"]}",
      "package.json": "{\"type\":\"module\",\"dependencies\":{\"effect\":\"3.21.2\"},\"devDependencies\":{\"@effect/vitest\":\"1.0.0\",\"@effect/language-service\":\"1.0.0\",\"typescript\":\"6.0.3\"}}",
      "tsconfig.json": "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"strict\":true,\"noEmit\":true,\"skipLibCheck\":true},\"include\":[\"src/**/*.ts\"]}",
      "src/floating-effect.ts": "import { Effect } from \"effect\"\nEffect.log(\"x\")\n",
    })
    linkFixtureNodeModules(root)
    const first = runScan(root, { strict: true, timings: true, evidenceDir: resolve(root, ".evidence-miss") })
    const second = runScan(root, { strict: true, timings: true, evidenceDir: resolve(root, ".evidence-hit") })
    if (!first.findings.some((finding) => finding.ruleId === "EFF500")) failures.push("lsp-cache: first run missing EFF500")
    if (!second.findings.some((finding) => finding.ruleId === "EFF500")) failures.push("lsp-cache: cached run missing EFF500")
    if (first.timings?.lspCache?.hit !== false) failures.push("lsp-cache: first run should miss cache")
    if (second.timings?.lspCache?.hit !== true) failures.push("lsp-cache: second run should hit cache")
    if (first.timings?.stages?.strictLsp === undefined) failures.push("lsp-cache: first run missing strictLsp timing")
    if (second.timings?.stages?.strictLsp === undefined) failures.push("lsp-cache: second run missing strictLsp timing")
    const missEvidence = JSON.parse(readFileSync(resolve(root, ".evidence-miss", "scan-evidence.json"), "utf8"))
    const hitEvidence = JSON.parse(readFileSync(resolve(root, ".evidence-hit", "scan-evidence.json"), "utf8"))
    if (missEvidence.scanner.lsp.cache?.hit !== false) failures.push("lsp-cache: miss evidence missing cache provenance")
    if (hitEvidence.scanner.lsp.cache?.hit !== true) failures.push("lsp-cache: hit evidence missing cache provenance")
    if (first.evidence?.inputHash !== second.evidence?.inputHash) failures.push("lsp-cache: cache hit changed inputHash")
    if (first.evidence?.fullHash === second.evidence?.fullHash) failures.push("lsp-cache: cache provenance did not affect fullHash")
    writeFileSync(resolve(root, "src/floating-effect.ts"), "export const x = 1\n")
    const changed = runScan(root, { strict: true, timings: true })
    if (changed.timings?.lspCache?.hit !== false) failures.push("lsp-cache: source content change should miss cache")
    if (changed.timings?.lspCache?.key === first.timings?.lspCache?.key) failures.push("lsp-cache: source content change reused cache key")
    if (changed.findings.some((finding) => finding.ruleId === "EFF500")) failures.push("lsp-cache: source content change returned stale EFF500")
  } finally {
    if (previousCache === undefined) delete process.env.EFFECT_SKILL_CACHE_DIR
    else process.env.EFFECT_SKILL_CACHE_DIR = previousCache
    rmSync(root, { recursive: true, force: true })
    rmSync(cacheRoot, { recursive: true, force: true })
  }
  return failures
}

function validateTimingsOutput() {
  const failures = []
  const root = mkdtempSync(resolve(tmpdir(), "effect-skill-timings-"))
  try {
    writeFiles(root, {
      ".effect-skill.json": "{\"shape\":[\"library\"]}",
      "package.json": "{\"dependencies\":{\"effect\":\"3.21.2\"},\"devDependencies\":{\"@effect/vitest\":\"1.0.0\",\"@effect/language-service\":\"1.0.0\"}}",
      "src/a.ts": "export const x = 1\n",
    })
    linkFixtureNodeModules(root)
    const without = runScan(root, { profile: true })
    if (without.timings) failures.push("timings-output: timings emitted without opt-in")
    const withTimings = runScan(root, { profile: true, timings: true })
    if (!Object.prototype.hasOwnProperty.call(withTimings.timings?.stages ?? {}, "collectSourceFiles")) failures.push("timings-output: missing collectSourceFiles timing")
    if (withTimings.timings?.totalMs === undefined) failures.push("timings-output: missing totalMs")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  return failures
}

function validateLspDiagnosticMapping(config) {
  const failures = []
  const requiredNames = new Set(LSP_DIAGNOSTIC_MAP.filter((item: any) => item.proofRequired !== false).map((item) => item.name))
  const observedNames = new Set()
  for (const testCase of config.cases.filter((item) => item.suites.includes("lsp-diagnostics"))) {
    const root = mkdtempSync(resolve(tmpdir(), "effect-skill-lsp-map-"))
    try {
      writeFiles(root, testCase.files)
      linkFixtureNodeModules(root)
      const manifest = loadManifest(root, { strict: Boolean(testCase.strict) }).manifest
      const files = collectSourceFiles(root, manifest)
      const lsp = scanLspDiagnostics(root, files, { strict: true })
      for (const name of lsp.diagnosticNames ?? []) observedNames.add(name)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  for (const name of requiredNames) {
    if (!observedNames.has(name)) failures.push(`lsp-diagnostic-mapping: ${name} is mapped but not proven by current LSP fixtures`)
  }
  for (const ruleId of ["EFF500", "EFF501", "EFF502", "EFF503"]) {
    if (!LSP_DIAGNOSTIC_MAP.some((item) => item.ruleId === ruleId)) failures.push(`lsp-diagnostic-mapping: missing ${ruleId}`)
  }
  return failures
}

function validateContract(config: any) {
  const failures = []
  if (!Array.isArray(config.requiredSuites) || config.requiredSuites.length < 10) failures.push("contract: requiredSuites is too small")
  if (!Array.isArray(config.antiCheatCases) || config.antiCheatCases.length < 6) failures.push("contract: antiCheatCases is too small")
  const caseNames = new Set(config.cases.map((testCase) => testCase.name))
  for (const name of config.antiCheatCases) {
    if (!caseNames.has(name)) failures.push(`contract: missing anti-cheat case ${name}`)
  }
  for (const suite of config.requiredSuites) {
    const hasCase = config.cases.some((testCase) => testCase.suites.includes(suite))
    const internal = INTERNAL_SUITES.includes(suite)
    if (!hasCase && !internal) failures.push(`contract: suite ${suite} has no cases`)
  }
  return failures
}

function validateSignalContract() {
  const failures = []
  const validators = compileContractValidators()
  const result = validators.validateSignalContract()
  if (!result.ok) failures.push(`signal-contract: ${result.message}`)

  const valid = {
    kind: "http-api-boundary-file",
    file: "src/api.ts",
    facts: { containsHttpApiToken: true, importsSchema: true },
    skill_ref: "references/platform-http.md §4. HttpApi — 声明式 HTTP 服务端",
    agent_action: "Read the file and decide whether boundary DTOs/errors require effect/Schema.",
  }
  if (!validators.validateSignal(valid).ok) failures.push("signal-contract: valid signal rejected")

  const mutated: any = structuredClone(valid)
  mutated.facts.runtimeVerdict = "supported"
  if (validators.validateSignal(mutated).ok) failures.push("signal-contract: accepted semantic verdict mutation")

  const missingFact: any = structuredClone(valid)
  delete missingFact.facts.importsSchema
  if (validators.validateSignal(missingFact).ok) failures.push("signal-contract: accepted missing fact mutation")
  return failures
}

function validateSignalFactKeys() {
  const failures = []
  const validators = compileContractValidators()
  const forbidden = new Set(["no-schema", "no-span", "missing-schema", "runtimeVerdict", "nodeRuntimeSupported", "supportedRuntime", "bindingLayerSupported", "requestScopeSafe", "layerWiring"])
  for (const definition of validators.signalsContract.signals) {
    const keys = factKeys(definition.factsSchema ?? {})
    for (const key of keys) {
      if (forbidden.has(key)) failures.push(`signals-no-semantic-verdicts: ${definition.kind} declares forbidden fact ${key}`)
    }
  }
  return failures
}

function validateEffectCapabilitiesContract() {
  const failures = []
  const validators = compileContractValidators()
  const result = validators.validateEffectCapabilities()
  if (!result.ok) failures.push(`effect-capabilities: ${result.message}`)
  const contract = validators.effectCapabilitiesContract
  const requirementRuleIds = new Set()
  for (const version of Object.values<any>(contract.versions)) {
    for (const requirement of version.packageRequirements) {
      if (!RULES[requirement.ruleId]) failures.push(`effect-capabilities: unknown rule ${requirement.ruleId}`)
      requirementRuleIds.add(requirement.ruleId)
    }
  }
  for (const ruleId of ["EFF300", "EFF301", "EFF302", "EFF303", "EFF304", "EFF310", "EFF311", "EFF312", "EFF313", "EFF314", "EFF315"]) {
    if (!requirementRuleIds.has(ruleId)) failures.push(`effect-capabilities: missing ${ruleId}`)
  }
  const v4OtelPolicy = contract.versions.v4.otelPeerClosurePolicy
  if (v4OtelPolicy?.pinnedEffectVersion !== "4.0.0-beta.84") failures.push("effect-capabilities: v4 OTel peer closure is not pinned to beta.84")
  if (v4OtelPolicy?.stability !== "beta-pinned") failures.push("effect-capabilities: v4 OTel peer closure is not beta-pinned")
  return failures
}

function validateRuntimeFactsSchema() {
  const failures = []
  const validators = compileContractValidators()
  const valid = {
    platform: { value: "cloudflare-worker", source: { path: "wrangler.jsonc", line: 1 } },
    compatDate: { value: "2025-12-17", source: { path: "wrangler.jsonc", line: 2 } },
    compatFlags: [{ value: "nodejs_compat", source: { path: "wrangler.jsonc", line: 3 } }],
    entryPoint: { value: "src/index.ts", source: { path: "wrangler.jsonc", line: 4 } },
    bindings: [{ type: "d1_database", name: "DB", source: { path: "wrangler.jsonc", line: 5 } }],
    limits: [{ name: "cpu_ms", value: 30, source: { path: "wrangler.jsonc", line: 6 } }],
    errors: [],
  }
  if (!validators.validateRuntimeFacts(valid).ok) {
    failures.push("runtime-facts-schema: valid runtime facts rejected")
  }

  const extraVerdict: any = structuredClone(valid)
  extraVerdict.runtimeVerdict = "supported"
  if (validators.validateRuntimeFacts(extraVerdict).ok) {
    failures.push("runtime-facts-schema: accepted runtimeVerdict mutation")
  }

  const missingLine = structuredClone(valid)
  delete missingLine.platform.source.line
  if (validators.validateRuntimeFacts(missingLine).ok) {
    failures.push("runtime-facts-schema: accepted source without line")
  }

  const validError = structuredClone(valid)
  validError.errors = [{
    code: "unsupported-wrangler-format",
    message: "Only wrangler.json and wrangler.jsonc are supported runtime fact sources.",
    source: { path: "wrangler.toml", line: 1 },
  }]
  if (!validators.validateRuntimeFacts(validError).ok) {
    failures.push("runtime-facts-schema: valid error fact rejected")
  }
  return failures
}

function validateSuiteExists(config: any, suite: string) {
  return config.requiredSuites.includes(suite) ? [] : [`unknown suite ${suite}`]
}

function factKeys(schema) {
  const out = []
  visit(schema)
  return out

  function visit(value) {
    if (!value || typeof value !== "object") return
    for (const key of Object.keys(value.properties ?? {})) out.push(key)
    for (const child of Object.values(value.properties ?? {})) visit(child)
    if (value.items) visit(value.items)
  }
}
