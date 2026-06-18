import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { compileContractValidators } from "./contract-validation.js"
import { activeProfilesFor, requiredReferencesFor } from "./profile.js"
import { effectVersionsFromResolution } from "./resolver.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

export function writeScanEvidence(root, manifest, files, lspMeta, scanState, evidenceDir) {
  const targetInput = {
    target: scanState.target,
    resolution: scanState.resolution,
    capabilities: scanState.capabilities,
    references: {
      required: requiredReferencesFor(activeProfilesFor(manifest), effectVersionsFromResolution(scanState), manifest),
    },
  }
  const scanner = {
    buildInfo: readBuildInfo(),
    lsp: {
      available: lspMeta?.available ?? false,
      tscVersion: lspMeta?.tscVersion ?? null,
      languageServiceVersion: lspMeta?.languageServiceVersion ?? null,
      cache: lspMeta?.cache ?? null,
    },
  }
  const evidence = {
    schemaVersion: 1,
    ...targetInput,
    scanner,
  }
  const validators = compileContractValidators()
  const validation = validators.validateScanEvidence(evidence)
  if (!validation.ok) throw new Error(validation.message)

  const outDir = resolve(evidenceDir)
  mkdirSync(outDir, { recursive: true })
  const evidenceJson = `${stableJson(evidence)}\n`
  const inputHash = sha256(stableJson(targetInput))
  const fullHash = sha256(stableJson(evidence))
  writeFileSync(resolve(outDir, "scan-evidence.json"), evidenceJson)
  writeFileSync(resolve(outDir, "input.sha256"), `${inputHash}\n`)
  writeFileSync(resolve(outDir, "full.sha256"), `${fullHash}\n`)
  return {
    files: ["scan-evidence.json", "input.sha256", "full.sha256"],
    inputHash,
    fullHash,
  }
}

export function stableJson(value) {
  return JSON.stringify(sortJson(value), null, 2)
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function readBuildInfo() {
  const path = resolve(__dirname, "..", "..", "build-info.json")
  if (!existsSync(path)) {
    return {
      schemaVersion: 1,
      gitCommit: null,
      dirty: null,
      buildId: null,
      sourceRootRelative: null,
    }
  }
  return JSON.parse(readFileSync(path, "utf8"))
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortJson(child)]))
}
