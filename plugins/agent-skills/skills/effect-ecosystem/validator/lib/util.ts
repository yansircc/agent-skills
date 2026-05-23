import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, extname as pathExtname, relative, resolve, sep } from "node:path"

export const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"])

export function toPosix(path) {
  return path.split(sep).join("/")
}

export function rel(root, file) {
  return toPosix(relative(root, file)) || toPosix(file)
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

export function findUp(name, start) {
  let current = resolve(start)
  while (true) {
    const candidate = resolve(current, name)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function walkFiles(root, options: any = {}) {
  const out = []
  const ignoreDirs = new Set(options.ignoreDirs ?? [
    ".git",
    ".cst",
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "out",
  ])
  const include = options.include ?? ((file) => TEXT_EXTENSIONS.has(extname(file)))
  visit(resolve(root))
  return out

  function visit(path) {
    const stat = statSync(path)
    if (stat.isDirectory()) {
      const base = path.split(sep).at(-1)
      if (ignoreDirs.has(base)) return
      for (const entry of readdirSync(path)) visit(resolve(path, entry))
      return
    }
    if (stat.isFile() && include(path)) out.push(path)
  }
}

export function extname(path) {
  const base = path.split(/[\\/]/).at(-1) ?? ""
  if (base.endsWith(".d.ts")) return ".d.ts"
  return pathExtname(base)
}

export function readLines(file) {
  return readFileSync(file, "utf8").split(/\r?\n/)
}

export function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

export function unique(items) {
  return [...new Set(items)]
}

export function globToRegExp(glob) {
  const normalized = toPosix(glob)
  let out = "^"
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    const next = normalized[i + 1]
    if (ch === "*" && next === "*") {
      const after = normalized[i + 2]
      if (after === "/") {
        out += "(?:.*/)?"
        i += 2
      } else {
        out += ".*"
        i += 1
      }
      continue
    }
    if (ch === "*") {
      out += "[^/]*"
      continue
    }
    if (ch === "?") {
      out += "[^/]"
      continue
    }
    out += escapeRegExp(ch)
  }
  out += "$"
  return new RegExp(out)
}

export function matchesAny(path, globs) {
  const normalized = toPosix(path)
  return globs.some((glob) => globToRegExp(glob).test(normalized))
}

export function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
}

export function depsOf(packageJson) {
  return {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  }
}

export function devDepsOf(packageJson) {
  return {
    ...(packageJson.devDependencies ?? {}),
  }
}
