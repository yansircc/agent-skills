import { RULES } from "./rule-policy.js"
import { codeTokenText } from "./code-view.js"

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
}

const SHAPE_PROFILES = {
  "http-server": ["http-server"],
  "http-client": ["http-client"],
  "db:pg": ["db"],
  "db:mysql": ["db"],
  "db:sqlite": ["db"],
  "db:d1": ["db"],
  "db:clickhouse": ["db"],
  rpc: ["rpc"],
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
    requiredReferences: requiredReferencesFor(activeProfiles, effectVersions),
    packages: manifest?.packages.map((pkg) => ({
      path: pkg.path,
      shape: pkg.shape,
      dependencyOwner: pkg.dependencyOwner,
      edges: manifest.executableEdges.filter((edge) => belongsToPackage(pkg.path, edge.path)).map((edge) => edge.path),
      adapters: manifest.allowedAdapters.filter((adapter) => belongsToPackage(pkg.path, adapter.path)).map((adapter) => adapter.path),
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

export function requiredReferencesFor(activeProfiles, effectVersions) {
  const references = new Set(ALWAYS_REFERENCES)
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

export function buildSignals(manifest, files) {
  const signals = []
  if (!manifest) return signals
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
    if (pkg.shape.some((shape) => !["library", "node-tool"].includes(shape))) {
      const packageFiles = files.filter((file) => file.package?.path === pkg.path)
      signals.push({
        kind: "observability-wiring-facts",
        package: pkg.path,
        facts: {
          hasEffectOpenTelemetryDependency: Boolean(pkg.deps["@effect/opentelemetry"]),
          containsNodeSdkLayer: packageFiles.some((file) => /NodeSdk\.layer/.test(codeTokenText(file))),
          containsWebSdkLayer: packageFiles.some((file) => /WebSdk\.layer/.test(codeTokenText(file))),
        },
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
