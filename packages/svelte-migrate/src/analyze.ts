import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { join, posix, relative, resolve, sep } from "node:path"
import { parseSync } from "oxc-parser"
import type { Node, Program } from "@oxc-project/types"
import { parse as parseSvelte } from "svelte/compiler"

import packageJson from "../package.json" with { type: "json" }
import type {
  AnalyzeSvelteFrontendOptions,
  ComponentGraphEdge,
  ComponentInventoryEntry,
  FrontendDisposition,
  SourceImport,
  SourceRevision,
  StoreInventoryEntry,
  SvelteFrontendInventory,
  TauriCall,
  TauriUsageEntry,
} from "./types.js"

const IGNORED_DIRECTORIES = new Set([".git", ".svelte-kit", "node_modules", "dist", "build", "coverage"])
const RUNES = new Set(["$bindable", "$derived", "$effect", "$host", "$inspect", "$props", "$state"])
const STORE_PRIMITIVES = new Set(["derived", "get", "readable", "readonly", "toStore", "writable", ...RUNES])
const TAURI_MODULE_PREFIXES = ["@tauri-apps/", "tauri-plugin-"]

interface ScriptRegion {
  content: string
  language: string
  lineOffset: number
}

interface ParsedScript {
  imports: SourceImport[]
  exports: string[]
  calls: Array<{ name: string; node: Node }>
  runes: string[]
  storePrimitives: string[]
  props: string[]
  contexts: string[]
  subscriptions: string[]
  storageKeys: string[]
  writes: string[]
  dynamicImports: string[]
  registrations: string[]
  importBindings: ImportBinding[]
  exportBindings: ExportBinding[]
  tauriCalls: TauriCall[]
  errors: string[]
}

interface ImportBinding {
  local: string
  imported: string
  source: string
}

interface ExportBinding {
  exported: string
  local: string
  source: string | null
}

interface SvelteScriptNode {
  start: number
  content: { start: number; end: number }
}

interface SvelteAstShape {
  instance?: SvelteScriptNode | null
  module?: SvelteScriptNode | null
  fragment?: unknown
  css?: unknown
}

interface TemplateEvidence {
  features: Record<string, number>
  events: string[]
}

