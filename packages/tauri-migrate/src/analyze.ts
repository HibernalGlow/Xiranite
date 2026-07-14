import { parse, type SgNode } from "@ast-grep/napi"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

import type {
  AnalyzeTauriProjectOptions,
  MigrationDisposition,
  RustParameter,
  SourceLocation,
  TauriCommand,
  TauriEvent,
  TauriMigrationInventory,
} from "./types.js"
import "./languages.js"

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "target", "dist", "build"])
const DEFAULT_NATIVE_MARKERS = [
  "czkawka_core",
  "extern \"C\"",
  "std::os::",
  "std::process::Command",
  "libc::",
  "napi::",
  "windows::",
  "winapi::",
]

interface RustFunctionRecord {
  name: string
  qualifiedName: string
  modulePath: string
  file: string
  node: SgNode
  parameters: RustParameter[]
  returnType: string
  async: boolean
  annotatedCommand: boolean
  stateTypes: string[]
  usesAppHandle: boolean
  calls: string[]
  directEvents: TauriEvent[]
  nativeReasons: string[]
  location: SourceLocation
}

export async function discoverRustSourceRoots(projectRoot: string): Promise<string[]> {
  const root = resolve(projectRoot)
  const cargoFiles = await walkFiles(root, (path) => basename(path) === "Cargo.toml")
  const roots = new Set<string>()

  for (const cargoFile of cargoFiles) {
    const sourceRoot = join(dirname(cargoFile), "src")
    if (await isDirectory(sourceRoot)) roots.add(sourceRoot)
  }

  return [...roots].sort()
}

export async function analyzeTauriProject(
  options: AnalyzeTauriProjectOptions,
): Promise<TauriMigrationInventory> {
  const projectRoot = resolve(options.projectRoot)
  const sourceRoots = (options.sourceRoots?.length
    ? options.sourceRoots.map((path) => resolve(projectRoot, path))
    : await discoverRustSourceRoots(projectRoot)
  ).filter((path, index, paths) => paths.indexOf(path) === index)

  if (sourceRoots.length === 0) {
    throw new Error(`No Rust source roots found below ${projectRoot}. Pass --source explicitly.`)
  }

  const rustFiles = (
    await Promise.all(sourceRoots.map((root) => walkFiles(root, (path) => path.endsWith(".rs"))))
  ).flat()
  const nativeMarkers = [...DEFAULT_NATIVE_MARKERS, ...(options.nativeMarkers ?? [])]
  const records: RustFunctionRecord[] = []
  const registeredCommands = new Set<string>()

  for (const file of rustFiles) {
    const source = await readFile(file, "utf8")
    const tree = parse("rust", source).root()
    const sourceRoot = longestContainingRoot(file, sourceRoots)
    const modulePath = rustModulePath(file, sourceRoot)
    const nativeImports = tree
      .findAll({ rule: { kind: "use_declaration" } })
      .map((node) => ({ node, text: node.text() }))

    for (const macro of tree.findAll({ rule: { kind: "macro_invocation" } })) {
      const macroName = macro.child(0)?.text() ?? ""
      if (!macroName.endsWith("generate_handler")) continue
      const tokenTree = macro.children().find((child) => child.kind() === "token_tree")
      for (const child of tokenTree?.children() ?? []) {
        if (!child.isNamed()) continue
        const commandName = child.text().split("::").at(-1)
        if (commandName) registeredCommands.add(commandName)
      }
    }

    for (const node of tree.findAll({ rule: { kind: "function_item" } })) {
      const name = node.field("name")?.text()
      if (!name) continue
      const parameters = extractParameters(node)
      const calls = extractCalls(node)
      records.push({
        name,
        qualifiedName: modulePath === "crate" ? name : `${modulePath}::${name}`,
        modulePath,
        file,
        node,
        parameters,
        returnType: node.field("return_type")?.text() ?? "()",
        async: node.children().some(
          (child) => child.kind() === "function_modifiers" && child.text().includes("async"),
        ),
        annotatedCommand: hasTauriCommandAttribute(node),
        stateTypes: parameters
          .filter((parameter) => parameter.rustType.includes("State<"))
          .map((parameter) => parameter.rustType),
        usesAppHandle: parameters.some((parameter) => /(?:^|::)AppHandle(?:<|$)/.test(parameter.rustType)),
        calls,
        directEvents: extractEvents(node, file, projectRoot),
        nativeReasons: findNativeReasons(node, nativeImports, nativeMarkers),
        location: toLocation(node, file, projectRoot),
      })
    }
  }

  const recordsByQualifiedName = new Map(records.map((record) => [record.qualifiedName, record]))
  const recordsByName = groupBy(records, (record) => record.name)
  const annotated = records.filter((record) => record.annotatedCommand)
  const commands = annotated.map((record) => {
    const reachable = collectReachable(record, recordsByQualifiedName, recordsByName)
    const nativeReasons = [...new Set(reachable.flatMap((item) => item.nativeReasons))].sort()
    const events = dedupeEvents(reachable.flatMap((item) => item.directEvents))
    const registered = registeredCommands.has(record.name)
    const inferredDisposition: MigrationDisposition = nativeReasons.length
      ? "native-required"
      : registered
        ? "typescript-portable"
        : "manual-review"
    const configuredDisposition = options.commandOverrides?.[record.name]
    const disposition = configuredDisposition ?? inferredDisposition

    return {
      name: record.name,
      rustPath: record.qualifiedName,
      parameters: record.parameters,
      returnType: record.returnType,
      tsReturnType: rustTypeToTypeScript(unwrapResult(record.returnType)),
      async: record.async,
      registered,
      stateTypes: record.stateTypes,
      usesAppHandle: record.usesAppHandle,
      events,
      calls: [...new Set(reachable.flatMap((item) => item.calls))].sort(),
      nativeReasons,
      disposition,
      classificationSource: configuredDisposition
        ? "config-override"
        : nativeReasons.length
          ? "ast-evidence"
          : "default",
      location: record.location,
    } satisfies TauriCommand
  })

  commands.sort((left, right) => left.name.localeCompare(right.name))
  const commandNames = new Set(commands.map((command) => command.name))
  const summary = {
    "typescript-portable": commands.filter((command) => command.disposition === "typescript-portable").length,
    "native-required": commands.filter((command) => command.disposition === "native-required").length,
    "manual-review": commands.filter((command) => command.disposition === "manual-review").length,
  }

  return {
    schemaVersion: 1,
    projectRoot,
    sourceRoots,
    analyzedAt: new Date().toISOString(),
    rustFiles: rustFiles.length,
    commands,
    registeredCommands: [...registeredCommands].sort(),
    unannotatedRegistrations: [...registeredCommands]
      .filter((name) => !commandNames.has(name))
      .sort(),
    summary,
  }
}

