#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { compileContractValidators } from "../validator/lib/contract-validation.js"

const contractsDir = resolve(process.cwd(), "contracts")
const validators = compileContractValidators(contractsDir)
const result = validators.validateSignalContract()
if (!result.ok) throw new Error(result.message)

const kinds = new Set()
for (const definition of validators.signalsContract.signals) {
  if (kinds.has(definition.kind)) throw new Error(`duplicate signal kind: ${definition.kind}`)
  kinds.add(definition.kind)
  assertReference(definition.skill_ref)
}

console.log(`signal contracts ok (${kinds.size} signals)`)

function assertReference(skillRef: string) {
  const match = skillRef.match(/^(references\/[^ ]+) §(.+)$/)
  if (!match) throw new Error(`invalid skill_ref: ${skillRef}`)
  const [, file, heading] = match
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) throw new Error(`missing signal reference file: ${skillRef}`)
  const markdown = readFileSync(path, "utf8")
  const headings = markdown
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
  if (!headings.includes(heading)) throw new Error(`missing signal reference heading: ${skillRef}`)
}
