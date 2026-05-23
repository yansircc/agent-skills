import { readFileSync } from "node:fs"
import { codeTokenLines } from "./code-view.js"
import { makeFinding } from "./rule-policy.js"
import { matchesAny } from "./util.js"

const DEFAULT_TEST_RE = /\.(test|spec)\.tsx?$/

export function loadLineRules(path) {
  let raw
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error.message}`)
  }
  const out = []
  raw.split("\n").forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("//")) return
    let rule
    try {
      rule = JSON.parse(trimmed)
    } catch (error) {
      throw new Error(`rules.jsonl line ${index + 1} JSON parse failed: ${error.message}`)
    }
    if (!rule.id || !rule.pattern || !rule.message) {
      throw new Error(`rules.jsonl line ${index + 1} missing id/pattern/message`)
    }
    out.push(rule)
  })
  return out
}

export function scanLineRules(root, files, rules) {
  const findings = []
  for (const rule of rules) {
    const re = new RegExp(rule.pattern)
    for (const file of files) {
      if (shouldSkipFile(file, rule)) continue
      const codeLines = codeTokenLines(file)
      for (const line of file.lines) {
        if (!re.test(codeLines[line.number - 1] ?? "")) continue
        findings.push(makeFinding(root, {
          file: file.relative,
          line: line.number,
          lineText: line.text.trim(),
          ruleId: rule.id,
          ruleName: rule.name ?? rule.id,
          severity: rule.severity ?? "error",
          message: rule.message,
          ref: rule.ref ?? null,
          package: file.package?.path ?? null,
        }))
      }
    }
  }
  return findings
}

function shouldSkipFile(file, rule) {
  if (rule.scanTests === true) return false
  if (Array.isArray(rule.include) && rule.include.length > 0 && !matchesAny(file.relative, rule.include)) return true
  if (Array.isArray(rule.exclude) && rule.exclude.length > 0 && matchesAny(file.relative, rule.exclude)) return true
  if (DEFAULT_TEST_RE.test(file.relative)) return true
  return false
}