function extractParameters(node: SgNode): RustParameter[] {
  const parametersNode = node.field("parameters")
  if (!parametersNode) return []

  return parametersNode
    .children()
    .filter((child) => child.kind() === "parameter")
    .map((parameter) => {
      const namedChildren = parameter.children().filter((child) => child.isNamed())
      const name = namedChildren.at(0)?.text() ?? "argument"
      const rustType = namedChildren.at(-1)?.text() ?? "unknown"
      const tauriInjected =
        /(?:^|::)(?:AppHandle|Window|WebviewWindow)(?:<|$)/.test(rustType) ||
        /(?:^|::)State\s*</.test(rustType)
      return {
        name,
        rustType,
        tsType: rustTypeToTypeScript(rustType),
        tauriInjected,
      }
    })
}

function hasTauriCommandAttribute(node: SgNode): boolean {
  let sibling = node.prev()
  while (sibling?.kind() === "attribute_item") {
    const attribute = sibling.find({ rule: { kind: "attribute" } })?.text().replaceAll(" ", "")
    if (attribute === "command" || attribute?.startsWith("command(") || attribute === "tauri::command" || attribute?.startsWith("tauri::command(")) {
      return true
    }
    sibling = sibling.prev()
  }
  return false
}

function extractCalls(node: SgNode): string[] {
  const calls: string[] = []
  for (const call of node.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function")?.text() ?? call.child(0)?.text()
    if (callee) calls.push(callee)
  }
  return [...new Set(calls)]
}

function extractEvents(node: SgNode, file: string, projectRoot: string): TauriEvent[] {
  const events: TauriEvent[] = []
  for (const call of node.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function")
    if (callee?.kind() !== "field_expression" || !callee.text().endsWith(".emit")) continue
    const argumentsNode = call.field("arguments")
    const expression = argumentsNode?.children().find((child) => child.isNamed())
    const literal = expression?.kind() === "string_literal" ? unquoteRustString(expression.text()) : null
    events.push({
      name: literal,
      expression: expression?.text() ?? "unknown",
      location: toLocation(call, file, projectRoot),
    })
  }
  return events
}

function findNativeReasons(
  functionNode: SgNode,
  imports: Array<{ node: SgNode; text: string }>,
  markers: string[],
): string[] {
  const bodyText = functionNode.text()
  const identifiers = new Set(
    functionNode.findAll({ rule: { kind: "identifier" } }).map((node) => node.text()),
  )
  const reasons: string[] = []

  for (const marker of markers) {
    if (bodyText.includes(marker)) {
      reasons.push(marker)
      continue
    }
    for (const imported of imports) {
      if (!imported.text.includes(marker)) continue
      if (imported.text.includes("::*")) {
        reasons.push(marker)
        break
      }
      const importedIdentifiers = imported.node
        .findAll({ rule: { kind: "identifier" } })
        .map((node) => node.text())
      if (importedIdentifiers.some((identifier) => identifiers.has(identifier))) {
        reasons.push(marker)
        break
      }
    }
  }
  return reasons
}