export async function analyzeSvelteFrontend(
  options: AnalyzeSvelteFrontendOptions,
): Promise<SvelteFrontendInventory> {
  const projectRoot = resolve(options.projectRoot)
  const sourceRootName = normalizePath(options.sourceRoot ?? "src")
  const sourceRoot = resolve(projectRoot, sourceRootName)
  const files = await walkFiles(sourceRoot)
  const sourceFiles = files.filter(isFrontendSource)
  const sourceSet = new Set(sourceFiles.map((file) => projectPath(projectRoot, file)))
  const componentFiles = sourceFiles.filter((file) => file.endsWith(".svelte") && !file.endsWith(".svelte.ts"))
  const componentSet = new Set(componentFiles.map((file) => projectPath(projectRoot, file)))
  const components: ComponentInventoryEntry[] = []
  const scriptRecords = new Map<string, ParsedScript>()

  for (const file of componentFiles) {
    const source = await readFile(file, "utf8")
    const projectFile = projectPath(projectRoot, file)
    const parseErrors: string[] = []
    let ast: SvelteAstShape | null = null
    try {
      ast = parseSvelte(source, { filename: projectFile, modern: true }) as unknown as SvelteAstShape
    } catch (error) {
      parseErrors.push(formatError(error))
    }
    const scripts = ast ? scriptRegions(source, ast) : []
    const parsedScripts = scripts.map((script) => parseScript(projectFile, script))
    const merged = mergeScripts(parsedScripts)
    parseErrors.push(...merged.errors)
    scriptRecords.set(projectFile, merged)
    const template = ast ? collectTemplateEvidence(ast.fragment) : { features: {}, events: [] }
    const componentImports = merged.imports.map((entry) => entry.source)
    const dynamicComponentImports = merged.dynamicImports
      .filter((specifier) => isPotentialComponentImport(projectFile, specifier, sourceRootName, componentSet, sourceSet))
    const classification = classify(projectFile, parseErrors, merged.tauriCalls, template.features, merged, options)
    components.push({
      file: projectFile,
      hash: hashText(source),
      disposition: classification.disposition,
      classificationSource: classification.source,
      classificationReasons: classification.reasons,
      imports: merged.imports,
      componentImports: [...new Set(componentImports)].sort(),
      dynamicComponentImports: [...new Set(dynamicComponentImports)].sort(),
      tauriCalls: merged.tauriCalls,
      runes: merged.runes,
      props: merged.props,
      events: template.events,
      contexts: merged.contexts,
      registrations: merged.registrations,
      templateFeatures: template.features,
      scriptLanguages: [...new Set(scripts.map((script) => script.language))].sort(),
      styleBlocks: ast?.css ? 1 : 0,
      parseErrors,
    })
  }

  const moduleFiles = sourceFiles.filter((file) => !componentFiles.includes(file))
  const stores: StoreInventoryEntry[] = []
  for (const file of moduleFiles) {
    const source = await readFile(file, "utf8")
    const projectFile = projectPath(projectRoot, file)
    const parsed = parseScript(projectFile, { content: source, language: languageFor(file), lineOffset: 0 })
    scriptRecords.set(projectFile, parsed)
    if (!isStoreModule(projectFile, parsed)) continue
    const classification = classify(projectFile, parsed.errors, parsed.tauriCalls, {}, parsed, options)
    stores.push({
      file: projectFile,
      hash: hashText(source),
      imports: parsed.imports,
      exports: parsed.exports,
      primitives: parsed.storePrimitives,
      subscriptions: parsed.subscriptions,
      storageKeys: parsed.storageKeys,
      writes: parsed.writes,
      tauriCalls: parsed.tauriCalls,
      disposition: classification.disposition,
      classificationReasons: classification.reasons,
      parseErrors: parsed.errors,
    })
  }


  for (const component of components) {
    component.componentImports = component.imports
      .filter((entry) => resolveImportedComponents(component.file, entry, sourceRootName, componentSet, sourceSet, scriptRecords).length > 0)
      .map((entry) => entry.source)
      .sort()
  }

  components.sort(byFile)
  stores.sort(byFile)
  const edges = buildGraph(components, sourceRootName, componentSet, sourceSet, scriptRecords)
  const graph = {
    nodes: components.map((component) => component.file),
    entries: components.map((component) => component.file).filter(isEntryComponent),
    edges,
    cycles: findGraphCycles(components.map((component) => component.file), edges),
  }
  const tauriUsage = buildTauriUsage(scriptRecords)
  const dispositions = dispositionCounts(components)
  return {
    schemaVersion: 1,
    generator: { name: "@xiranite/svelte-migrate", version: packageJson.version },
    sourceRevision: await inspectSourceRevision(projectRoot),
    sourceRoot: sourceRootName,
    summary: {
      sourceFiles: sourceFiles.length,
      components: components.length,
      stores: stores.length,
      graphEdges: edges.length,
      unresolvedComponentImports: edges.filter((edge) => edge.to === null).length,
      tauriFiles: tauriUsage.length,
      tauriCalls: tauriUsage.reduce((count, entry) => count + entry.calls.length, 0),
      dispositions,
    },
    components,
    stores,
    graph,
    tauriUsage,
  }
}

function scriptRegions(source: string, ast: SvelteAstShape): ScriptRegion[] {
  return [ast.module, ast.instance].flatMap((node) => {
    if (!node) return []
    const openingTag = source.slice(node.start, node.content.start)
    return [{
      content: source.slice(node.content.start, node.content.end),
      language: openingTag.includes("lang=\"ts\"") || openingTag.includes("lang='ts'") ? "ts" : "js",
      lineOffset: source.slice(0, node.content.start).split("\n").length - 1,
    }]
  })
}

