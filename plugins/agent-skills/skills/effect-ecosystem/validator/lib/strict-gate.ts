import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { makeFinding } from "./rule-policy.js"
import { rootPackageJson } from "./manifest.js"

export function strictPrerequisites(root, manifest) {
  const findings = []
  const tsc = runLocalTsc(root, ["--version"])
  if (tsc.error || tsc.status !== 0) {
    findings.push(makeFinding(root, { ruleId: "EFF901", file: "." }))
  }
  const pkg = rootPackageJson(root)
  const devDeps = pkg.devDependencies ?? {}
  if (!Object.prototype.hasOwnProperty.call(devDeps, "@effect/language-service") || !existsSync(localLanguageServiceCli(root))) {
    findings.push(makeFinding(root, { ruleId: "EFF902", file: "package.json" }))
  }
  return findings
}

export function runLocalTsc(root, args) {
  const tsc = localTscPath(root)
  if (!existsSync(tsc)) {
    return { error: new Error(`missing local TypeScript compiler: ${tsc}`), status: 1, stdout: "", stderr: "" }
  }
  return spawnSync(process.execPath, [tsc, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20_000_000,
  })
}

export function runLocalLanguageService(root, args) {
  const cli = localLanguageServiceCli(root)
  if (!existsSync(cli)) {
    return { error: new Error(`missing local @effect/language-service CLI: ${cli}`), status: 1, stdout: "", stderr: "" }
  }
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20_000_000,
  })
}

export function localTscPath(root) {
  return resolve(root, "node_modules", "typescript", "bin", "tsc")
}

export function localLanguageServiceCli(root) {
  return resolve(root, "node_modules", "@effect", "language-service", "cli.js")
}
