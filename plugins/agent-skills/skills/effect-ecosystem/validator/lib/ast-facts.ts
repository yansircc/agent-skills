import ts from "typescript"

export function astFactsForFile(file) {
  const source = file.lines.map((line) => line.text).join("\n")
  const sourceFile = ts.createSourceFile(file.relative, source, ts.ScriptTarget.Latest, true, scriptKindFor(file.relative))
  return astFactsForSourceFile(sourceFile)
}

export function astFactsForSourceFile(sourceFile) {
  const imports = importIndex(sourceFile)
  const calls = new Set<string>()
  const members = new Set<string>()

  visit(sourceFile)

  return {
    calls: [...calls].sort(),
    members: [...members].sort(),
    scheduleMembers: [...members].filter((name) => name.startsWith("Schedule.")).sort(),
    pubsubConstructors: [...calls].filter((name) => isPubSubConstructor(name)).sort(),
    opentelemetryImportedModules: [...imports.opentelemetryImportedModules].sort(),
    opentelemetryLayerFactories: [...members, ...calls].filter(isOpenTelemetryLayerFactory).sort(),
  }

  function visit(node) {
    if (ts.isPropertyAccessExpression(node)) {
      const member = resolveExpressionName(node, imports)
      if (member) members.add(member)
    }
    if (ts.isCallExpression(node)) {
      const call = resolveExpressionName(node.expression, imports)
      if (call) calls.add(call)
    }
    ts.forEachChild(node, visit)
  }
}

function importIndex(sourceFile) {
  const namedRoots = new Map<string, string>()
  const namespaces = new Map<string, any>()
  const directBindings = new Map<string, string>()
  const opentelemetryImportedModules = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const moduleSpecifier = statement.moduleSpecifier.text
    const moduleInfo = moduleInfoFor(moduleSpecifier)
    if (!moduleInfo) continue

    const clause = statement.importClause
    if (!clause) continue
    if (clause.name) {
      directBindings.set(clause.name.text, moduleInfo.defaultName)
    }
    if (!clause.namedBindings) continue

    if (ts.isNamespaceImport(clause.namedBindings)) {
      namespaces.set(clause.namedBindings.name.text, moduleInfo)
      continue
    }

    for (const element of clause.namedBindings.elements) {
      const importedName = (element.propertyName ?? element.name).text
      const localName = element.name.text
      if (moduleInfo.kind === "effect-root") {
        namedRoots.set(localName, importedName)
      } else if (moduleInfo.kind === "effect-submodule") {
        directBindings.set(localName, `${moduleInfo.name}.${importedName}`)
      } else if (moduleInfo.kind === "otel-root") {
        namedRoots.set(localName, importedName)
        opentelemetryImportedModules.add(importedName)
      } else if (moduleInfo.kind === "otel-submodule") {
        directBindings.set(localName, `${moduleInfo.name}.${importedName}`)
        opentelemetryImportedModules.add(moduleInfo.name)
      }
    }
  }

  return { namedRoots, namespaces, directBindings, opentelemetryImportedModules }
}

function resolveExpressionName(expression, imports) {
  if (ts.isIdentifier(expression)) {
    return imports.directBindings.get(expression.text) ?? imports.namedRoots.get(expression.text) ?? null
  }
  if (!ts.isPropertyAccessExpression(expression)) return null

  const chain = propertyAccessChain(expression)
  if (chain.length < 2) return null
  const [head, ...tail] = chain

  const namedRoot = imports.namedRoots.get(head)
  if (namedRoot) return [namedRoot, ...tail].join(".")

  const direct = imports.directBindings.get(head)
  if (direct) return [direct, ...tail].join(".")

  const namespace = imports.namespaces.get(head)
  if (!namespace) return null
  if (namespace.kind === "effect-root" || namespace.kind === "otel-root") return tail.join(".")
  return [namespace.name, ...tail].join(".")
}

function propertyAccessChain(node) {
  const names = [node.name.text]
  let current = node.expression
  while (ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text)
    current = current.expression
  }
  if (ts.isIdentifier(current)) names.unshift(current.text)
  return names
}

function moduleInfoFor(moduleSpecifier) {
  if (moduleSpecifier === "effect") return { kind: "effect-root", name: "effect", defaultName: "effect" }
  if (moduleSpecifier.startsWith("effect/")) {
    const name = moduleSpecifier.slice("effect/".length).split("/").at(-1)
    return { kind: "effect-submodule", name, defaultName: name }
  }
  if (moduleSpecifier === "@effect/opentelemetry") return { kind: "otel-root", name: "opentelemetry", defaultName: "opentelemetry" }
  if (moduleSpecifier.startsWith("@effect/opentelemetry/")) {
    const [name] = moduleSpecifier.slice("@effect/opentelemetry/".length).split("/")
    return { kind: "otel-submodule", name, defaultName: name }
  }
  return null
}

function isOpenTelemetryLayerFactory(name) {
  const parts = name.split(".")
  const member = parts.at(-1)
  return member === "layer" || /^layer[A-Z0-9_]/.test(member ?? "")
}

function isPubSubConstructor(name) {
  return [
    "PubSub.bounded",
    "PubSub.dropping",
    "PubSub.sliding",
    "PubSub.unbounded",
  ].includes(name)
}

function scriptKindFor(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX
  return ts.ScriptKind.TS
}