function parseScript(file: string, region: ScriptRegion): ParsedScript {
  const errors: string[] = []
  let program: Program
  try {
    const result = parseSync(file, region.content, {
      lang: region.language === "ts" ? "ts" : "js",
      sourceType: "module",
      astType: "ts",
      preserveParens: true,
    })
    program = result.program
    errors.push(...result.errors.map((error) => error.message))
  } catch (error) {
    return emptyParsedScript([formatError(error)])
  }

  const imports = extractImports(program)
  const importedBindings = new Map<string, { source: string; imported: string }>()
  const importBindings: ImportBinding[] = []
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue
    const source = literalString((statement as unknown as { source?: Node }).source)
    if (!source) continue
    for (const specifier of (statement as unknown as { specifiers?: Node[] }).specifiers ?? []) {
      const local = identifierName((specifier as unknown as { local?: Node }).local)
      if (!local) continue
      const imported = identifierName((specifier as unknown as { imported?: Node }).imported) ?? (specifier.type === "ImportDefaultSpecifier" ? "default" : "*")
      importedBindings.set(local, { source, imported })
      importBindings.push({ local, source, imported })
    }
  }

  const calls: Array<{ name: string; node: Node }> = []
  const runes = new Set<string>()
  const storePrimitives = new Set<string>()
  const props = new Set<string>()
  const contexts = new Set<string>()
  const subscriptions = new Set<string>()
  const storageKeys = new Set<string>()
  const writes = new Set<string>()
  const dynamicImports = new Set<string>()
  const registrations = new Set<string>()
  const tauriCalls: TauriCall[] = []
  const starts = lineStarts(region.content)
  walkNode(program as unknown as Node, (node) => {
    if (node.type === "ImportExpression") {
      const specifier = literalString((node as unknown as { source?: Node }).source)
      if (specifier) dynamicImports.add(specifier)
      return
    }
    if (node.type === "VariableDeclarator") {
      const initializer = (node as unknown as { init?: Node | null }).init
      if (initializer?.type === "CallExpression" && calleeName((initializer as unknown as { callee?: Node }).callee) === "$props") {
        collectPatternNames((node as unknown as { id?: Node }).id, props)
      }
      return
    }
    if (node.type !== "CallExpression") return
    const callee = (node as unknown as { callee?: Node }).callee
    const name = calleeName(callee)
    if (!name) return
    calls.push({ name, node })
    if (RUNES.has(name)) runes.add(name)
    if (STORE_PRIMITIVES.has(name)) storePrimitives.add(name)
    if (name.endsWith(".subscribe")) subscriptions.add(name.slice(0, -".subscribe".length))
    if (name.endsWith(".set") || name.endsWith(".update")) writes.add(name.slice(0, name.lastIndexOf(".")))
    if (/^(?:getContext|hasContext|setContext)$/.test(name)) {
      const key = literalString(((node as unknown as { arguments?: Node[] }).arguments ?? [])[0])
      contexts.add(key ?? "<dynamic>")
    }
    if (/^localStorage\.(?:getItem|removeItem|setItem)$/.test(name)) {
      const key = literalString(((node as unknown as { arguments?: Node[] }).arguments ?? [])[0])
      storageKeys.add(key ?? "<dynamic>")
    }
    if (/register/i.test(name)) registrations.add(name)
    const rootName = name.split(".")[0]!
    const binding = importedBindings.get(rootName)
    if (!binding || !isTauriModule(binding.source)) return
    const arguments_ = (node as unknown as { arguments?: Node[] }).arguments ?? []
    const command = binding.imported === "invoke" || rootName === "invoke" ? literalString(arguments_[0]) ?? null : null
    tauriCalls.push({
      api: binding.imported === "*" ? name : binding.imported,
      importedFrom: binding.source,
      command,
      line: lineAt(starts, nodeStart(node)) + region.lineOffset,
    })
  })
  return {
    imports,
    exports: extractExports(program),
    calls,
    runes: [...runes].sort(),
    storePrimitives: [...storePrimitives].sort(),
    props: [...new Set([...props, ...extractLegacyProps(program)])].sort(),
    contexts: [...contexts].sort(),
    subscriptions: [...subscriptions].sort(),
    storageKeys: [...storageKeys].sort(),
    writes: [...writes].sort(),
    dynamicImports: [...dynamicImports].sort(),
    registrations: [...registrations].sort(),
    importBindings,
    exportBindings: extractExportBindings(program),
    tauriCalls: dedupeTauriCalls(tauriCalls),
    errors,
  }
}

