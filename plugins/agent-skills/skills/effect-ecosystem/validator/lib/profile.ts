import { RULES } from "./rule-policy.js"
import { codeTokenText } from "./code-view.js"
import { cloudflareRuntimeFacts } from "./runtime-facts.js"
import { astFactsForFile } from "./ast-facts.js"
import { assertRuntimeFacts, compileContractValidators, signalDefinitionsByKind } from "./contract-validation.js"
import { otelPeerClosureForEffectMajor, otelPeerClosurePolicyForEffectMajor } from "./effect-capabilities.js"
import { otelPeerClosureIsDeterministic } from "./package-rules.js"
import { effectVersionsFromResolution, packageResolution, profileVersionProof, profileVersionResolution, safePackageMajor } from "./resolver.js"

export const ALWAYS_REFERENCES = [
  "references/generated/rules-summary.md",
  "references/generated/checklist.md",
  "references/scanner-manifest.md",
  "references/language-service.md",
]

export const VERSION_REFERENCES = {
  3: "references/versions/v3.md",
  4: "references/versions/v4.md",
}

export const PROFILE_REFERENCES = {
  core: "references/profiles/core.md",
  frontend: "references/profiles/frontend.md",
  node: "references/profiles/node.md",
  "http-client": "references/profiles/http-client.md",
  "http-server": "references/profiles/http-server.md",
  db: "references/profiles/db.md",
  rpc: "references/profiles/rpc.md",
  ai: "references/effect-ai.md",
  workflow: "references/workflow.md",
}

export const ALWAYS_REFERENCE_ROUTES = [
  { owner: "profile:always:rules-summary", ref: "references/generated/rules-summary.md §Generated Rule Summary" },
  { owner: "profile:always:checklist", ref: "references/generated/checklist.md §Generated Delivery Checklist" },
  { owner: "profile:always:scanner-manifest", ref: "references/scanner-manifest.md §Scanner v2 Manifest And Agent Workflow" },
  { owner: "profile:always:language-service", ref: "references/language-service.md §Reference: `@effect/language-service` — LSP 诊断与 Agent 自审" },
]

export const VERSION_REFERENCE_ROUTES = {
  3: { owner: "version:v3", ref: "references/versions/v3.md §Effect v3 Notes" },
  4: { owner: "version:v4", ref: "references/versions/v4.md §Effect v4 Notes" },
}

export const PROFILE_REFERENCE_ROUTES = {
  core: { owner: "profile:core", ref: "references/profiles/core.md §Profile: core" },
  frontend: { owner: "profile:frontend", ref: "references/profiles/frontend.md §Profile: frontend" },
  node: { owner: "profile:node", ref: "references/profiles/node.md §Profile: node" },
  "http-client": { owner: "profile:http-client", ref: "references/profiles/http-client.md §Profile: http-client" },
  "http-server": { owner: "profile:http-server", ref: "references/profiles/http-server.md §Profile: http-server" },
  db: { owner: "profile:db", ref: "references/profiles/db.md §Profile: db" },
  rpc: { owner: "profile:rpc", ref: "references/profiles/rpc.md §Profile: rpc" },
  ai: { owner: "profile:ai", ref: "references/effect-ai.md §Reference: `@effect/ai` — Provider-agnostic LLM 与 Agentic Workflows" },
  workflow: { owner: "profile:workflow", ref: "references/workflow.md §Reference: `@effect/workflow` and `@effect/cluster`" },
}

const SHAPE_PROFILES = {
  "http-server": ["http-server"],
  "http-client": ["http-client"],
  "db:pg": ["db"],
  "db:mysql": ["db"],
  "db:sqlite": ["db"],
  "db:d1": ["db"],
  "db:clickhouse": ["db"],
  ai: ["ai"],
  rpc: ["rpc"],
  workflow: ["workflow"],
  frontend: ["frontend"],
  node: ["node"],
}

const SIGNAL_VALIDATORS = compileContractValidators()
const SIGNAL_DEFINITIONS = signalDefinitionsByKind(SIGNAL_VALIDATORS.signalsContract)

