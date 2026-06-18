import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { depsOf, devDepsOf, readJsonFile, toPosix } from "./util.js"
import { makeFinding, SHAPES } from "./rule-policy.js"

export const MANIFEST_NAME = ".effect-skill.json"

export function loadManifest(root, { strict = false } = {}) {
  const path = resolve(root, MANIFEST_NAME)
  if (!existsSync(path)) {
    return {
      manifest: null,
      warnings: strict ? [] : [`${MANIFEST_NAME} not found; running syntax-only scanner`],
      findings: strict ? [makeFinding(root, { ruleId: "EFF000", file: MANIFEST_NAME })] : [],
    }
  }

  let raw
  try {
    raw = readJsonFile(path)
  } catch (error) {
    return {
      manifest: null,
      warnings: [],
      findings: [makeFinding(root, {
        ruleId: "EFF900",
        file: MANIFEST_NAME,
        message: `${MANIFEST_NAME} is not valid JSON: ${error.message}`,
      })],
    }
  }

  const errors = validateManifestShape(raw)
  if (errors.length > 0) {
    return {
      manifest: null,
      warnings: [],
      findings: errors.map((message) => makeFinding(root, {
        ruleId: "EFF900",
        file: MANIFEST_NAME,
        message,
      })),
    }
  }

  const manifest = normalizeManifest(root, raw, path)
  const strictFindings = strict && allShapesEmpty(manifest)
    ? [makeFinding(root, { ruleId: "EFF903", file: MANIFEST_NAME })]
    : []

  return { manifest, warnings: [], findings: strictFindings }
}

export function validateManifestShape(raw) {
  const errors = []
  const hasShape = Array.isArray(raw.shape)
  const hasPackages = Array.isArray(raw.packages)
  if (hasShape === hasPackages) {
    errors.push(`${MANIFEST_NAME} must contain exactly one of shape[] or packages[]`)
  }
  if (hasShape) validateShapeArray(raw.shape, "shape", errors)
  if (hasPackages) {
    raw.packages.forEach((pkg, index) => {
      if (!pkg || typeof pkg !== "object") {
        errors.push(`packages[${index}] must be an object`)
        return
      }
      if (typeof pkg.path !== "string" || pkg.path.trim() === "") {
        errors.push(`packages[${index}].path is required`)
      }
      validateShapeArray(pkg.shape, `packages[${index}].shape`, errors)
      if (pkg.dependencyOwner && !["package-local", "workspace-root"].includes(pkg.dependencyOwner)) {
        errors.push(`packages[${index}].dependencyOwner must be package-local or workspace-root`)
      }
      if (pkg.dependencyOwner === "workspace-root" && typeof pkg.dependencyOwnerReason !== "string") {
        errors.push(`packages[${index}].dependencyOwnerReason is required for workspace-root`)
      }
      if (pkg.effectMajorPolicy && pkg.effectMajorPolicy !== "dual-track") {
        errors.push(`packages[${index}].effectMajorPolicy must be dual-track`)
      }
    })
  }
  if (raw.effectMajorPolicy && raw.effectMajorPolicy !== "dual-track") {
    errors.push("effectMajorPolicy must be dual-track")
  }
  validatePathOwners(raw.allowedAdapters ?? [], "allowedAdapters", errors, true)
  validatePathOwners(raw.executableEdges ?? [], "executableEdges", errors, false)
  validatePathOwners(raw.aiProviderTransports ?? [], "aiProviderTransports", errors, false)
  validateHostTooling(raw.hostTooling ?? [], errors)
  validateGenerated(raw.generatedPaths ?? [], errors)
  if (raw.wranglerPath !== undefined && (typeof raw.wranglerPath !== "string" || raw.wranglerPath.trim() === "")) {
    errors.push("wranglerPath must be a non-empty string")
  }
  return errors
}

function validateShapeArray(shape, label, errors) {
  if (!Array.isArray(shape)) {
    errors.push(`${label} must be an array`)
    return
  }
  for (const item of shape) {
    if (!SHAPES.includes(item)) errors.push(`${label} contains unsupported shape: ${item}`)
  }
}

function validatePathOwners(items, label, errors, requireRules) {
  if (!Array.isArray(items)) {
    errors.push(`${label} must be an array`)
    return
  }
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      errors.push(`${label}[${index}] must be an object`)
      return
    }
    if (typeof item.path !== "string" || item.path.trim() === "") errors.push(`${label}[${index}].path is required`)
    if (typeof item.owner !== "string" || item.owner.trim() === "") errors.push(`${label}[${index}].owner is required`)
    if (typeof item.reason !== "string" || item.reason.trim() === "") errors.push(`${label}[${index}].reason is required`)
    if (requireRules && (!Array.isArray(item.rules) || item.rules.length === 0)) {
      errors.push(`${label}[${index}].rules is required`)
    }
  })
}