function extractImports(program: Program): SourceImport[] {
  const imports: SourceImport[] = []
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue
    const source = literalString((statement as unknown as { source?: Node }).source)
    if (!source) continue
    const names = ((statement as unknown as { specifiers?: Node[] }).specifiers ?? []).map((specifier) => {
      const imported = identifierName((specifier as unknown as { imported?: Node }).imported)
      const local = identifierName((specifier as unknown as { local?: Node }).local)
      return imported && local && imported !== local ? `${imported} as ${local}` : local ?? imported ?? "*"
    })
    imports.push({
      source,
      names: [...new Set(names)].sort(),
      typeOnly: (statement as unknown as { importKind?: string }).importKind === "type",
    })
  }
  return imports.sort((left, right) => left.source.localeCompare(right.source))
}

function extractExports(program: Program): string[] {
  const exports = new Set<string>()
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      exports.add("default")
      continue
    }
    if (statement.type !== "ExportNamedDeclaration") continue
    const declaration = (statement as unknown as { declaration?: Node | null }).declaration
    collectDeclaredNames(declaration, exports)
    for (const specifier of (statement as unknown as { specifiers?: Node[] }).specifiers ?? []) {
      const exported = identifierName((specifier as unknown as { exported?: Node }).exported)
      if (exported) exports.add(exported)
    }
  }
  return [...exports].sort()
}

function extractLegacyProps(program: Program): string[] {
  const props = new Set<string>()
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue
    const declaration = (statement as unknown as { declaration?: Node | null }).declaration
    if (declaration?.type !== "VariableDeclaration" || (declaration as unknown as { kind?: string }).kind !== "let") continue
    for (const variable of (declaration as unknown as { declarations?: Node[] }).declarations ?? []) {
      collectPatternNames((variable as unknown as { id?: Node }).id, props)
    }
  }
  return [...props]
}

function extractExportBindings(program: Program): ExportBinding[] {
  const bindings: ExportBinding[] = []
  for (const statement of program.body) {
    if (statement.type === "ExportAllDeclaration") {
      const source = literalString((statement as unknown as { source?: Node }).source)
      if (source) bindings.push({ exported: "*", local: "*", source })
      continue
    }
    if (statement.type !== "ExportNamedDeclaration") continue
    const source = literalString((statement as unknown as { source?: Node }).source) ?? null
    for (const specifier of (statement as unknown as { specifiers?: Node[] }).specifiers ?? []) {
      const local = identifierName((specifier as unknown as { local?: Node }).local)
      const exported = identifierName((specifier as unknown as { exported?: Node }).exported)
      if (local && exported) bindings.push({ local, exported, source })
    }
  }
  return bindings
}

function collectPatternNames(node: Node | undefined, output: Set<string>): void {
  if (!node) return
  if (node.type === "Identifier") {
    const name = identifierName(node)
    if (name) output.add(name)
    return
  }
  if (node.type === "AssignmentPattern") {
    collectPatternNames((node as unknown as { left?: Node }).left, output)
    return
  }
  if (node.type === "RestElement") {
    collectPatternNames((node as unknown as { argument?: Node }).argument, output)
    return
  }
  if (node.type === "ObjectPattern") {
    for (const property of (node as unknown as { properties?: Node[] }).properties ?? []) {
      collectPatternNames((property as unknown as { value?: Node; argument?: Node }).value ?? (property as unknown as { argument?: Node }).argument, output)
    }
    return
  }
  if (node.type === "ArrayPattern") {
    for (const element of (node as unknown as { elements?: Array<Node | null> }).elements ?? []) if (element) collectPatternNames(element, output)
  }
}

function collectDeclaredNames(node: Node | null | undefined, output: Set<string>): void {
  if (!node) return
  if (node.type === "VariableDeclaration") {
    for (const declaration of (node as unknown as { declarations?: Node[] }).declarations ?? []) {
      const name = identifierName((declaration as unknown as { id?: Node }).id)
      if (name) output.add(name)
    }
    return
  }
  const name = identifierName((node as unknown as { id?: Node }).id)
  if (name) output.add(name)
}

