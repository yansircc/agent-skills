#!/usr/bin/env node
import { statSync } from "node:fs"
import { resolve } from "node:path"
import { exitCodeFor, runScan } from "./lib/scanner.js"
import { runSelfTest } from "./lib/fixtures.js"

const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith("--")))
const positional = args.filter((arg) => !arg.startsWith("--"))
const root = resolve(positional[0] ?? process.cwd())

const suite = valueAfter("--suite")

if (flags.has("--self-test")) {
  const result = runSelfTest({
    suite,
    exact: flags.has("--exact"),
    contract: flags.has("--contract"),
  })
  if (!result.ok) {
    for (const failure of result.failures) console.error(`[self-test] ${failure}`)
    process.exit(1)
  }
  console.log(`[self-test] ok (${result.summary.cases} cases)`)
  process.exit(0)
}

try {
  if (!statSync(root).isDirectory()) {
    console.error(`root is not a directory: ${root}`)
    process.exit(2)
  }
} catch (error) {
  console.error(`root path is invalid: ${root} (${error.code ?? error.message})`)
  process.exit(2)
}

let result
try {
  result = runScan(root, {
    strict: flags.has("--strict"),
    profile: flags.has("--profile"),
    failOnSuppressionDrift: flags.has("--fail-on-suppression-drift"),
  })
} catch (error) {
  console.error(error.stack ?? error.message)
  process.exit(2)
}

if (flags.has("--json")) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
} else {
  emitHuman(result)
}

process.exit(exitCodeFor(result))

function valueAfter(name) {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1] ?? null
}

function emitHuman(result: any) {
  for (const warning of result.warnings ?? []) console.warn(`[warn] ${warning}`)
  if (result.findings.length === 0) {
    console.log("[OK] no Effect scanner findings")
    if (result.signals?.length) console.log(`[signals] ${result.signals.length} agent-review signals emitted`)
    return
  }
  const byFile: Record<string, any[]> = {}
  for (const finding of result.findings) (byFile[finding.file] ??= []).push(finding)
  for (const [file, items] of Object.entries(byFile)) {
    console.log(`\n${file}`)
    for (const item of items) {
      const tag = item.severity === "error" ? "ERR " : "WARN"
      console.log(`  ${String(item.line).padStart(5)}: [${tag} ${item.ruleId}] ${item.message}`)
      if (item.lineText) console.log(`         > ${item.lineText}`)
      if (item.ref) console.log(`         see: ${item.ref}`)
    }
  }
  console.log(`\n${result.summary.errors} errors, ${result.summary.warnings} warnings, total ${result.summary.total}`)
}
