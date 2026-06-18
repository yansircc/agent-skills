import { readFileSync } from "node:fs"

export const RULES_PATH = "contracts/rules.json"

export function readRegistry(path = RULES_PATH) {
  const registry = JSON.parse(readFileSync(path, "utf8"))
  validateRegistry(registry)
  return registry
}

export function validateRegistry(registry) {
  const errors = []
  if (registry.schemaVersion !== 1) errors.push("schemaVersion must be 1")
  if (!Array.isArray(registry.rules)) errors.push("rules must be an array")
  const ids = new Set()
  for (const [index, rule] of (registry.rules ?? []).entries()) {
    const at = `rules[${index}]`
    if (!/^EFF\d{3}$/.test(rule.id ?? "")) errors.push(`${at}.id must be EFFNNN`)
    if (ids.has(rule.id)) errors.push(`${rule.id} is duplicated`)
    ids.add(rule.id)
    for (const key of ["summary", "replacement", "checklist"]) {
      if (Object.prototype.hasOwnProperty.call(rule, key)) errors.push(`${rule.id}.${key} is derived and must not be stored`)
    }
    for (const key of ["name", "severity", "forbid", "prefer"]) {
      if (typeof rule[key] !== "string" || rule[key].trim() === "") errors.push(`${rule.id}.${key} is required`)
    }
    if (!["error", "warning"].includes(rule.severity)) errors.push(`${rule.id}.severity must be error or warning`)
    if (!Array.isArray(rule.profiles) || rule.profiles.length === 0) errors.push(`${rule.id}.profiles is required`)
    if (!Array.isArray(rule.references)) errors.push(`${rule.id}.references must be an array`)
    if (!rule.scanner || rule.scanner.kind !== "line-regex") errors.push(`${rule.id}.scanner.kind must be line-regex`)
    if (typeof rule.scanner?.pattern !== "string" || rule.scanner.pattern.length === 0) errors.push(`${rule.id}.scanner.pattern is required`)
  }
  if (errors.length > 0) throw new Error(errors.join("\n"))
}

export function scannerRulesJsonl(registry) {
  const header = [
    "// validator/rules.jsonl",
    "// Derived from contracts/rules.json. Do not edit by hand.",
    "// Run: node scripts/generate-derived-docs.js",
  ]
  const lines = registry.rules.map((rule) => {
    const scanner = rule.scanner
    const out = {
      id: rule.id,
      name: rule.name,
      severity: rule.severity === "error" ? undefined : rule.severity,
      pattern: scanner.pattern,
      message: ruleText(rule),
      ref: rule.references[0],
      include: scanner.include,
      exclude: scanner.exclude,
      scanTests: scanner.scanTests,
    }
    for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key]
    return JSON.stringify(out)
  })
  return `${header.join("\n")}\n${lines.join("\n")}\n`
}

export function rulesSummaryMarkdown(registry) {
  const rows = registry.rules.map((rule) => `| ${rule.id} | ${rule.name} | ${rule.severity} | ${rule.profiles.join(", ")} | ${ruleText(rule).replaceAll("|", "\\|")} |`)
  const sections = registry.rules.flatMap((rule) => [
    `## ${rule.id} ${rule.name}`,
    "",
    `Profiles: ${rule.profiles.join(", ")}`,
    "",
    `Rule: ${ruleText(rule)}`,
    "",
  ])
  return [
    "# Generated Rule Summary",
    "",
    "Source of truth: `contracts/rules.json`.",
    "",
    "| ID | Name | Severity | Profiles | Rule |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    ...sections,
  ].join("\n")
}

export function checklistMarkdown(registry) {
  const items = registry.rules.map((rule) => `- [ ] ${rule.id} ${ruleText(rule)}`)
  return [
    "# Generated Delivery Checklist",
    "",
    "Source of truth: `contracts/rules.json`.",
    "",
    ...items,
    "",
  ].join("\n")
}

function ruleText(rule) {
  return `${rule.forbid}。${rule.prefer}`
}

export function profileRoutingMarkdown(registry) {
  const profiles = new Map()
  for (const rule of registry.rules) {
    for (const profile of rule.profiles) {
      const items = profiles.get(profile) ?? []
      items.push(rule.id)
      profiles.set(profile, items)
    }
  }
  const sections = [...profiles.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([profile, rules]) => [
    `## ${profile}`,
    "",
    `Rules: ${rules.sort().join(", ")}`,
    "",
  ])
  return [
    "# Generated Profile Routing",
    "",
    "Source of truth: `contracts/rules.json`.",
    "",
    ...sections,
  ].join("\n")
}
