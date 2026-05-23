import { resolve } from "node:path"
import { matchesAny, readLines, rel, toPosix, walkFiles } from "./util.js"
import { packageForFile } from "./manifest.js"

export function collectSourceFiles(root, manifest) {
  return walkFiles(root)
    .filter((file) => !file.endsWith(".d.ts"))
    .map((file) => classifyFile(root, file, manifest))
    .filter((file) => !file.roles.hostTooling)
}

export function classifyFile(root, file, manifest) {
  const relative = rel(root, file)
  const normalized = toPosix(relative)
  const lines = readLines(file).map((text, index) => ({ number: index + 1, text }))
  const pkg = packageForFile(manifest, normalized)
  const isTest = manifest
    ? matchesAny(normalized, manifest.testGlobs)
    : /\.(test|spec)\.tsx?$/.test(normalized)
  const isGenerated = Boolean(manifest?.generatedPaths?.some((item) => matchesAny(normalized, [item.glob])))
  const isHostTooling = Boolean(manifest?.hostTooling?.some((item) => matchesAny(normalized, [item.path])))
  const isExecutableEdge = Boolean(manifest?.executableEdges?.some((item) => item.path === normalized))
  const allowedAdapterRules = manifest?.allowedAdapters
    ?.filter((item) => matchesAny(normalized, [item.path]))
    .flatMap((item) => item.rules ?? []) ?? []
  return {
    absolute: resolve(file),
    relative: normalized,
    lines,
    package: pkg,
    roles: {
      source: !isTest && !isGenerated,
      test: isTest,
      generated: isGenerated,
      hostTooling: isHostTooling,
      executableEdge: isExecutableEdge,
      adapter: allowedAdapterRules.length > 0,
    },
    allowedAdapterRules,
  }
}