export function buildProfile(root, manifest, files, lsp, scanState = null) {
  const activeProfiles = activeProfilesFor(manifest)
  const effectVersions = effectVersionsFromResolution(scanState)
  const effectVersionsResolution = profileVersionResolution(scanState)
  return {
    manifestPath: manifest ? ".effect-skill.json" : null,
    activeProfiles,
    effectVersions,
    effectVersionsResolution,
    effectVersionsProof: profileVersionProof(scanState),
    requiredReferences: requiredReferencesFor(activeProfiles, effectVersions, manifest),
    packages: manifest?.packages.map((pkg) => ({
      path: pkg.path,
      shape: pkg.shape,
      dependencyOwner: pkg.dependencyOwner,
      edges: manifest.executableEdges.filter((edge) => belongsToPackage(pkg.path, edge.path)).map((edge) => edge.path),
      adapters: manifest.allowedAdapters.filter((adapter) => belongsToPackage(pkg.path, adapter.path)).map((adapter) => adapter.path),
      aiProviderTransports: manifest.aiProviderTransports.filter((transport) => belongsToPackage(pkg.path, transport.path)).map((transport) => transport.path),
      tests: files.filter((file) => file.package?.path === pkg.path && file.roles.test).map((file) => file.relative),
      depsResolved: Object.fromEntries(Object.entries(pkg.deps).filter(([name]) => name === "effect" || name.startsWith("@effect/"))),
    })) ?? [],
    hostTooling: manifest?.hostTooling ?? [],
    rules: {
      deterministicFamilies: [...new Set(Object.values(RULES).map((rule) => rule.family))].sort(),
    },
    lsp: {
      available: lsp?.available ?? false,
      tscVersion: lsp?.tscVersion ?? null,
      languageServiceVersion: lsp?.languageServiceVersion ?? null,
    },
  }
}

export function activeProfilesFor(manifest) {
  if (!manifest) return ["core"]
  const profiles = new Set(["core"])
  for (const pkg of manifest.packages) {
    for (const shape of pkg.shape) {
      for (const profile of SHAPE_PROFILES[shape] ?? []) profiles.add(profile)
    }
  }
  return [...profiles].sort()
}

export function effectVersionsFor(manifest) {
  const majors = new Set()
  for (const pkg of manifest?.packages ?? []) {
    const major = effectMajor(pkg.deps?.effect)
    if (major) majors.add(major)
  }
  return [...majors].sort((a, b) => Number(a) - Number(b)).map((major) => `v${major}`)
}

export function requiredReferencesFor(activeProfiles, effectVersions, manifest = null) {
  const references = new Set(ALWAYS_REFERENCES)
  if (manifest?.wranglerPath) references.add("references/runtime-boundaries.md")
  for (const version of effectVersions) {
    const major = Number(version.replace(/^v/, ""))
    const ref = VERSION_REFERENCES[major]
    if (ref) references.add(ref)
  }
  for (const profile of activeProfiles) {
    const ref = PROFILE_REFERENCES[profile]
    if (ref) references.add(ref)
  }
  return [...references].sort()
}

