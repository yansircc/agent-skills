import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { compileContractValidators } from "./contract-validation.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONTRACTS_DIR = resolve(__dirname, "..", "..", "contracts")

let cached: any = null

export function effectCapabilitiesContract() {
  if (cached) return cached
  const validators = compileContractValidators(DEFAULT_CONTRACTS_DIR)
  const result = validators.validateEffectCapabilities()
  if (!result.ok) throw new Error(result.message)
  cached = validators.effectCapabilitiesContract
  return cached
}

export function packageRequirementsForEffectMajor(major) {
  const version = effectCapabilitiesContract().versions[`v${major}`] ?? effectCapabilitiesContract().versions.v3
  return version.packageRequirements
}

export function otelPeerClosureForEffectMajor(major) {
  const version = effectCapabilitiesContract().versions[`v${major}`]
  return version?.otelPeerClosure ?? []
}

export function toolingPackages() {
  return new Set(effectCapabilitiesContract().toolingPackages ?? [])
}

export function effectMajorPolicyField() {
  return effectCapabilitiesContract().dualTrackManifestPolicy?.field ?? "effectMajorPolicy"
}

export function effectMajorPolicyDualTrackValue() {
  return effectCapabilitiesContract().dualTrackManifestPolicy?.value ?? "dual-track"
}