function mergeScripts(scripts: ParsedScript[]): ParsedScript {
  return {
    imports: dedupeImports(scripts.flatMap((script) => script.imports)),
    exports: [...new Set(scripts.flatMap((script) => script.exports))].sort(),
    calls: scripts.flatMap((script) => script.calls),
    runes: [...new Set(scripts.flatMap((script) => script.runes))].sort(),
    storePrimitives: [...new Set(scripts.flatMap((script) => script.storePrimitives))].sort(),
    props: [...new Set(scripts.flatMap((script) => script.props))].sort(),
    contexts: [...new Set(scripts.flatMap((script) => script.contexts))].sort(),
    subscriptions: [...new Set(scripts.flatMap((script) => script.subscriptions))].sort(),
    storageKeys: [...new Set(scripts.flatMap((script) => script.storageKeys))].sort(),
    writes: [...new Set(scripts.flatMap((script) => script.writes))].sort(),
    dynamicImports: [...new Set(scripts.flatMap((script) => script.dynamicImports))].sort(),
    registrations: [...new Set(scripts.flatMap((script) => script.registrations))].sort(),
    importBindings: scripts.flatMap((script) => script.importBindings),
    exportBindings: scripts.flatMap((script) => script.exportBindings),
    tauriCalls: dedupeTauriCalls(scripts.flatMap((script) => script.tauriCalls)),
    errors: scripts.flatMap((script) => script.errors),
  }
}

function emptyParsedScript(errors: string[]): ParsedScript {
  return {
    imports: [],
    exports: [],
    calls: [],
    runes: [],
    storePrimitives: [],
    props: [],
    contexts: [],
    subscriptions: [],
    storageKeys: [],
    writes: [],
    dynamicImports: [],
    registrations: [],
    importBindings: [],
    exportBindings: [],
    tauriCalls: [],
    errors,
  }
}

