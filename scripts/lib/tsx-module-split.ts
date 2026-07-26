import { dirname, relative } from "node:path"

import type { Node, Program } from "@oxc-project/types"
import { parseSync } from "oxc-parser"

export interface TsxModuleDeclaration {
  names: string[]
  kind: string
  exported: boolean
  typeOnly: boolean
  startLine: number
  endLine: number
  importedDependencies: string[]
  localDependencies: string[]
}

export interface TsxModuleAnalysis {
  file: string
  lines: number
  declarations: TsxModuleDeclaration[]
}

export interface TsxModuleSplitResult {
  source: string
  module: string
  report: {
    sourceFile: string
    targetFile: string
    moved: string[]
    sourceImports: string[]
    sourceReexports: string[]
    targetImports: string[]
  }
}

interface ParsedSource {
  file: string
  content: string
  program: Program
  comments: SourceComment[]
  lineStarts: number[]
  imports: ImportBinding[]
  declarations: DeclarationBinding[]
}

interface SourceComment {
  start: number
  end: number
}

interface ImportBinding {
  statement: Node
  source: string
  locals: Map<string, ImportSpecifierBinding>
}

interface ImportSpecifierBinding {
  local: string
  imported: string
  kind: "default" | "namespace" | "named"
  typeOnly: boolean
}

interface DeclarationBinding {
  statement: Node
  declaration: Node
  names: string[]
  kind: string
  exported: boolean
  exportKind: "none" | "named" | "default"
  typeOnly: boolean
}

export function analyzeTsxModule(source: string, filename: string): TsxModuleAnalysis {
  const parsed = parseSource(source, filename)
  const importLocals = new Set(parsed.imports.flatMap((entry) => [...entry.locals.keys()]))
  const localNames = new Set(parsed.declarations.flatMap((entry) => entry.names))

  return {
    file: filename,
    lines: physicalLineCount(source),
    declarations: parsed.declarations.map((entry) => {
      const identifiers = collectIdentifierNames(entry.declaration)
      for (const name of entry.names) identifiers.delete(name)
      return {
        names: entry.names,
        kind: entry.kind,
        exported: entry.exported,
        typeOnly: entry.typeOnly,
        startLine: lineAt(parsed.lineStarts, nodeStart(entry.statement)),
        endLine: lineAt(parsed.lineStarts, nodeEnd(entry.statement)),
        importedDependencies: [...identifiers].filter((name) => importLocals.has(name)).sort(),
        localDependencies: [...identifiers].filter((name) => localNames.has(name)).sort(),
      }
    }),
  }
}

