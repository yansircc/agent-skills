import { packageRequirementsForEffectMajor, otelPeerClosureForEffectMajor, otelPeerClosurePolicyForEffectMajor, toolingPackages } from "./effect-capabilities.js"
import { makeFinding, packageRequiresOtel } from "./rule-policy.js"
import { packageResolution, safePackageMajor } from "./resolver.js"

export function scanPackageRules(root, manifest, scanState = null) {
  if (!manifest) return []
  const findings = []
  for (const pkg of manifest.packages) {
    const resolved = packageResolution(scanState, pkg.path)
    const effectMajor = safePackageMajor(resolved)
    if (pkg.shape.includes("worker") && !manifest.wranglerPath) {
      findings.push(makeFinding(root, {
        ruleId: "EFF906",
        file: ".effect-skill.json",
        package: pkg.path,
      }))
    }
    if (resolved?.comparison === "conflict") {
      findings.push(makeFinding(root, {
        ruleId: "EFF324",
        file: pkg.relativePackageJson,
        package: pkg.path,
        message: `declared Effect v${resolved.declaredMajor.major} but installed Effect v${resolved.installedMajor.major}`,
      }))
      continue
    }
    if (!effectMajor) {
      if (packageRequiresOtel(pkg.shape) && !hasDep(pkg.deps, "@effect/opentelemetry")) {
        findings.push(makeFinding(root, {
          ruleId: "EFF320",
          file: pkg.relativePackageJson,
          package: pkg.path,
        }))
      }
      if (pkg.shape.length > 0 && !hasDep(pkg.devDeps, "@effect/vitest")) {
        findings.push(makeFinding(root, {
          ruleId: "EFF321",
          file: pkg.relativePackageJson,
          package: pkg.path,
        }))
      }
      continue
    }
    const mixed = mixedEffectMajorPackages(pkg, effectMajor)
    if (mixed.length > 0 && pkg.effectMajorPolicy !== "dual-track") {
      findings.push(makeFinding(root, {
        ruleId: "EFF322",
        file: pkg.relativePackageJson,
        package: pkg.path,
        message: `mixed Effect v${effectMajor} with ${mixed.join(", ")}`,
      }))
    }
    for (const requirement of packageRequirementsForEffectMajor(effectMajor)) {
      if (!requirement.shapes.some((shape) => pkg.shape.includes(shape))) continue
      const missing = missingRequirement(pkg.deps, requirement, {
        hasDeclaredAiProviderTransport: aiProviderTransportsFor(manifest, pkg).length > 0,
      })
      const forbidden = (requirement.forbidden ?? []).filter((name) => hasDep(pkg.deps, name))
      if (missing.length > 0 || forbidden.length > 0) {
        findings.push(makeFinding(root, {
          ruleId: requirement.ruleId,
          file: pkg.relativePackageJson,
          package: pkg.path,
          message: [
            missing.length > 0 ? `missing ${missing.join(" or ")}` : null,
            forbidden.length > 0 ? `forbidden direct dependency ${forbidden.join(", ")}` : null,
          ].filter(Boolean).join("; "),
        }))
      }
    }
    if (packageRequiresOtel(pkg.shape) && !hasDep(pkg.deps, "@effect/opentelemetry")) {
      findings.push(makeFinding(root, {
        ruleId: "EFF320",
        file: pkg.relativePackageJson,
        package: pkg.path,
      }))
    }
    const missingOtelPeers = missingOtelPeerClosure(pkg, effectMajor, resolved)
    if (missingOtelPeers.length > 0) {
      findings.push(makeFinding(root, {
        ruleId: "EFF323",
        file: pkg.relativePackageJson,
        package: pkg.path,
        message: `missing ${missingOtelPeers.join(", ")}`,
      }))
    }
    if (pkg.shape.length > 0 && !hasDep(pkg.devDeps, "@effect/vitest")) {
      findings.push(makeFinding(root, {
        ruleId: "EFF321",
        file: pkg.relativePackageJson,
        package: pkg.path,
      }))
    }
  }
  return findings
}

function missingRequirement(deps, requirement, options: { hasDeclaredAiProviderTransport?: boolean } = {}) {
  const missing = []
  for (const dep of requirement.allOf ?? []) {
    if (!hasDep(deps, dep)) missing.push(dep)
  }
  if (requirement.anyOf && !requirement.anyOf.some((dep) => hasDep(deps, dep))) {
    missing.push(requirement.anyOf.join(" or "))
  }
  if (requirement.prefixAnyOf && !Object.keys(deps).some((dep) => requirement.prefixAnyOf.some((prefix) => dep.startsWith(prefix)))) {
    missing.push(requirement.prefixAnyOf.join(" or "))
  }
  if (
    requirement.providerPrefixAnyOf &&
    !options.hasDeclaredAiProviderTransport &&
    !Object.keys(deps).some((dep) => requirement.providerPrefixAnyOf.some((prefix) => dep.startsWith(prefix)))
  ) {
    missing.push(`${requirement.providerPrefixAnyOf.join(" or ")} provider package or manifest aiProviderTransports[]`)
  }
  return missing
}

function hasDep(deps, name) {
  return Object.prototype.hasOwnProperty.call(deps, name)
}

function missingOtelPeerClosure(pkg, effectMajor, resolved) {
  if (effectMajor !== 4 || !hasDep(pkg.deps, "@effect/opentelemetry")) return []
  if (!otelPeerClosureIsDeterministic(resolved, effectMajor)) return []
  return otelPeerClosureForEffectMajor(effectMajor).filter((name) => !hasDep(pkg.deps, name))
}

export function otelPeerClosureIsDeterministic(resolved, effectMajor) {
  const policy = otelPeerClosurePolicyForEffectMajor(effectMajor)
  if (!policy || policy.stability !== "beta-pinned") return true
  const pinned = policy.pinnedEffectVersion
  if (!pinned) return false
  const candidates = [
    ...(resolved?.declaredMajor?.candidates ?? []),
    ...(resolved?.installedMajor?.candidates ?? []),
  ]
  return candidates.some((candidate) => candidate.packageName === "effect" && candidate.versionRange === pinned)
}

function mixedEffectMajorPackages(pkg, effectMajor) {
  const ignored = toolingPackages()
  const mixed = []
  for (const [name, versionRange] of Object.entries(pkg.deps ?? {})) {
    if (!name.startsWith("@effect/")) continue
    if (ignored.has(name)) continue
    const packageMajor = effectMajorFromRange(versionRange)
    if (!packageMajor) continue
    if (effectMajor === 4 && packageMajor !== 4) mixed.push(`${name}@${versionRange}`)
    if (effectMajor === 3 && packageMajor === 4) mixed.push(`${name}@${versionRange}`)
  }
  return mixed.sort()
}

function effectMajorFromRange(versionRange) {
  if (typeof versionRange !== "string") return null
  const match = versionRange.match(/\d+/)
  if (!match) return null
  const major = Number(match[0])
  return major === 4 ? 4 : 3
}

function aiProviderTransportsFor(manifest, pkg) {
  return (manifest.aiProviderTransports ?? []).filter((transport) => belongsToPackage(pkg.path, transport.path))
}

function belongsToPackage(packagePath, filePath) {
  return packagePath === "." || filePath === packagePath || filePath.startsWith(`${packagePath}/`)
}
