#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { readRegistry, scannerRulesJsonl } from "./rule-registry.js"

const registry = readRegistry()
const ids = registry.rules.map((rule) => rule.id)
const oldRange = ids.filter((id) => /^EFF0(0[1-9]|[1-2][0-9]|3[0-2])$/.test(id))
if (oldRange.length !== 32) {
  throw new Error(`expected EFF001-EFF032 coverage, got ${oldRange.length}`)
}
const expected = scannerRulesJsonl(registry)
const actual = readFileSync("validator/rules.jsonl", "utf8")
if (actual !== expected) {
  throw new Error("validator/rules.jsonl is not derived from contracts/rules.json")
}
console.log("registry ok")