export function splitTsxModule(
  source: string,
  sourceFile: string,
  targetFile: string,
  symbols: readonly string[],
): TsxModuleSplitResult {
  if (dirname(sourceFile) !== dirname(targetFile)) {
    throw new Error("TSX module extraction currently requires source and target to share one directory.")
  }
  const parsed = parseSource(source, sourceFile)
  const requested = new Set(symbols)
  if (!requested.size) throw new Error("At least one declaration symbol is required.")

  const declarationByName = new Map(parsed.declarations.flatMap((entry) => entry.names.map((name) => [name, entry] as const)))
  for (const name of requested) {
    if (!declarationByName.has(name)) throw new Error(`Unknown top-level declaration: ${name}`)
  }

  const selected = [...new Set([...requested].map((name) => declarationByName.get(name)!))]
  for (const entry of selected) {
    const omitted = entry.names.filter((name) => !requested.has(name))
    if (omitted.length) {
      throw new Error(`Declaration statement also defines ${omitted.join(", ")}; move the complete statement together.`)
    }
  }

  const selectedNames = new Set(selected.flatMap((entry) => entry.names))
  const allLocalNames = new Set(parsed.declarations.flatMap((entry) => entry.names))
  const importedNames = new Set(parsed.imports.flatMap((entry) => [...entry.locals.keys()]))
  const dependencyCandidates = new Set([...allLocalNames, ...importedNames])
  const referenced = new Set<string>()
  for (const entry of selected) {
    const shadowedDependencies = [...collectNestedBindingNames(entry.declaration)]
      .filter((name) => !selectedNames.has(name) && dependencyCandidates.has(name))
      .sort()
    if (shadowedDependencies.length) {
      throw new Error(`Selected declaration shadows top-level dependencies: ${shadowedDependencies.join(", ")}`)
    }
    for (const name of collectIdentifierNames(entry.declaration)) referenced.add(name)
  }
  for (const name of selectedNames) referenced.delete(name)
  const retainedLocalDependencies = [...referenced].filter((name) => allLocalNames.has(name) && !selectedNames.has(name)).sort()
  if (retainedLocalDependencies.length) {
    throw new Error(`Selected declarations still depend on local declarations: ${retainedLocalDependencies.join(", ")}`)
  }

  const requiredImportNames = new Set([...referenced].filter((name) => parsed.imports.some((entry) => entry.locals.has(name))))
  const targetImports = parsed.imports
    .map((entry) => formatRequiredImport(entry, requiredImportNames))
    .filter((value): value is string => Boolean(value))

  const selectedStatements = new Set(selected.map((entry) => entry.statement))
  const remainingReferences = new Set<string>()
  for (const statement of parsed.program.body as Node[]) {
    if (selectedStatements.has(statement) || statement.type === "ImportDeclaration") continue
    for (const name of collectIdentifierNames(statement)) {
      if (selectedNames.has(name)) remainingReferences.add(name)
    }
  }

  const moved = selected.flatMap((entry) => entry.names)
  const sourceTypeImports = moved.filter((name) => {
    const declaration = declarationByName.get(name)!
    return remainingReferences.has(name) && declaration.typeOnly && declaration.exportKind !== "default"
  })
  const sourceValueImports = moved.filter((name) => {
    const declaration = declarationByName.get(name)!
    return remainingReferences.has(name) && !declaration.typeOnly && declaration.exportKind !== "default"
  })
  const sourceDefaultTypeImport = moved.find((name) => {
    const declaration = declarationByName.get(name)!
    return remainingReferences.has(name) && declaration.typeOnly && declaration.exportKind === "default"
  })
  const sourceDefaultValueImport = moved.find((name) => {
    const declaration = declarationByName.get(name)!
    return remainingReferences.has(name) && !declaration.typeOnly && declaration.exportKind === "default"
  })
  const sourceTypeReexports = moved.filter((name) => {
    const declaration = declarationByName.get(name)!
    return declaration.exportKind === "named" && declaration.typeOnly
  })
  const sourceValueReexports = moved.filter((name) => {
    const declaration = declarationByName.get(name)!
    return declaration.exportKind === "named" && !declaration.typeOnly
  })
  const sourceDefaultTypeReexport = moved.some((name) => {
    const declaration = declarationByName.get(name)!
    return declaration.exportKind === "default" && declaration.typeOnly
  })
  const sourceDefaultValueReexport = moved.some((name) => {
    const declaration = declarationByName.get(name)!
    return declaration.exportKind === "default" && !declaration.typeOnly
  })
  const moduleSpecifier = `./${targetFile.slice(dirname(targetFile).length + 1).replace(/\.[^.]+$/u, "")}`.replaceAll("\\", "/")
  const sourceBridge = [
    sourceDefaultValueImport ? `import ${sourceDefaultValueImport} from ${JSON.stringify(moduleSpecifier)}` : "",
    sourceDefaultTypeImport ? `import type ${sourceDefaultTypeImport} from ${JSON.stringify(moduleSpecifier)}` : "",
    sourceValueImports.length ? `import { ${sourceValueImports.join(", ")} } from ${JSON.stringify(moduleSpecifier)}` : "",
    sourceTypeImports.length ? `import type { ${sourceTypeImports.join(", ")} } from ${JSON.stringify(moduleSpecifier)}` : "",
    sourceDefaultValueReexport ? `export { default } from ${JSON.stringify(moduleSpecifier)}` : "",
    sourceDefaultTypeReexport ? `export type { default } from ${JSON.stringify(moduleSpecifier)}` : "",
    sourceValueReexports.length ? `export { ${sourceValueReexports.join(", ")} } from ${JSON.stringify(moduleSpecifier)}` : "",
    sourceTypeReexports.length ? `export type { ${sourceTypeReexports.join(", ")} } from ${JSON.stringify(moduleSpecifier)}` : "",
  ].filter(Boolean)

  const eol = source.includes("\r\n") ? "\r\n" : "\n"
  const declarationCode = selected
    .sort((left, right) => nodeStart(left.statement) - nodeStart(right.statement))
    .map((entry) => {
      const start = leadingCommentStart(parsed, entry.statement)
      const leadingComments = source.slice(start, nodeStart(entry.statement)).trim()
      const declaration = source.slice(nodeStart(entry.statement), nodeEnd(entry.statement)).trim()
      const exportedDeclaration = entry.exported ? declaration : `export ${declaration}`
      return leadingComments ? `${leadingComments}${eol}${exportedDeclaration}` : exportedDeclaration
    })
  const directives = moduleDirectives(parsed)
  const module = [
    ...directives,
    ...(directives.length ? [""] : []),
    ...targetImports,
    "",
    ...declarationCode,
  ].join(eol).replace(new RegExp(`${escapeRegExp(eol)}{3,}`, "gu"), `${eol}${eol}`) + eol

  let nextSource = source
  for (const entry of selected.toSorted((left, right) => nodeStart(right.statement) - nodeStart(left.statement))) {
    const range = wholeLineRange(source, leadingCommentStart(parsed, entry.statement), nodeEnd(entry.statement))
    nextSource = `${nextSource.slice(0, range.start)}${nextSource.slice(range.end)}`
  }
  if (sourceBridge.length) {
    const reparsed = parseSource(nextSource, sourceFile)
    const insertAt = sourceBridgeInsertionPoint(reparsed.program)
    const before = nextSource.slice(0, insertAt)
    const after = nextSource.slice(insertAt)
    const prefix = before && !before.endsWith(eol) ? eol : ""
    const suffix = after && !after.startsWith(eol) ? eol : ""
    nextSource = `${before}${prefix}${sourceBridge.join(eol)}${suffix}${after}`
  }
  nextSource = nextSource.replace(new RegExp(`${escapeRegExp(eol)}{3,}`, "gu"), `${eol}${eol}`)

  parseSource(nextSource, sourceFile)
  parseSource(module, targetFile)

  return {
    source: nextSource,
    module,
    report: {
      sourceFile,
      targetFile,
      moved,
      sourceImports: [sourceDefaultValueImport, sourceDefaultTypeImport, ...sourceValueImports, ...sourceTypeImports]
        .filter((name): name is string => Boolean(name)),
      sourceReexports: [
        ...(sourceDefaultValueReexport || sourceDefaultTypeReexport ? ["default"] : []),
        ...sourceValueReexports,
        ...sourceTypeReexports,
      ],
      targetImports,
    },
  }
}