function collectReachable(
  start: RustFunctionRecord,
  byQualifiedName: Map<string, RustFunctionRecord>,
  byName: Map<string, RustFunctionRecord[]>,
): RustFunctionRecord[] {
  const visited = new Set<string>()
  const result: RustFunctionRecord[] = []
  const queue = [start]

  while (queue.length) {
    const current = queue.shift()!
    if (visited.has(current.qualifiedName)) continue
    visited.add(current.qualifiedName)
    result.push(current)
    for (const call of current.calls) {
      const target = resolveCall(call, current.modulePath, byQualifiedName, byName)
      if (target && !visited.has(target.qualifiedName)) queue.push(target)
    }
  }
  return result
}

function resolveCall(
  call: string,
  modulePath: string,
  byQualifiedName: Map<string, RustFunctionRecord>,
  byName: Map<string, RustFunctionRecord[]>,
): RustFunctionRecord | undefined {
  if (call.includes(".") || call.includes("(") || call.includes("<")) return undefined
  let normalized = call.replace(/^crate::/, "").replace(/^self::/, `${modulePath}::`)
  if (normalized.startsWith("super::")) {
    const parent = modulePath.split("::").slice(0, -1).join("::") || "crate"
    normalized = `${parent}::${normalized.slice("super::".length)}`
  }
  const localName = modulePath === "crate" ? normalized : `${modulePath}::${normalized}`
  const direct = byQualifiedName.get(normalized) ?? byQualifiedName.get(localName)
  if (direct) return direct
  const leaf = normalized.split("::").at(-1)!
  const candidates = byName.get(leaf) ?? []
  return candidates.length === 1 ? candidates[0] : undefined
}

function rustTypeToTypeScript(input: string): string {
  const type = input.trim()
  if (type === "()") return "void"
  if (/^(?:&\s*)?(?:str|String|Path|PathBuf)$/.test(type)) return "string"
  if (type === "bool") return "boolean"
  if (/^(?:u|i)(?:8|16|32|64|128|size)$/.test(type) || /^(?:f32|f64)$/.test(type)) return "number"
  if (type === "serde_json::Value" || type === "Value") return "unknown"

  const option = genericArguments(type, "Option")
  if (option) return `${rustTypeToTypeScript(option[0] ?? "unknown")} | null`
  const vector = genericArguments(type, "Vec")
  if (vector) return `Array<${rustTypeToTypeScript(vector[0] ?? "unknown")}>`
  const result = genericArguments(type, "Result")
  if (result) return rustTypeToTypeScript(result[0] ?? "unknown")
  const map = genericArguments(type, "HashMap")
  if (map) return `Record<${rustTypeToTypeScript(map[0] ?? "string")}, ${rustTypeToTypeScript(map[1] ?? "unknown")}>`
  const tuple = splitTopLevel(type.slice(1, -1))
  if (type.startsWith("(") && type.endsWith(")") && tuple.length > 1) {
    return `[${tuple.map(rustTypeToTypeScript).join(", ")}]`
  }
  return "unknown"
}

function unwrapResult(type: string): string {
  return genericArguments(type, "Result")?.[0] ?? type
}

function genericArguments(type: string, name: string): string[] | null {
  const prefix = `${name}<`
  const qualifiedPrefix = `::${name}<`
  const index = type.startsWith(prefix) ? 0 : type.lastIndexOf(qualifiedPrefix)
  if (index < 0 || !type.endsWith(">")) return null
  const start = index === 0 ? prefix.length : index + qualifiedPrefix.length
  return splitTopLevel(type.slice(start, -1))
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === "<" || character === "(" || character === "[") depth += 1
    if (character === ">" || character === ")" || character === "]") depth -= 1
    if (character === "," && depth === 0) {
      parts.push(input.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(input.slice(start).trim())
  return parts.filter(Boolean)
}

function rustModulePath(file: string, sourceRoot: string): string {
  const relativeFile = relative(sourceRoot, file).split(sep).join("/").replace(/\.rs$/, "")
  if (relativeFile === "main" || relativeFile === "lib") return "crate"
  return relativeFile.replace(/\/(?:mod)$/, "").replaceAll("/", "::")
}

function longestContainingRoot(file: string, roots: string[]): string {
  return roots
    .filter((root) => relative(root, file).split(sep)[0] !== "..")
    .sort((left, right) => right.length - left.length)[0]!
}

function toLocation(node: SgNode, file: string, projectRoot: string): SourceLocation {
  const start = node.range().start
  return {
    file: relative(projectRoot, file).split(sep).join("/"),
    line: start.line + 1,
    column: start.column + 1,
  }
}

function unquoteRustString(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1)
  return value
}

function dedupeEvents(events: TauriEvent[]): TauriEvent[] {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = `${event.name ?? event.expression}:${event.location.file}:${event.location.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const item of items) {
    const value = key(item)
    result.set(value, [...(result.get(value) ?? []), item])
  }
  return result
}

async function walkFiles(root: string, predicate: (path: string) => boolean): Promise<string[]> {
  if (!(await isDirectory(root))) return []
  const result: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) result.push(...(await walkFiles(path, predicate)))
    } else if (entry.isFile() && predicate(path)) {
      result.push(path)
    }
  }
  return result
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
