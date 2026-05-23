import ts from "typescript"
import { RULES } from "./rule-policy.js"
import { codeTokenText } from "./code-view.js"
import { cloudflareRuntimeFacts } from "./runtime-facts.js"
import { assertRuntimeFacts } from "./contract-validation.js"

const ALWAYS_REFERENCES = [
  "references/generated/rules-summary.md",
  "references/generated/checklist.md",
  "references/scanner-manifest.md",
  "references/language-service.md",
]

const VERSION_REFERENCES = {
  3: "references/versions/v3.md",
  4: "references/versions/v4.md",
}

const PROFILE_REFERENCES = {
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

export function buildProfile(root, manifest, files, lsp) {
  const activeProfiles = activeProfilesFor(manifest)
  const effectVersions = effectVersionsFor(manifest)
  const effectVersionsResolution = effectVersions.length > 0 ? "manifest" : "unresolved"
  return {
    manifestPath: manifest ? ".effect-skill.json" : null,
    activeProfiles,
    effectVersions,
    effectVersionsResolution,
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

export function buildSignals(root, manifest, files) {
  const signals = []
  if (!manifest) return signals
  const runtimeFacts = cloudflareRuntimeFacts(root, manifest)
  if (runtimeFacts) {
    assertRuntimeFacts(runtimeFacts)
    signals.push({
      kind: "cloudflare-runtime-facts",
      facts: runtimeFacts,
      skill_ref: "references/runtime-boundaries.md §Cloudflare runtime facts",
      agent_action: "Use these facts only as runtime substrate; decide support with validUnder proof, not scanner inference.",
    })
  }
  for (const file of files) {
    if (file.roles.generated) continue
    const text = codeTokenText(file)
    if (/HttpApiEndpoint|HttpApiGroup|HttpApi\.make/.test(text)) {
      signals.push({
        kind: "http-api-boundary-file",
        file: file.relative,
        facts: {
          containsHttpApiToken: true,
          importsSchema: /from\s+["']effect\/Schema["']|from\s+["']effect["'].*Schema/.test(text),
        },
        skill_ref: "SKILL.md §3",
        agent_action: "Read the file and decide whether boundary DTOs/errors require effect/Schema.",
      })
    }
    if (/Rpc\.make|RpcGroup|RpcRouter/.test(text)) {
      signals.push({
        kind: "rpc-boundary-file",
        file: file.relative,
        facts: {
          containsRpcToken: true,
          importsSchema: /from\s+["']effect\/Schema["']|from\s+["']effect["'].*Schema/.test(text),
        },
        skill_ref: "SKILL.md §4",
        agent_action: "Read the file and decide whether requests, responses, and errors are schema-backed.",
      })
    }
    if (file.package?.shape?.includes("library") && /\bexport\s+(const|function)\b/.test(text)) {
      signals.push({
        kind: "library-exported-effect-file",
        package: file.package.path,
        file: file.relative,
        facts: {
          hasExports: true,
          containsEffectType: /\bEffect\./.test(text),
          containsWithSpan: /\bEffect\.withSpan\b/.test(text),
        },
        skill_ref: "SKILL.md §5",
        agent_action: "Read exported Effects and decide which public boundaries need spans.",
      })
    }
  }
  for (const pkg of manifest.packages) {
    if (pkg.shape.includes("ai")) {
      const effectAiProviderPackages = Object.keys(pkg.deps).filter((name) => name.startsWith("@effect/ai-")).sort()
      signals.push({
        kind: "ai-runtime-facts",
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
        skill_ref: "references/effect-ai.md §Provider ownership",
        agent_action: "Decide whether @effect/ai owns the loop and whether provider packages or declared transports are terminal adapters only.",
      })
    }
    if (pkg.shape.some((shape) => !["library", "node-tool"].includes(shape))) {
      const packageFiles = files.filter((file) => file.package?.path === pkg.path)
      signals.push({
        kind: "observability-wiring-facts",
        package: pkg.path,
        facts: observabilityFacts(pkg, packageFiles),
        skill_ref: "SKILL.md §5",
        agent_action: "Decide whether production top-level Layer wires the correct OTel SDK for this runtime.",
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
  const layerFactories = new Set()
  const importedModules = new Set()
  for (const file of packageFiles) {
    const source = file.lines.map((line) => line.text).join("\n")
    const sourceFile = ts.createSourceFile(file.relative, source, ts.ScriptTarget.Latest, true, scriptKindFor(file.relative))
    const facts = opentelemetryFactsForFile(sourceFile)
    for (const factory of facts.layerFactories) layerFactories.add(factory)
    for (const moduleName of facts.importedModules) importedModules.add(moduleName)
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

function opentelemetryFactsForFile(sourceFile) {
  const imports = opentelemetryImportIndex(sourceFile)
  const layerFactories = new Set()
  const importedModules = new Set(imports.importedModules)
  visit(sourceFile)
  return {
    importedModules: [...importedModules],
    layerFactories: [...layerFactories],
  }

  function visit(node) {
    if (ts.isPropertyAccessExpression(node)) {
      const factory = opentelemetryLayerFactory(node, imports)
      if (factory) layerFactories.add(factory)
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const factory = imports.directLayerFunctions.get(node.expression.text)
      if (factory) layerFactories.add(factory)
    }
    ts.forEachChild(node, visit)
  }
}

function opentelemetryImportIndex(sourceFile) {
  const rootNamespaces = new Set()
  const namedModules = new Map()
  const submoduleNamespaces = new Map()
  const directLayerFunctions = new Map()
  const importedModules = new Set()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const moduleSpecifier = statement.moduleSpecifier.text
    const otelModule = opentelemetryModuleName(moduleSpecifier)
    if (otelModule === null) continue
    if (otelModule !== "root") importedModules.add(otelModule)

    const clause = statement.importClause
    if (!clause) continue
    if (clause.name && otelModule !== "root") submoduleNamespaces.set(clause.name.text, otelModule)
    if (!clause.namedBindings) continue

    if (ts.isNamespaceImport(clause.namedBindings)) {
      const local = clause.namedBindings.name.text
      if (otelModule === "root") rootNamespaces.add(local)
      else submoduleNamespaces.set(local, otelModule)
      continue
    }

    for (const element of clause.namedBindings.elements) {
      const importedName = (element.propertyName ?? element.name).text
      const localName = element.name.text
      if (otelModule === "root") {
        namedModules.set(localName, importedName)
        importedModules.add(importedName)
      } else if (isLayerFactoryName(importedName)) {
        directLayerFunctions.set(localName, `${otelModule}.${importedName}`)
      }
    }
  }

  return { rootNamespaces, namedModules, submoduleNamespaces, directLayerFunctions, importedModules }
}

function opentelemetryLayerFactory(node, imports) {
  const factoryName = node.name.text
  if (!isLayerFactoryName(factoryName)) return null
  const target = node.expression

  if (ts.isIdentifier(target)) {
    const namedModule = imports.namedModules.get(target.text)
    if (namedModule) return `${namedModule}.${factoryName}`
    const submodule = imports.submoduleNamespaces.get(target.text)
    if (submodule) return `${submodule}.${factoryName}`
    return null
  }

  if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
    if (imports.rootNamespaces.has(target.expression.text)) return `${target.name.text}.${factoryName}`
  }

  return null
}

function opentelemetryModuleName(moduleSpecifier) {
  if (moduleSpecifier === "@effect/opentelemetry") return "root"
  if (!moduleSpecifier.startsWith("@effect/opentelemetry/")) return null
  const [moduleName] = moduleSpecifier.slice("@effect/opentelemetry/".length).split("/")
  return moduleName || null
}

function isLayerFactoryName(name) {
  return name === "layer" || /^layer[A-Z0-9_]/.test(name)
}

function hasLayerFactory(factories, moduleName) {
  return factories.some((factory) => factory === `${moduleName}.layer` || factory.startsWith(`${moduleName}.layer`))
}

function scriptKindFor(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX
  return ts.ScriptKind.TS
}