function validateGenerated(items, errors) {
  if (!Array.isArray(items)) {
    errors.push("generatedPaths must be an array")
    return
  }
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      errors.push(`generatedPaths[${index}] must be an object`)
      return
    }
    if (typeof item.glob !== "string" || item.glob.trim() === "") errors.push(`generatedPaths[${index}].glob is required`)
    if (typeof item.owner !== "string" || item.owner.trim() === "") errors.push(`generatedPaths[${index}].owner is required`)
    if (typeof item.reason !== "string" || item.reason.trim() === "") errors.push(`generatedPaths[${index}].reason is required`)
  })
}

function normalizeManifest(root, raw, manifestPath) {
  const packages = Array.isArray(raw.packages)
    ? raw.packages.map((pkg) => normalizePackage(root, pkg))
    : [normalizePackage(root, {
      path: ".",
      shape: raw.shape,
      dependencyOwner: raw.dependencyOwner,
      dependencyOwnerReason: raw.dependencyOwnerReason,
      effectMajorPolicy: raw.effectMajorPolicy,
    })]

  return {
    path: manifestPath,
    root,
    packages,
    executableEdges: normalizePathItems(raw.executableEdges ?? []),
    allowedAdapters: normalizePathItems(raw.allowedAdapters ?? []),
    aiProviderTransports: normalizePathItems(raw.aiProviderTransports ?? []),
    generatedPaths: raw.generatedPaths ?? [],
    hostTooling: raw.hostTooling ?? [],
    wranglerPath: raw.wranglerPath ? toPosix(raw.wranglerPath) : null,
    testGlobs: raw.testGlobs ?? ["**/*.test.ts", "**/*.spec.ts", "**/*.test.tsx", "**/*.spec.tsx"],
    suppression: raw.suppression ?? {
      lineLevel: { requireReason: true, requireOwner: false, allowExpires: true },
      manifestPath: { requireReason: true, requireOwner: true },
    },
  }
}

function validateHostTooling(items, errors) {
  if (!Array.isArray(items)) {
    errors.push("hostTooling must be an array")
    return
  }
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      errors.push(`hostTooling[${index}] must be an object`)
      return
    }
    if (typeof item.path !== "string" || item.path.trim() === "") errors.push(`hostTooling[${index}].path is required`)
    if (typeof item.owner !== "string" || item.owner.trim() === "") errors.push(`hostTooling[${index}].owner is required`)
    if (typeof item.reason !== "string" || item.reason.trim() === "") errors.push(`hostTooling[${index}].reason is required`)
  })
}

function normalizePackage(root, pkg) {
  const packagePath = toPosix(pkg.path ?? ".").replace(/\/$/, "") || "."
  const dependencyOwner = pkg.dependencyOwner ?? "package-local"
  const packageRoot = resolve(root, packagePath)
  const dependencyRoot = dependencyOwner === "workspace-root" ? root : packageRoot
  const packageJsonPath = resolve(dependencyRoot, "package.json")
  const packageJson = existsSync(packageJsonPath) ? readJsonFile(packageJsonPath) : {}
  return {
    path: packagePath,
    root: packageRoot,
    shape: pkg.shape ?? [],
    dependencyOwner,
    dependencyOwnerReason: pkg.dependencyOwnerReason ?? null,
    dependencyRoot,
    effectMajorPolicy: pkg.effectMajorPolicy ?? null,
    packageJsonPath,
    packageJson,
    deps: depsOf(packageJson),
    devDeps: devDepsOf(packageJson),
    relativePackageJson: toPosix(packagePath === "." ? "package.json" : `${packagePath}/package.json`),
  }
}

function normalizePathItems(items) {
  return items.map((item) => ({
    ...item,
    path: toPosix(item.path),
  }))
}

function allShapesEmpty(manifest) {
  return manifest.packages.every((pkg) => pkg.shape.length === 0)
}

export function packageForFile(manifest, relativeFile) {
  if (!manifest) return null
  const normalized = toPosix(relativeFile)
  const sorted = [...manifest.packages].sort((a, b) => b.path.length - a.path.length)
  return sorted.find((pkg) => pkg.path === "." || normalized === pkg.path || normalized.startsWith(`${pkg.path}/`)) ?? null
}

export function rootPackageJson(root) {
  const path = resolve(root, "package.json")
  return existsSync(path) ? readJsonFile(path) : {}
}