function collectTemplateEvidence(fragment: unknown): TemplateEvidence {
  const counts = new Map<string, number>()
  const events = new Set<string>()
  walkUnknown(fragment, (value) => {
    const type = typeof value.type === "string" ? value.type : null
    if (type && ["AnimateDirective", "AttachTag", "Component", "OnDirective", "RenderTag", "SnippetBlock", "TransitionDirective", "UseDirective"].includes(type)) {
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
    if ((type === "RegularElement" || type === "Element") && typeof value.name === "string" && ["canvas", "img", "slot", "video"].includes(value.name)) {
      const key = `element:${value.name}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    if (type === "OnDirective" && typeof value.name === "string") events.add(value.name)
    if (type === "Attribute" && typeof value.name === "string" && /^on[a-z]/.test(value.name)) events.add(value.name.slice(2))
  })
  return {
    features: Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    events: [...events].sort(),
  }
}

function classify(
  file: string,
  errors: string[],
  tauriCalls: TauriCall[],
  templateFeatures: Record<string, number>,
  script: ParsedScript,
  options: AnalyzeSvelteFrontendOptions,
): { disposition: FrontendDisposition; source: "heuristic" | "config-override" | "parse-error"; reasons: string[] } {
  for (const override of options.classificationOverrides ?? []) {
    if (new RegExp(override.pattern).test(file)) {
      return { disposition: override.disposition, source: "config-override", reasons: [override.reason] }
    }
  }
  if (errors.length) return { disposition: "blocked", source: "parse-error", reasons: ["AST parse failed"] }
  const reasons: string[] = []
  if (tauriCalls.length) reasons.push("uses Tauri API and requires a host adapter")
  const manualFeatures = ["element:canvas", "AnimateDirective", "AttachTag", "TransitionDirective", "UseDirective"]
    .filter((feature) => (templateFeatures[feature] ?? 0) > 0)
  if (manualFeatures.length) reasons.push(`complex template behavior: ${manualFeatures.join(", ")}`)
  const complexRunes = script.runes.includes("$effect") && script.runes.length > 1
  if (complexRunes) reasons.push(`complex rune graph: ${script.runes.join(", ")}`)
  if (script.contexts.length) reasons.push(`Svelte context lifecycle: ${script.contexts.join(", ")}`)
  if (script.subscriptions.length || script.writes.length) {
    reasons.push(`store coordination: ${[...script.subscriptions, ...script.writes].join(", ")}`)
  }
  if (manualFeatures.length || complexRunes || script.contexts.length || script.subscriptions.length || script.writes.length) {
    return { disposition: "manual", source: "heuristic", reasons }
  }
  if (tauriCalls.length) return { disposition: "adapter-needed", source: "heuristic", reasons }
  return { disposition: "converted", source: "heuristic", reasons: ["structurally convertible; requires review"] }
}

function buildGraph(
  components: ComponentInventoryEntry[],
  sourceRoot: string,
  componentSet: Set<string>,
  sourceSet: Set<string>,
  scripts: Map<string, ParsedScript>,
): ComponentGraphEdge[] {
  const edges: ComponentGraphEdge[] = []
  for (const component of components) {
    for (const imported of component.imports) {
      const targets = resolveImportedComponents(component.file, imported, sourceRoot, componentSet, sourceSet, scripts)
      for (const target of targets) {
        edges.push({ from: component.file, to: target, specifier: imported.source, kind: "static" })
      }
    }
    for (const specifier of component.dynamicComponentImports) {
      edges.push({ from: component.file, to: resolveComponentImport(component.file, specifier, sourceRoot, componentSet) ?? null, specifier, kind: "dynamic" })
    }
  }
  return edges.sort((left, right) => `${left.from}:${left.kind}:${left.specifier}`.localeCompare(`${right.from}:${right.kind}:${right.specifier}`))
}

function resolveImportedComponents(
  file: string,
  imported: SourceImport,
  sourceRoot: string,
  componentSet: Set<string>,
  sourceSet: Set<string>,
  scripts: Map<string, ParsedScript>,
): string[] {
  const direct = resolveComponentImport(file, imported.source, sourceRoot, componentSet)
  if (direct) return [direct]
  const module = resolveModuleImport(file, imported.source, sourceRoot, sourceSet)
  if (!module) return []
  const requested = imported.names.map(importedName).filter((name) => name !== "type")
  return resolveModuleComponents(module, requested.length ? requested : ["*"], sourceRoot, componentSet, sourceSet, scripts, new Set())
}

function resolveModuleComponents(
  module: string,
  requested: string[],
  sourceRoot: string,
  componentSet: Set<string>,
  sourceSet: Set<string>,
  scripts: Map<string, ParsedScript>,
  visited: Set<string>,
): string[] {
  const visitKey = `${module}:${requested.slice().sort().join(",")}`
  if (visited.has(visitKey)) return []
  visited.add(visitKey)
  const script = scripts.get(module)
  if (!script) return []
  const output = new Set<string>()
  for (const binding of script.exportBindings) {
    if (!requested.includes("*") && binding.exported !== "*" && !requested.includes(binding.exported)) continue
    const sourceBinding = binding.source
      ? { source: binding.source, imported: binding.local }
      : script.importBindings.find((candidate) => candidate.local === binding.local)
    if (!sourceBinding) continue
    const component = resolveComponentImport(module, sourceBinding.source, sourceRoot, componentSet)
    if (component) {
      output.add(component)
      continue
    }
    const nextModule = resolveModuleImport(module, sourceBinding.source, sourceRoot, sourceSet)
    if (!nextModule) continue
    const nextRequested = binding.exported === "*" ? ["*"] : [sourceBinding.imported]
    for (const target of resolveModuleComponents(nextModule, nextRequested, sourceRoot, componentSet, sourceSet, scripts, visited)) output.add(target)
  }
  return [...output].sort()
}

function importedName(name: string): string {
  const [imported] = name.split(" as ")
  return imported ?? name
}

function findGraphCycles(nodes: string[], edges: ComponentGraphEdge[]): string[][] {
  const adjacency = new Map(nodes.map((node) => [node, [] as string[]]))
  for (const edge of edges) if (edge.to) adjacency.get(edge.from)?.push(edge.to)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const cycles = new Map<string, string[]>()
  const visit = (node: string) => {
    if (visited.has(node)) return
    visiting.add(node)
    stack.push(node)
    for (const child of adjacency.get(node) ?? []) {
      if (visiting.has(child)) {
        const cycle = stack.slice(stack.indexOf(child))
        const normalized = normalizeCycle(cycle)
        cycles.set(normalized.join(" -> "), normalized)
      } else visit(child)
    }
    stack.pop()
    visiting.delete(node)
    visited.add(node)
  }
  for (const node of nodes) visit(node)
  return [...cycles.values()].sort((left, right) => left.join(":").localeCompare(right.join(":")))
}

function normalizeCycle(cycle: string[]): string[] {
  if (!cycle.length) return cycle
  const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)])
  return rotations.sort((left, right) => left.join(":").localeCompare(right.join(":")))[0]!
}

function isEntryComponent(file: string): boolean {
  return /(?:^|\/)(?:App|CardWindow)\.svelte$|\/routes\/.*\+(?:layout|page)\.svelte$/.test(file)
}

function resolveComponentImport(file: string, specifier: string, sourceRoot: string, componentSet: Set<string>): string | undefined {
  const candidate = resolveLocalSpecifier(file, specifier, sourceRoot)
  if (!candidate) return undefined
  for (const path of [candidate, `${candidate}.svelte`, posix.join(candidate, "index.svelte")]) {
    if (componentSet.has(path)) return path
  }
  return undefined
}

function isPotentialComponentImport(
  file: string,
  specifier: string,
  sourceRoot: string,
  componentSet: Set<string>,
  sourceSet: Set<string>,
): boolean {
  if (resolveComponentImport(file, specifier, sourceRoot, componentSet)) return true
  if (resolveModuleImport(file, specifier, sourceRoot, sourceSet)) return false
  return specifier.endsWith(".svelte")
}

function resolveLocalSpecifier(file: string, specifier: string, sourceRoot: string): string | undefined {
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(file), specifier))
  if (specifier.startsWith("$lib/")) return posix.join(sourceRoot, "lib", specifier.slice("$lib/".length))
  return undefined
}

function resolveModuleImport(file: string, specifier: string, sourceRoot: string, sourceSet: Set<string>): string | undefined {
  const candidate = resolveLocalSpecifier(file, specifier, sourceRoot)
  if (!candidate) return undefined
  const withoutJsExtension = candidate.replace(/\.[cm]?js$/, "")
  const candidates = [
    candidate,
    withoutJsExtension,
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.js`,
    `${withoutJsExtension}.tsx`,
    `${withoutJsExtension}.jsx`,
    posix.join(withoutJsExtension, "index.ts"),
    posix.join(withoutJsExtension, "index.js"),
  ]
  return candidates.find((path) => sourceSet.has(path))
}

function buildTauriUsage(records: Map<string, ParsedScript>): TauriUsageEntry[] {
  const usage: TauriUsageEntry[] = []
  for (const [file, script] of records) {
    const imports = script.imports.filter((entry) => isTauriModule(entry.source))
    if (!imports.length && !script.tauriCalls.length) continue
    usage.push({ file, imports, calls: script.tauriCalls })
  }
  return usage.sort(byFile)
}

function isStoreModule(file: string, parsed: ParsedScript): boolean {
  return file.endsWith(".svelte.ts") || file.includes("/stores/") || parsed.storePrimitives.length > 0
}

function dispositionCounts(components: ComponentInventoryEntry[]): Record<FrontendDisposition, number> {
  return {
    converted: components.filter((entry) => entry.disposition === "converted").length,
    "adapter-needed": components.filter((entry) => entry.disposition === "adapter-needed").length,
    manual: components.filter((entry) => entry.disposition === "manual").length,
    replaced: components.filter((entry) => entry.disposition === "replaced").length,
    blocked: components.filter((entry) => entry.disposition === "blocked").length,
  }
}

async function inspectSourceRevision(projectRoot: string): Promise<SourceRevision> {
  try {
    const commit = (await runGit(projectRoot, ["rev-parse", "HEAD"])).toString("utf8").trim()
    const status = await runGit(projectRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."])
    if (!status.length) return { vcs: "git", commit, dirty: false, dirtyDiffHash: null }
    const [trackedDiff, untrackedOutput] = await Promise.all([
      runGit(projectRoot, ["diff", "--binary", "HEAD", "--", "."]),
      runGit(projectRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]),
    ])
    const hash = createHash("sha256").update(status).update(trackedDiff)
    for (const file of untrackedOutput.toString("utf8").split("\0").filter(Boolean).sort()) {
      hash.update(file)
      hash.update(await readFile(resolve(projectRoot, file)))
    }
    return { vcs: "git", commit, dirty: true, dirtyDiffHash: `sha256:${hash.digest("hex")}` }
  } catch {
    return { vcs: "none", commit: null, dirty: false, dirtyDiffHash: null }
  }
}

function runGit(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("git", ["-C", cwd, ...args], { encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) rejectPromise(error)
      else resolvePromise(stdout)
    })
  })
}

