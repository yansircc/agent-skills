import { PACKAGE_REQUIREMENTS, makeFinding, packageRequiresOtel } from "./rule-policy.js"

export function scanPackageRules(root, manifest) {
  if (!manifest) return []
  const findings = []
  for (const pkg of manifest.packages) {
    for (const requirement of PACKAGE_REQUIREMENTS) {
      if (!requirement.shapes.some((shape) => pkg.shape.includes(shape))) continue
      const missing = missingRequirement(pkg.deps, requirement)
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

function missingRequirement(deps, requirement) {
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
  return missing
}

function hasDep(deps, name) {
  return Object.prototype.hasOwnProperty.call(deps, name)
}
