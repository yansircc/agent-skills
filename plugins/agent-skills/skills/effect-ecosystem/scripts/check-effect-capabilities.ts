#!/usr/bin/env node
import { compileContractValidators } from "../validator/lib/contract-validation.js"
import { RULES } from "../validator/lib/rule-policy.js"

const validators = compileContractValidators()
const result = validators.validateEffectCapabilities()
if (!result.ok) throw new Error(result.message)

const contract = validators.effectCapabilitiesContract
const requirementRuleIds = new Set<string>()
for (const version of Object.values<any>(contract.versions)) {
  for (const requirement of version.packageRequirements) {
    requirementRuleIds.add(requirement.ruleId)
    if (!RULES[requirement.ruleId]) throw new Error(`capability contract references unknown rule ${requirement.ruleId}`)
  }
}

for (const ruleId of ["EFF300", "EFF301", "EFF302", "EFF303", "EFF304", "EFF310", "EFF311", "EFF312", "EFF313", "EFF314", "EFF315"]) {
  if (!requirementRuleIds.has(ruleId)) throw new Error(`capability contract does not cover ${ruleId}`)
}

const v4OtelPolicy = contract.versions.v4.otelPeerClosurePolicy
if (v4OtelPolicy?.pinnedEffectVersion !== "4.0.0-beta.84") {
  throw new Error("v4 OTel peer closure must stay pinned to effect@4.0.0-beta.84 until refreshed with verify-v4-acceptance")
}
if (v4OtelPolicy?.stability !== "beta-pinned") {
  throw new Error("v4 OTel peer closure policy must declare beta-pinned stability")
}

console.log(`effect capabilities ok (${requirementRuleIds.size} package rules)`)
