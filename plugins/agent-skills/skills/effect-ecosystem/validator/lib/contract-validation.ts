import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Ajv2020 } from "ajv/dist/2020.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONTRACTS_DIR = resolve(__dirname, "..", "..", "contracts")

export function compileContractValidators(contractsDir = DEFAULT_CONTRACTS_DIR) {
  const runtimeFactsSchema = readJson(resolve(contractsDir, "runtime-facts.schema.json"))
  const evidenceSchema = readJson(resolve(contractsDir, "evidence-schema.json"))
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validateRuntimeFacts = ajv.compile(runtimeFactsSchema)
  const validateEvidence = ajv.compile(evidenceSchema)
  return {
    validateRuntimeFacts: (value) => validate("runtime-facts", validateRuntimeFacts, value),
    validateEvidence: (value) => validate("evidence", validateEvidence, value),
  }
}

export function assertRuntimeFacts(value) {
  const result = compileContractValidators().validateRuntimeFacts(value)
  if (!result.ok) throw new Error(result.message)
}

function validate(label, validator, value) {
  const ok = Boolean(validator(value))
  if (ok) return { ok: true, message: "" }
  return {
    ok: false,
    message: `${label} schema violation: ${formatAjvErrors(validator.errors ?? [])}`,
  }
}

function formatAjvErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ")
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}
