import ts from "typescript"

const codeLineCache = new WeakMap<object, string[]>()

export function codeTokenLines(file) {
  const cached = codeLineCache.get(file)
  if (cached) return cached
  const sourceText = file.lines.map((line) => line.text).join("\n")
  const sourceFile = ts.createSourceFile(file.relative, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(file.relative))
  const moduleSpecifiers = moduleSpecifierSpans(sourceFile)
  const out = sourceText.split("").map((char) => char === "\n" || char === "\r" ? char : " ")
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, sourceText)
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const start = scanner.getTokenPos()
    const end = scanner.getTextPos()
    if (!preserveToken(token, start, end, moduleSpecifiers)) continue
    for (let index = start; index < end; index++) out[index] = sourceText[index]
  }
  const codeLines = out.join("").split(/\r?\n/)
  codeLineCache.set(file, codeLines)
  return codeLines
}

export function codeTokenText(file) {
  return codeTokenLines(file).join("\n")
}

function preserveToken(token, start, end, moduleSpecifiers) {
  if (isTrivia(token)) return false
  if (isStringLike(token)) return hasSpan(moduleSpecifiers, start, end)
  return true
}

function moduleSpecifierSpans(sourceFile) {
  const spans = []
  visit(sourceFile)
  return spans

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      spans.push({ start: node.moduleSpecifier.getStart(sourceFile), end: node.moduleSpecifier.getEnd() })
    }
    if (ts.isExternalModuleReference(node)) {
      spans.push({ start: node.expression.getStart(sourceFile), end: node.expression.getEnd() })
    }
    ts.forEachChild(node, visit)
  }
}

function hasSpan(spans, start, end) {
  return spans.some((span) => start >= span.start && end <= span.end)
}

function isTrivia(token) {
  return token === ts.SyntaxKind.WhitespaceTrivia
    || token === ts.SyntaxKind.NewLineTrivia
    || token === ts.SyntaxKind.SingleLineCommentTrivia
    || token === ts.SyntaxKind.MultiLineCommentTrivia
    || token === ts.SyntaxKind.ConflictMarkerTrivia
}

function isStringLike(token) {
  return token === ts.SyntaxKind.StringLiteral
    || token === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    || token === ts.SyntaxKind.TemplateHead
    || token === ts.SyntaxKind.TemplateMiddle
    || token === ts.SyntaxKind.TemplateTail
}

function scriptKindFor(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX
  return ts.ScriptKind.TS
}