function parseSource(content: string, file: string): ParsedSource {
  const lang = file.endsWith(".tsx") || file.endsWith(".jsx") ? "tsx" : "ts"
  const result = parseSync(file, content, {
    lang,
    sourceType: "module",
    astType: lang.startsWith("ts") ? "ts" : "js",
    preserveParens: true,
  })
  if (result.errors.length) {
    throw new Error(`${file}: ${result.errors.map((error) => error.message).join("; ")}`)
  }
  const program = result.program
  return {
    file,
    content,
    program,
    comments: result.comments
      .filter((comment) => typeof comment.start === "number" && typeof comment.end === "number")
      .map((comment) => ({ start: comment.start, end: comment.end })),
    lineStarts: lineStarts(content),
    imports: (program.body as Node[]).filter((node) => node.type === "ImportDeclaration").map((node) => importBinding(node)),
    declarations: (program.body as Node[]).flatMap((node) => declarationBinding(node)),
  }
}

function sourceBridgeInsertionPoint(program: Program): number {
  const body = program.body as Node[]
  const lastImport = body.filter((node) => node.type === "ImportDeclaration").at(-1)
  if (lastImport) return nodeEnd(lastImport)
  let insertAt = 0
  for (const statement of body) {
    const record = statement as unknown as { directive?: unknown; expression?: { value?: unknown } }
    const isDirective = statement.type === "ExpressionStatement"
      && (typeof record.directive === "string" || typeof record.expression?.value === "string")
    if (!isDirective) break
    insertAt = nodeEnd(statement)
  }
  return insertAt
}

function moduleDirectives(parsed: ParsedSource): string[] {
  const directives: string[] = []
  for (const statement of parsed.program.body as Node[]) {
    const record = statement as unknown as { directive?: unknown; expression?: { value?: unknown } }
    const isDirective = statement.type === "ExpressionStatement"
      && (typeof record.directive === "string" || typeof record.expression?.value === "string")
    if (!isDirective) break
    directives.push(parsed.content.slice(nodeStart(statement), nodeEnd(statement)).trim())
  }
  return directives
}

function leadingCommentStart(parsed: ParsedSource, statement: Node): number {
  let start = nodeStart(statement)
  for (const comment of parsed.comments.toSorted((left, right) => right.end - left.end)) {
    if (comment.end > start) continue
    const gap = parsed.content.slice(comment.end, start)
    if (!/^[\t ]*(?:\r?\n[\t ]*)?$/u.test(gap)) break
    start = comment.start
  }
  return start
}