async function walkFiles(root: string): Promise<string[]> {
  if (!(await isDirectory(root))) return []
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) result.push(...await walkFiles(path))
    } else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}

function isFrontendSource(file: string): boolean {
  return /(?:\.svelte|\.[cm]?[jt]sx?)$/.test(file) && !/(?:\.d|\.test|\.spec)\.[cm]?[jt]sx?$/.test(file)
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

function languageFor(file: string): string {
  return /\.[cm]?tsx?$/.test(file) ? "ts" : "js"
}

function projectPath(projectRoot: string, file: string): string {
  return relative(projectRoot, file).split(sep).join("/")
}

function normalizePath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "").replace(/\/$/, "")
}

function hashText(source: string): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`
}

function isTauriModule(source: string): boolean {
  return TAURI_MODULE_PREFIXES.some((prefix) => source.startsWith(prefix))
}

function dedupeImports(imports: SourceImport[]): SourceImport[] {
  const values = new Map<string, SourceImport>()
  for (const entry of imports) values.set(`${entry.source}:${entry.typeOnly}:${entry.names.join(",")}`, entry)
  return [...values.values()].sort((left, right) => left.source.localeCompare(right.source))
}

function dedupeTauriCalls(calls: TauriCall[]): TauriCall[] {
  const values = new Map<string, TauriCall>()
  for (const call of calls) values.set(`${call.importedFrom}:${call.api}:${call.command}:${call.line}`, call)
  return [...values.values()].sort((left, right) => left.line - right.line || left.api.localeCompare(right.api))
}

function literalString(node: Node | undefined): string | undefined {
  if (!node || node.type !== "Literal") return undefined
  const value = (node as unknown as { value?: unknown }).value
  return typeof value === "string" ? value : undefined
}

function identifierName(node: Node | undefined): string | undefined {
  if (!node) return undefined
  if (node.type === "Identifier") return (node as unknown as { name?: string }).name
  if (node.type === "Literal") return literalString(node)
  return undefined
}

function calleeName(node: Node | undefined): string | undefined {
  if (!node) return undefined
  if (node.type === "Identifier") return identifierName(node)
  if (node.type !== "MemberExpression") return undefined
  const object = calleeName((node as unknown as { object?: Node }).object)
  const property = identifierName((node as unknown as { property?: Node }).property)
  return object && property ? `${object}.${property}` : undefined
}

function walkNode(node: Node, visit: (node: Node) => void): void {
  visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walkNode(child, visit)
    } else if (isNode(value)) {
      walkNode(value, visit)
    }
  }
}

function walkUnknown(value: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const child of value) walkUnknown(child, visit)
    return
  }
  const record = value as Record<string, unknown>
  visit(record)
  for (const child of Object.values(record)) walkUnknown(child, visit)
}

function isNode(value: unknown): value is Node {
  return Boolean(value && typeof value === "object" && "type" in value)
}

function nodeStart(node: Node): number {
  return typeof (node as unknown as { start?: unknown }).start === "number" ? (node as unknown as { start: number }).start : 0
}

function lineStarts(content: string): number[] {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) if (content[index] === "\n") starts.push(index + 1)
  return starts
}

function lineAt(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle]! <= offset) low = middle + 1
    else high = middle - 1
  }
  return high + 1
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function byFile<T extends { file: string }>(left: T, right: T): number {
  return left.file.localeCompare(right.file)
}
