import { makeFinding } from "./rule-policy.js"

const RUN_RE = /\bEffect\.run(Promise|Sync|SyncExit|Fork|Callback)\b|=\s*Effect\.run(Promise|Sync|SyncExit|Fork|Callback)\b/
const RUNMAIN_RE = /\b(NodeRuntime|BunRuntime|BrowserRuntime)\.runMain\s*\(/
const PLATFORM_CTOR_RE = /\bnew\s+(Response|Request|XMLHttpRequest|WebSocket|EventSource)\s*\(/
const NAMESPACE_IMPORT_RE = /import\s+\*\s+as\s+\w+\s+from\s+['"](effect|@effect\/[^'"]+)['"]/
const DYNAMIC_IMPORT_RE = /\brequire\s*\(|(^|\s)import\s*\(/

export function scanEdgeRules(root, files, manifest) {
  if (!manifest) return []
  const findings = []
  for (const file of files) {
    const isEdge = file.roles.executableEdge
    const allowsPlatformCtor = file.allowedAdapterRules.includes("EFF402")
    for (const line of file.lines) {
      if (!isEdge && RUN_RE.test(line.text)) {
        findings.push(makeFinding(root, {
          ruleId: "EFF400",
          file: file.relative,
          line: line.number,
          lineText: line.text.trim(),
          package: file.package?.path ?? null,
        }))
      }
      if (!allowsPlatformCtor && PLATFORM_CTOR_RE.test(line.text)) {
        findings.push(makeFinding(root, {
          ruleId: "EFF402",
          file: file.relative,
          line: line.number,
          lineText: line.text.trim(),
          package: file.package?.path ?? null,
        }))
      }
      if (NAMESPACE_IMPORT_RE.test(line.text)) {
        findings.push(makeFinding(root, {
          ruleId: "EFF403",
          file: file.relative,
          line: line.number,
          lineText: line.text.trim(),
          package: file.package?.path ?? null,
        }))
      }
      if (file.roles.source && DYNAMIC_IMPORT_RE.test(line.text)) {
        findings.push(makeFinding(root, {
          ruleId: "EFF404",
          file: file.relative,
          line: line.number,
          lineText: line.text.trim(),
          package: file.package?.path ?? null,
        }))
      }
    }
  }

  for (const edge of manifest.executableEdges) {
    const file = files.find((item) => item.relative === edge.path)
    if (!file) {
      findings.push(makeFinding(root, {
        ruleId: "EFF401",
        file: edge.path,
        line: 1,
        lineText: "",
        message: `executable edge ${edge.path} does not exist or is not a TypeScript file`,
      }))
      continue
    }
    if (!file.lines.some((line) => RUNMAIN_RE.test(line.text))) {
      findings.push(makeFinding(root, {
        ruleId: "EFF401",
        file: edge.path,
        line: 1,
        lineText: file.lines[0]?.text?.trim() ?? "",
      }))
    }
  }
  return findings
}