export function buildSignals(root, manifest, files, scanState = null) {
  const signals = []
  if (!manifest) return signals
  const emit = (kind, partial) => {
    const definition: any = SIGNAL_DEFINITIONS.get(kind)
    if (!definition) throw new Error(`unknown signal kind: ${kind}`)
    const signal = {
      kind,
      ...partial,
      skill_ref: definition.skill_ref,
      agent_action: definition.agent_action,
    }
    const result = SIGNAL_VALIDATORS.validateSignal(signal)
    if (!result.ok) throw new Error(result.message)
    signals.push(signal)
  }
  const runtimeFacts = cloudflareRuntimeFacts(root, manifest)
  if (runtimeFacts) {
    assertRuntimeFacts(runtimeFacts)
    emit("cloudflare-runtime-facts", {
      facts: runtimeFacts,
    })
  }
  for (const file of files) {
    if (file.roles.generated) continue
    const text = codeTokenText(file)
    const facts = astFactsForFile(file)
    if (/HttpApiEndpoint|HttpApiGroup|HttpApi\.make/.test(text)) {
      emit("http-api-boundary-file", {
        file: file.relative,
        facts: {
          containsHttpApiToken: true,
          importsSchema: /from\s+["']effect\/Schema["']|from\s+["']effect["'].*Schema/.test(text),
        },
      })
    }
    if (/Rpc\.make|RpcGroup|RpcRouter/.test(text)) {
      emit("rpc-boundary-file", {
        file: file.relative,
        facts: {
          containsRpcToken: true,
          importsSchema: /from\s+["']effect\/Schema["']|from\s+["']effect["'].*Schema/.test(text),
        },
      })
    }
    if (file.package?.shape?.includes("library") && /\bexport\s+(const|function)\b/.test(text)) {
      emit("library-exported-effect-file", {
        package: file.package.path,
        file: file.relative,
        facts: {
          hasExports: true,
          containsEffectType: /\bEffect\./.test(text),
          containsWithSpan: /\bEffect\.withSpan\b/.test(text),
        },
      })
    }
    const resilienceCalls = facts.calls.filter((name) =>
      ["Effect.retry", "Effect.repeat", "Schedule.recurs", "Schedule.exponential", "Schedule.spaced", "Schedule.fixed", "Schedule.jittered", "Schedule.upTo"].includes(name)
    )
    if (resilienceCalls.length > 0 || facts.scheduleMembers.length > 0) {
      emit("resilience-boundary-file", {
        file: file.relative,
        facts: {
          calls: resilienceCalls,
          scheduleMembers: facts.scheduleMembers,
        },
      })
    }
    const pubsubCalls = facts.calls.filter((name) => name.startsWith("PubSub."))
    if (pubsubCalls.length > 0) {
      emit("pubsub-ordering-file", {
        file: file.relative,
        facts: {
          calls: pubsubCalls,
          pubsubConstructors: facts.pubsubConstructors,
        },
      })
    }
  }
  for (const pkg of manifest.packages) {
    const resolved = packageResolution(scanState, pkg.path)
    const effectMajor = safePackageMajor(resolved)
    const missingOtelPeers = effectMajor === 4 && Boolean(pkg.deps["@effect/opentelemetry"])
      ? otelPeerClosureForEffectMajor(effectMajor).filter((name) => !pkg.deps[name])
      : []
    if (missingOtelPeers.length > 0 && !otelPeerClosureIsDeterministic(resolved, effectMajor)) {
      const policy = otelPeerClosurePolicyForEffectMajor(effectMajor)
      emit("effect-capability-proof-gap", {
        package: pkg.path,
        facts: {
          capability: "v4-otel-peer-closure",
          missingPeers: missingOtelPeers,
          declaredEffectVersions: (resolved?.declaredMajor?.candidates ?? []).filter((candidate) => candidate.packageName === "effect").map((candidate) => candidate.versionRange).sort(),
          installedEffectVersions: (resolved?.installedMajor?.candidates ?? []).filter((candidate) => candidate.packageName === "effect" && candidate.versionRange).map((candidate) => candidate.versionRange).sort(),
          failureMode: policy?.failureMode ?? "downgrade-to-signal-if-peer-closure-unproven",
        },
      })
    }
    if (pkg.shape.includes("ai")) {
      const effectAiProviderPackages = Object.keys(pkg.deps).filter((name) => name.startsWith("@effect/ai-")).sort()
      emit("ai-runtime-facts", {
        package: pkg.path,
        facts: {
          hasEffectAiDependency: Boolean(pkg.deps["@effect/ai"]),
          effectAiProviderPackages,
          declaredProviderTransports: manifest.aiProviderTransports
            .filter((transport) => belongsToPackage(pkg.path, transport.path))
            .map((transport) => ({ path: transport.path, owner: transport.owner }))
            .sort((a, b) => a.path.localeCompare(b.path)),
          directProviderSdkDependencies: ["openai", "@anthropic-ai/sdk", "@google/genai"].filter((name) => Boolean(pkg.deps[name])),
        },
      })
    }
    if (pkg.shape.some((shape) => !["library", "node-tool"].includes(shape))) {
      const packageFiles = files.filter((file) => file.package?.path === pkg.path)
      emit("observability-wiring-facts", {
        package: pkg.path,
        facts: observabilityFacts(pkg, packageFiles),
      })
    }
  }
  return signals
}

function belongsToPackage(packagePath, filePath) {
  return packagePath === "." || filePath === packagePath || filePath.startsWith(`${packagePath}/`)
}

function effectMajor(versionRange) {
  if (typeof versionRange !== "string") return null
  const match = versionRange.match(/\d+/)
  if (!match) return null
  const major = Number(match[0])
  return major === 3 || major === 4 ? major : null
}

function observabilityFacts(pkg, packageFiles) {
  const layerFactories = new Set<string>()
  const importedModules = new Set<string>()
  for (const file of packageFiles) {
    const facts = astFactsForFile(file)
    for (const factory of facts.opentelemetryLayerFactories) layerFactories.add(factory)
    for (const moduleName of facts.opentelemetryImportedModules) importedModules.add(moduleName)
  }
  const sortedLayerFactories = [...layerFactories].sort()
  return {
    hasEffectOpenTelemetryDependency: Boolean(pkg.deps["@effect/opentelemetry"]),
    hasEffectPlatformDependency: Boolean(pkg.deps["@effect/platform"]),
    opentelemetryImportedModules: [...importedModules].sort(),
    opentelemetryLayerFactories: sortedLayerFactories,
    containsNodeSdkLayer: hasLayerFactory(sortedLayerFactories, "NodeSdk"),
    containsWebSdkLayer: hasLayerFactory(sortedLayerFactories, "WebSdk"),
    containsOtlpLayer: hasLayerFactory(sortedLayerFactories, "Otlp"),
    containsHttpClientToken: packageFiles.some((file) => /\bHttpClient\b|@effect\/platform\/HttpClient/.test(codeTokenText(file))),
    containsFetchHttpClientLayer: packageFiles.some((file) => /\bFetchHttpClient\.layer\b/.test(codeTokenText(file))),
  }
}

function hasLayerFactory(factories, moduleName) {
  return factories.some((factory) => factory === `${moduleName}.layer` || factory.startsWith(`${moduleName}.layer`))
}
