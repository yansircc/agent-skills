import { existsSync, lstatSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { effectCapabilitiesContract, toolingPackages } from "./effect-capabilities.js"
import { readJsonFile, toPosix } from "./util.js"

const UNSUPPORTED_LOCKFILES = ["bun.lock", "bun.lockb", "yarn.lock"]

export function resolveScanState(root, manifest, activeProfiles: string[] = []) {
  const packages = (manifest?.packages ?? []).map((pkg) => resolvePackage(root, pkg))
  return {
    target: {
      root: ".",
      manifestPath: manifest ? ".effect-skill.json" : null,
      hostTooling: sortedPathOwners(manifest?.hostTooling ?? []),
      generatedPaths: sortedPathOwners(manifest?.generatedPaths ?? []),
      packages: packages.map((pkg) => ({
        path: pkg.path,
        shape: pkg.shape,
        dependencyOwner: pkg.dependencyOwner,
        dependencyRoot: pkg.dependencyRoot,
      })),
    },
    resolution: {
      effect: aggregateEffectResolution(packages),
      packages,
    },
    capabilities: capabilitiesSnapshot(activeProfiles),
  }
}

function sortedPathOwners(items) {
  return [...items]
    .map((item) => ({
      path: item.path,
      owner: item.owner,
      reason: item.reason,
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.owner.localeCompare(b.owner) || a.reason.localeCompare(b.reason))
}

export function effectVersionsFromResolution(scanState) {
  const effect = scanState?.resolution?.effect
  if (!effect || effect.comparison === "conflict" || effect.comparison === "unresolved") return []
  return [...new Set((scanState.resolution.packages ?? [])
    .map((pkg) => resolvedMajor(pkg))
    .filter(Boolean))]
    .sort((a, b) => Number(a) - Number(b))
    .map((major) => `v${major}`)
}

export function profileVersionResolution(scanState) {
  const comparison = scanState?.resolution?.effect?.comparison
  if (comparison === "conflict") return "conflict"
  if (comparison === "unresolved" || !comparison) return "unresolved"
  return "resolved"
}

export function profileVersionProof(scanState) {
  const comparison = scanState?.resolution?.effect?.comparison
  if (comparison === "matched") return "verified"
  if (comparison === "declared-only") return "declared-only"
  if (comparison === "installed-only") return "installed-only"
  return null
}

export function packageResolution(scanState, packagePath) {
  return scanState?.resolution?.packages?.find((pkg) => pkg.path === packagePath) ?? null
}

export function safePackageMajor(pkgResolution) {
  if (!pkgResolution || pkgResolution.comparison === "conflict" || pkgResolution.comparison === "unresolved") return null
  return resolvedMajor(pkgResolution)
}

function resolvePackage(root, pkg) {
  const declaredMajor = declaredMajorForPackage(pkg)
  const installedMajor = installedMajorForPackage(root, pkg)
  const comparison = compareSides(declaredMajor, installedMajor)
  return {
    path: pkg.path,
    shape: [...pkg.shape].sort(),
    dependencyOwner: pkg.dependencyOwner,
    dependencyRoot: toPosix(pkg.path === "." || pkg.dependencyOwner === "workspace-root" ? "." : pkg.path),
    declaredMajor,
    installedMajor,
    comparison,
  }
}

function declaredMajorForPackage(pkg) {
  const ignored = toolingPackages()
  const candidates = []
  const deps = pkg.deps ?? {}
  for (const [name, versionRange] of Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))) {
    if (ignored.has(name)) continue
    const major = majorFromPackageRange(name, versionRange)
    if (!major) continue
    candidates.push({
      source: `${pkg.relativePackageJson}:${dependencyField(pkg.packageJson, name)}.${name}`,
      packageName: name,
      versionRange,
      major,
    })
  }
  candidates.sort((a, b) => candidateRank(a) - candidateRank(b) || a.packageName.localeCompare(b.packageName))
  return sideFromCandidates(candidates)
}

function installedMajorForPackage(root, pkg) {
  const candidates = [
    ...lockfileCandidates(pkg),
    ...nodeModulesCandidates(pkg),
    ...unsupportedLockfileCandidates(pkg),
  ].sort((a, b) => candidateRank(a) - candidateRank(b) || a.source.localeCompare(b.source))
  return sideFromCandidates(candidates)
}

function lockfileCandidates(pkg) {
  const out = []
  const packageLock = resolve(pkg.dependencyRoot, "package-lock.json")
  if (existsSync(packageLock)) {
    try {
      const lock = readJsonFile(packageLock)
      const version = lock.packages?.["node_modules/effect"]?.version ?? lock.dependencies?.effect?.version
      const major = majorFromEffectVersion(version)
      if (major) out.push({
        source: `${relativeDependencyPath(pkg, "package-lock.json")}:effect`,
        packageName: "effect",
        versionRange: version,
        major,
      })
    } catch {
      out.push(unsupportedCandidate(relativeDependencyPath(pkg, "package-lock.json"), "unreadable-lockfile"))
    }
  }

  const pnpmLock = resolve(pkg.dependencyRoot, "pnpm-lock.yaml")
  if (existsSync(pnpmLock)) {
    const text = readFileSync(pnpmLock, "utf8")
    const importerMatch = text.match(/\n\s+effect:\n(?:\s+[^\n]*\n)*?\s+version:\s*([^\s(]+)/)
    const packageMatch = text.match(/\n\s{2}effect@([^:\s]+):/)
    const version = importerMatch?.[1] ?? packageMatch?.[1] ?? null
    const major = majorFromEffectVersion(version)
    if (major) out.push({
      source: `${relativeDependencyPath(pkg, "pnpm-lock.yaml")}:effect`,
      packageName: "effect",
      versionRange: version,
      major,
    })
  }
  return out
}

function nodeModulesCandidates(pkg) {
  const nodeModulesPath = resolve(pkg.dependencyRoot, "node_modules")
  if (!existsSync(nodeModulesPath)) return []
  try {
    if (lstatSync(nodeModulesPath).isSymbolicLink()) {
      return [unsupportedCandidate(relativeDependencyPath(pkg, "node_modules"), "node_modules-symlink-ignored")]
    }
  } catch {
    return []
  }

  const effectRoot = resolve(nodeModulesPath, "effect")
  const effectPackageJson = resolve(effectRoot, "package.json")
  if (!existsSync(effectPackageJson)) return []
  try {
    if (lstatSync(effectRoot).isSymbolicLink()) {
      return [unsupportedCandidate(relativeDependencyPath(pkg, "node_modules/effect"), "node_modules-symlink-ignored")]
    }
    const version = readJsonFile(effectPackageJson).version
    const major = majorFromEffectVersion(version)
    return major
      ? [{
        source: `${relativeDependencyPath(pkg, "node_modules/effect/package.json")}:version`,
        packageName: "effect",
        versionRange: version,
        major,
      }]
      : []
  } catch {
    return []
  }
}

function unsupportedLockfileCandidates(pkg) {
  return UNSUPPORTED_LOCKFILES
    .filter((file) => existsSync(resolve(pkg.dependencyRoot, file)))
    .map((file) => unsupportedCandidate(relativeDependencyPath(pkg, file), "unsupported-lockfile"))
}

function sideFromCandidates(candidates) {
  const winning = candidates.find((candidate) => typeof candidate.major === "number") ?? null
  return {
    status: winning ? "resolved" : candidates.length > 0 ? "unsupported" : "unresolved",
    winningSource: winning?.source ?? null,
    major: winning?.major ?? null,
    candidates,
  }
}

function compareSides(declared, installed) {
  if (declared.major && installed.major && declared.major !== installed.major) return "conflict"
  if (declared.major && installed.major) return "matched"
  if (declared.major) return "declared-only"
  if (installed.major) return "installed-only"
  return "unresolved"
}

function aggregateEffectResolution(packages) {
  const comparisons = packages.map((pkg) => pkg.comparison)
  const majors = [...new Set(packages.map((pkg) => resolvedMajor(pkg)).filter(Boolean))].sort((a, b) => Number(a) - Number(b))
  let comparison = "unresolved"
  if (comparisons.includes("conflict")) comparison = "conflict"
  else if (comparisons.includes("declared-only")) comparison = "declared-only"
  else if (comparisons.includes("installed-only")) comparison = "installed-only"
  else if (comparisons.includes("matched")) comparison = "matched"
  return {
    comparison,
    majors,
  }
}

function resolvedMajor(pkgResolution) {
  if (!pkgResolution || pkgResolution.comparison === "conflict" || pkgResolution.comparison === "unresolved") return null
  return pkgResolution.declaredMajor.major ?? pkgResolution.installedMajor.major ?? null
}

function capabilitiesSnapshot(activeProfiles) {
  const contract = effectCapabilitiesContract()
  return {
    schemaVersion: contract.schemaVersion,
    activeProfiles: [...activeProfiles].sort(),
    versions: Object.fromEntries(Object.entries(contract.versions).map(([version, value]: any) => [version, {
      effectMajor: value.effectMajor,
      importRoots: [...(value.importRoots ?? [])].sort(),
      runtimeAdapters: [...(value.runtimeAdapters ?? [])].sort(),
      unstableBoundaries: [...(value.unstableBoundaries ?? [])].sort(),
      otelPeerClosure: [...(value.otelPeerClosure ?? [])].sort(),
      otelPeerClosurePolicy: value.otelPeerClosurePolicy ?? null,
    }])),
  }
}

function candidateRank(candidate) {
  if (candidate.packageName === "effect") return 0
  if (candidate.source.includes("package-lock")) return 1
  if (candidate.source.includes("pnpm-lock")) return 2
  if (candidate.source.includes("node_modules/effect")) return 3
  if (candidate.major) return 4
  return 9
}

function dependencyField(packageJson, name) {
  if (Object.prototype.hasOwnProperty.call(packageJson.dependencies ?? {}, name)) return "dependencies"
  if (Object.prototype.hasOwnProperty.call(packageJson.devDependencies ?? {}, name)) return "devDependencies"
  if (Object.prototype.hasOwnProperty.call(packageJson.peerDependencies ?? {}, name)) return "peerDependencies"
  if (Object.prototype.hasOwnProperty.call(packageJson.optionalDependencies ?? {}, name)) return "optionalDependencies"
  return "dependencies"
}

function majorFromPackageRange(name, versionRange) {
  if (typeof versionRange !== "string") return null
  if (name === "effect") return majorFromEffectVersion(versionRange)
  if (name.startsWith("@effect/")) {
    const match = versionRange.match(/\d+/)
    if (!match) return null
    return Number(match[0]) === 4 ? 4 : 3
  }
  return null
}

function majorFromEffectVersion(version) {
  if (typeof version !== "string") return null
  const match = version.match(/\d+/)
  if (!match) return null
  const major = Number(match[0])
  return major === 3 || major === 4 ? major : null
}

function unsupportedCandidate(source, reason) {
  return {
    source,
    reason,
    packageName: "effect",
    versionRange: null,
    major: null,
  }
}

function relativeDependencyPath(pkg, file) {
  return toPosix(pkg.dependencyOwner === "workspace-root" || pkg.path === "." ? file : `${pkg.path}/${file}`)
}