function importBinding(statement: Node): ImportBinding {
  const record = statement as unknown as {
    source?: { value?: unknown }
    importKind?: unknown
    specifiers?: Array<Record<string, unknown>>
  }
  const source = typeof record.source?.value === "string" ? record.source.value : ""
  const locals = new Map<string, ImportSpecifierBinding>()
  for (const specifier of record.specifiers ?? []) {
    const local = identifierName(specifier.local)
    if (!local) continue
    const type = String(specifier.type ?? "")
    const imported = identifierName(specifier.imported) ?? local
    locals.set(local, {
      local,
      imported,
      kind: type === "ImportDefaultSpecifier" ? "default" : type === "ImportNamespaceSpecifier" ? "namespace" : "named",
      typeOnly: record.importKind === "type" || specifier.importKind === "type",
    })
  }
  return { statement, source, locals }
}

function declarationBinding(statement: Node): DeclarationBinding[] {
  const outer = statement as unknown as { declaration?: Node | null }
  const exportKind = statement.type === "ExportDefaultDeclaration"
    ? "default"
    : statement.type === "ExportNamedDeclaration"
      ? "named"
      : "none"
  const exported = exportKind !== "none"
  const declaration = exported ? outer.declaration : statement
  if (!declaration) return []
  const record = declaration as unknown as { id?: unknown; declarations?: Array<{ id?: unknown }> }
  const names = declaration.type === "VariableDeclaration"
    ? (record.declarations ?? []).flatMap((entry) => patternNames(entry.id))
    : [identifierName(record.id)].filter((name): name is string => Boolean(name))
  if (!names.length) return []
  return [{
    statement,
    declaration,
    names,
    kind: declaration.type,
    exported,
    exportKind,
    typeOnly: declaration.type === "TSInterfaceDeclaration" || declaration.type === "TSTypeAliasDeclaration",
  }]
}

