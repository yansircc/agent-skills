import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdtempSync } from "node:fs"
import { runScan } from "./scanner.js"
import { RULES } from "./rule-policy.js"
import { compileContractValidators } from "./contract-validation.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, "..", "fixtures", "fixtures.config.json")

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
      const result = runScan(root, {
        strict: Boolean(testCase.strict),
        profile: Boolean(testCase.profile),
        failOnSuppressionDrift: Boolean(testCase.failOnSuppressionDrift),
        rulesPath,
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
    } catch (error) {
      failures.push(`${testCase.name}: ${error.stack ?? error.message}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
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

function shouldRunCaseSuite(suite: string) {
  return ![
    "rule-policy",
    "policy-docs-schema-sync",
    "fixture-coverage",
    "lsp-no-reimplementation",
    "profile-manifest-one-truth",
    "signals-no-semantic-verdicts",
    "runtime-facts-schema",
  ].includes(suite)
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
  if (!suite || suite === "profile-manifest-one-truth") {
    if (!/manifest\??\.packages\.map/.test(readFileSync(resolve(__dirname, "profile.js"), "utf8"))) {
      failures.push("profile-manifest-one-truth: profile must derive package facts from manifest")
    }
  }
  if (!suite || suite === "signals-no-semantic-verdicts") {
    const source = readFileSync(resolve(__dirname, "profile.js"), "utf8")
    for (const forbidden of ["no-schema", "no-span", "missing-schema", "runtimeVerdict", "nodeRuntimeSupported", "supportedRuntime", "bindingLayerSupported", "requestScopeSafe", "layerWiring"]) {
      if (source.includes(forbidden)) failures.push(`signals-no-semantic-verdicts: forbidden verdict token ${forbidden}`)
    }
  }
  if (!suite || suite === "runtime-facts-schema") {
    failures.push(...validateRuntimeFactsSchema())
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
    const internal = [
      "rule-policy",
      "policy-docs-schema-sync",
      "fixture-coverage",
      "lsp-no-reimplementation",
      "profile-manifest-one-truth",
      "signals-no-semantic-verdicts",
      "runtime-facts-schema",
    ].includes(suite)
    if (!hasCase && !internal) failures.push(`contract: suite ${suite} has no cases`)
  }
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