function formatRequiredImport(entry: ImportBinding, required: ReadonlySet<string>): string | undefined {
  const selected = [...entry.locals.values()].filter((specifier) => required.has(specifier.local))
  if (!selected.length) return undefined
  const defaultImport = selected.find((specifier) => specifier.kind === "default")
  const namespaceImport = selected.find((specifier) => specifier.kind === "namespace")
  const named = selected.filter((specifier) => specifier.kind === "named")
  const allTypeOnly = selected.every((specifier) => specifier.typeOnly)
  const clauses: string[] = []
  if (defaultImport) clauses.push(defaultImport.local)
  if (namespaceImport) clauses.push(`* as ${namespaceImport.local}`)
  if (named.length) {
    clauses.push(`{ ${named.map((specifier) => {
      const alias = specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`
      return specifier.typeOnly && !allTypeOnly ? `type ${alias}` : alias
    }).join(", ")} }`)
  }
  return `import${allTypeOnly ? " type" : ""} ${clauses.join(", ")} from ${JSON.stringify(entry.source)}`
}

function collectIdentifierNames(root: Node): Set<string> {
  const names = new Set<string>()
  walkNodeWithParent(root, undefined, undefined, (node, parent, key) => {
    if (node.type !== "Identifier" && node.type !== "JSXIdentifier") return
    if (!isReferenceIdentifier(node, parent, key)) return
    const name = identifierName(node)
    if (name) names.add(name)
  })
  return names
}

function collectNestedBindingNames(root: Node): Set<string> {
  const names = new Set<string>()
  walkNode(root, (node) => {
    const record = node as unknown as {
      id?: unknown
      params?: unknown[]
      param?: unknown
      typeParameters?: { params?: unknown[] }
      typeParameter?: unknown
    }
    for (const parameter of record.typeParameters?.params ?? []) collectTypeParameterName(parameter, names)
    if (node.type === "TSMappedType" || node.type === "TSInferType") collectTypeParameterName(record.typeParameter, names)
    if (node.type === "VariableDeclarator") collectPatternNames(record.id, names)
    if (
      node.type === "FunctionDeclaration"
      || node.type === "FunctionExpression"
      || node.type === "ArrowFunctionExpression"
      || node.type === "TSDeclareFunction"
    ) {
      if (node !== root) collectPatternNames(record.id, names)
      for (const parameter of record.params ?? []) collectPatternNames(parameter, names)
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node !== root) collectPatternNames(record.id, names)
    }
    if (node.type === "CatchClause") collectPatternNames(record.param, names)
  })
  return names
}

function collectPatternNames(value: unknown, names: Set<string>): void {
  if (!value || typeof value !== "object") return
  const record = value as { type?: unknown; name?: unknown; left?: unknown; argument?: unknown; properties?: unknown[]; elements?: unknown[]; value?: unknown }
  if (record.type === "Identifier" && typeof record.name === "string") {
    names.add(record.name)
    return
  }
  if (record.type === "AssignmentPattern") collectPatternNames(record.left, names)
  if (record.type === "RestElement") collectPatternNames(record.argument, names)
  if (record.type === "ObjectPattern") {
    for (const property of record.properties ?? []) {
      const item = property as { type?: unknown; value?: unknown; argument?: unknown }
      collectPatternNames(item.type === "RestElement" ? item.argument : item.value, names)
    }
  }
  if (record.type === "ArrayPattern") {
    for (const element of record.elements ?? []) collectPatternNames(element, names)
  }
}

function patternNames(value: unknown): string[] {
  const names = new Set<string>()
  collectPatternNames(value, names)
  return [...names]
}

function collectTypeParameterName(value: unknown, names: Set<string>): void {
  if (!value || typeof value !== "object") return
  const record = value as { name?: unknown }
  if (typeof record.name === "string") names.add(record.name)
  else collectPatternNames(record.name, names)
}

function walkNode(node: Node, visit: (node: Node) => void): void {
  visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) walkNode(item, visit)
      }
    } else if (isNode(value)) {
      walkNode(value, visit)
    }
  }
}

function walkNodeWithParent(
  node: Node,
  parent: Node | undefined,
  key: string | undefined,
  visit: (node: Node, parent: Node | undefined, key: string | undefined) => void,
): void {
  visit(node, parent, key)
  for (const [childKey, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) walkNodeWithParent(item, node, childKey, visit)
      }
    } else if (isNode(value)) {
      walkNodeWithParent(value, node, childKey, visit)
    }
  }
}

function isReferenceIdentifier(node: Node, parent: Node | undefined, key: string | undefined): boolean {
  if (!parent) return true
  if (node.type === "JSXIdentifier") {
    if (parent.type === "JSXAttribute" && key === "name") return false
    if ((parent.type === "JSXOpeningElement" || parent.type === "JSXClosingElement") && key === "name") {
      const name = identifierName(node)
      return Boolean(name && !/^[a-z]/u.test(name))
    }
    if (parent.type === "JSXMemberExpression" && key === "property") return false
    return true
  }
  const parentRecord = parent as unknown as { computed?: unknown; shorthand?: unknown }
  if (
    key === "property"
    && parentRecord.computed !== true
    && (
      parent.type === "MemberExpression"
      || parent.type === "StaticMemberExpression"
      || parent.type === "TSQualifiedName"
    )
  ) return false
  if (
    key === "key"
    && parentRecord.computed !== true
    && (
      parent.type === "Property"
      || parent.type === "ObjectProperty"
      || parent.type === "MethodDefinition"
      || parent.type === "PropertyDefinition"
      || parent.type === "TSPropertySignature"
      || parent.type === "TSMethodSignature"
    )
  ) return false
  if (key === "label" && (parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement")) return false
  if (parent.type === "MetaProperty") return false
  return true
}

function isNode(value: unknown): value is Node {
  return Boolean(value && typeof value === "object" && "type" in value)
}

function identifierName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as { type?: unknown; name?: unknown; value?: unknown }
  if ((record.type === "Identifier" || record.type === "JSXIdentifier") && typeof record.name === "string") return record.name
  if (record.type === "Literal" && typeof record.value === "string") return record.value
  return undefined
}

function wholeLineRange(source: string, start: number, end: number): { start: number; end: number } {
  const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1
  const prefix = source.slice(lineStart, start)
  const rangeStart = /^\s*$/u.test(prefix) ? lineStart : start
  const lineEnd = source.indexOf("\n", end)
  return { start: rangeStart, end: lineEnd < 0 ? source.length : lineEnd + 1 }
}

function lineStarts(content: string): number[] {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") starts.push(index + 1)
  }
  return starts
}

function physicalLineCount(content: string): number {
  if (!content) return 0
  return content.endsWith("\n") ? lineStarts(content).length - 1 : lineStarts(content).length
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle]! <= offset) low = middle + 1
    else high = middle - 1
  }
  return high + 1
}

function nodeStart(node: Node): number {
  return typeof (node as unknown as { start?: unknown }).start === "number" ? (node as unknown as { start: number }).start : 0
}

function nodeEnd(node: Node): number {
  return typeof (node as unknown as { end?: unknown }).end === "number" ? (node as unknown as { end: number }).end : nodeStart(node)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

export function relativeSplitPath(root: string, file: string): string {
  return relative(root, file).replaceAll("\\", "/")
}
