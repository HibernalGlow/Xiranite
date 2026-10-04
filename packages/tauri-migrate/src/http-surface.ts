/**
 * HTTP/Operation protocol surface inventory, produced from the syntax tree (ADR-0067 gate 2).
 *
 * The rewrite keeps the wire protocol: "the React layer does not change" and "HTTP transfers without
 * shrinkage" are only claims if something mechanical lists every route, DTO field and NDJSON event
 * discriminator on both sides and diffs them. Hand-written route lists drift, and a Rust router that
 * silently omits `?cursor=` or one event field still "works" until a card requests it.
 */
import { parse, type SgNode } from "@ast-grep/napi"
import { execFile } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

import packageJson from "../package.json" with { type: "json" }
import "./languages.js"

/** HTTP methods Elysia exposes as chainable calls, plus the grouping helpers. */
const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "all", "head", "options"] as const
const GROUP_METHODS = ["route", "group", "use", "merge", "mount"] as const
const EVENT_PROPERTIES = new Set(["kind", "type", "event"])
const HANDLER_CONTEXT_KEYS = /^(body|query|params|headers|cookie|set|status|request|store|redirect)$/

export type SurfaceSide = "legacy" | "rust"

export interface HttpRouteRecord {
  /** Lowercase HTTP method, or `group` for a prefix declaration. */
  method: string
  /** Path literal as declared; `/nodes/:id` style parameters are kept verbatim. */
  path: string
  file: string
  line: number
  /** Handler-context properties the route destructures, i.e. which request parts it consumes. */
  context: string[]
}

export interface DtoFieldRecord {
  symbol: string
  field: string
  optional: boolean
  file: string
  line: number
}

export interface NdjsonEventRecord {
  /** Discriminator property, usually `kind` or `type`. */
  property: string
  value: string
  symbol: string
  file: string
  line: number
}

export interface HttpSurfaceInventory {
  schemaVersion: 1
  generator: { name: string; version: string }
  side: SurfaceSide
  repoRoot: string
  analyzedAt: string
  revision: string
  /** Roots that were scanned, so an empty result reads as a wrong path, not a clean diff. */
  scannedRoots: string[]
  routes: HttpRouteRecord[]
  groups: HttpRouteRecord[]
  dtoFields: DtoFieldRecord[]
  events: NdjsonEventRecord[]
  summary: { routes: number; groups: number; dtoFields: number; events: number }
}

export interface AnalyzeHttpSurfaceOptions {
  repoRoot: string
  side: SurfaceSide
  roots?: string[]
}

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "artifacts", "vendor", "ref"])

export async function analyzeHttpSurface(
  options: AnalyzeHttpSurfaceOptions,
): Promise<HttpSurfaceInventory> {
  const repoRoot = resolve(options.repoRoot)
  const roots = (options.roots?.length
    ? options.roots
    : options.side === "legacy"
      ? ["packages/api/src", "packages/backend/src", "packages/contract/src", "packages/shared/src"]
      : ["crates/xiranite-api/src", "crates/xiranite-core/src", "crates/xiranite-plugins/src"]
  ).map((path) => join(repoRoot, path))

  const scannedRoots: string[] = []
  const sources: string[] = []
  const accepts = options.side === "legacy"
    ? (path: string) => /\.(ts|tsx)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path)
    : (path: string) => path.endsWith(".rs") && !/\/tests\//.test(path)
  for (const root of roots) {
    if (!(await isDirectory(root))) continue
    scannedRoots.push(relative(repoRoot, root))
    sources.push(...await walkFiles(root, accepts))
  }
  if (scannedRoots.length === 0) {
    throw new Error(`None of the configured HTTP surface roots exist below ${repoRoot}: ${roots.join(", ")}`)
  }
  if (sources.length === 0) {
    throw new Error(`The ${options.side} HTTP surface scanned ${scannedRoots.join(", ")} but found no source files.`)
  }

  const routes: HttpRouteRecord[] = []
  const groups: HttpRouteRecord[] = []
  const dtoFields: DtoFieldRecord[] = []
  const events: NdjsonEventRecord[] = []

  for (const file of sources.sort()) {
    const text = await readFile(file, "utf8")
    const shown = relative(repoRoot, file)

    if (options.side === "rust") {
      const rustRoot = parse("rust", text).root()
      const rustRecords = readRustRoutes(rustRoot, shown)
      routes.push(...rustRecords.filter((record) => record.method !== "group"))
      groups.push(...rustRecords.filter((record) => record.method === "group"))
      dtoFields.push(...readRustDtoFields(rustRoot, shown))
      events.push(...readRustEvents(rustRoot, shown))
      continue
    }

    const root = parse(file.endsWith("tsx") ? "tsx" : "typescript", text).root()
    const contractFile = /^packages\/(contract|shared)\//.test(shown) || /^crates\//.test(shown)

    for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
      const record = readRouteCall(call, shown)
      if (!record) continue
      if (record.method === "group") groups.push(record)
      else routes.push(record)
    }
    for (const pair of root.findAll({ rule: { kind: "pair" } })) {
      const record = readElysiaPrefix(pair, shown)
      if (record) groups.push(record)
    }
    if (contractFile) {
      dtoFields.push(...readInterfaceFields(root, shown))
      dtoFields.push(...readSchemaFields(root, shown))
      events.push(...readEventDiscriminators(root, shown))
      events.push(...readSchemaEvents(root, shown))
    }
  }

  const dedupe = <T>(items: T[], key: (item: T) => string): T[] => {
    const seen = new Set<string>()
    return items.filter((item) => !seen.has(key(item)) && (seen.add(key(item)), true))
  }
  const uniqueRoutes = dedupe(routes, (item) => `${item.method} ${item.path}`)
  const uniqueGroups = dedupe(groups, (item) => item.path)
  const uniqueFields = dedupe(dtoFields, (item) => `${item.symbol}.${item.field}`)
  const uniqueEvents = dedupe(events, (item) => `${item.symbol} ${item.property}=${item.value}`)

  return {
    schemaVersion: 1,
    generator: { name: packageJson.name, version: packageJson.version },
    side: options.side,
    repoRoot,
    analyzedAt: new Date().toISOString(),
    revision: await gitRevision(repoRoot),
    scannedRoots,
    routes: uniqueRoutes.sort(compareRoutes),
    groups: uniqueGroups.sort((left, right) => left.path.localeCompare(right.path)),
    dtoFields: uniqueFields.sort((left, right) => left.symbol.localeCompare(right.symbol) || left.field.localeCompare(right.field)),
    events: uniqueEvents.sort((left, right) => left.symbol.localeCompare(right.symbol) || left.value.localeCompare(right.value)),
    summary: {
      routes: uniqueRoutes.length,
      groups: uniqueGroups.length,
      dtoFields: uniqueFields.length,
      events: uniqueEvents.length,
    },
  }
}

/** Bidirectional diff: routes the old protocol had and the new one lacks, plus anything invented. */
export function diffHttpSurfaces(legacy: HttpSurfaceInventory, rust: HttpSurfaceInventory): string[] {
  const problems: string[] = []

  const legacyKeys = new Set(legacy.routes.map((route) => `${route.method} ${route.path}`))
  const rustKeys = new Set(rust.routes.map((route) => `${route.method} ${route.path}`))
  for (const key of legacyKeys) if (!rustKeys.has(key)) problems.push(`route missing in the Rust side: ${key}`)
  for (const key of rustKeys) if (!legacyKeys.has(key)) problems.push(`route only exists in the Rust side: ${key}`)

  for (const group of legacy.groups) {
    if (!rust.groups.some((item) => item.path === group.path)) problems.push(`prefix missing in the Rust side: ${group.path}`)
  }
  for (const field of legacy.dtoFields) {
    if (!rust.dtoFields.some((item) => item.symbol === field.symbol && item.field === field.field)) {
      problems.push(`DTO field missing in the Rust side: ${field.symbol}.${field.field}`)
    }
  }
  for (const event of legacy.events) {
    if (!rust.events.some((item) => item.symbol === event.symbol && item.property === event.property && item.value === event.value)) {
      problems.push(`NDJSON event discriminator missing in the Rust side: ${event.symbol} ${event.property}=${event.value}`)
    }
  }
  return problems.sort()
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed())
}

function readRouteCall(call: SgNode, file: string): HttpRouteRecord | null {
  const callee = call.field("function")
  if (!callee || callee.kind() !== "member_expression") return null
  const method = callee.field("property")?.text()
  if (!method) return null
  const isRoute = (ROUTE_METHODS as readonly string[]).includes(method)
  const isGroup = (GROUP_METHODS as readonly string[]).includes(method)
  if (!isRoute && !isGroup) return null

  const argumentNodes = call.field("arguments")
  if (!argumentNodes) return null
  const args = namedChildren(argumentNodes).filter((node) => node.kind() !== "comment")
  const first = args[0]
  if (!first || first.kind() !== "string") return null
  const path = first.text().slice(1, -1)
  if (!path.startsWith("/")) return null

  return {
    method: isGroup ? "group" : method,
    path,
    file,
    line: call.range().start.line + 1,
    context: [...new Set(args.slice(1).flatMap(readContextKeys))].sort(),
  }
}

function readContextKeys(node: SgNode): string[] {
  if (node.kind() !== "arrow_function" && node.kind() !== "function_expression") return []
  const parameters = node.field("parameters")
  // TS wraps the destructuring in `required_parameter`, so the object pattern is a grandchild.
  const pattern = parameters?.find({ rule: { kind: "object_pattern" } })
  if (!pattern) return []
  return namedChildren(pattern).flatMap((field) => {
    const text = field.text()
    const name = field.kind() === "pair_pattern" ? (field.field("key")?.text() ?? text) : text
    return HANDLER_CONTEXT_KEYS.test(name) ? [name] : []
  })
}

function readElysiaPrefix(pair: SgNode, file: string): HttpRouteRecord | null {
  if (pair.field("key")?.text() !== "prefix") return null
  const value = pair.field("value")
  if (!value || value.kind() !== "string") return null
  const path = value.text().slice(1, -1)
  if (!path.startsWith("/")) return null
  return { method: "group", path, file, line: pair.range().start.line + 1, context: [] }
}

function readInterfaceFields(root: SgNode, file: string): DtoFieldRecord[] {
  const records: DtoFieldRecord[] = []
  for (const declaration of root.findAll({ rule: { kind: "interface_declaration" } })) {
    const symbol = declaration.field("name")?.text()
    const body = declaration.field("body")
    if (!symbol || !body) continue
    for (const field of namedChildren(body)) {
      if (field.kind() !== "property_signature" && field.kind() !== "field_definition") continue
      const name = field.field("name")?.text() ?? field.child(0)?.text() ?? ""
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue
      records.push({
        symbol,
        field: name,
        optional: field.text().startsWith(`${name}?`) || field.text().includes(`${name}?`),
        file,
        line: field.range().start.line + 1,
      })
    }
  }
  return records
}

function readEventDiscriminators(root: SgNode, file: string): NdjsonEventRecord[] {
  const records: NdjsonEventRecord[] = []
  const declarations = [
    ...root.findAll({ rule: { kind: "interface_declaration" } }),
    ...root.findAll({ rule: { kind: "type_alias_declaration" } }),
  ]
  for (const declaration of declarations) {
    const symbol = declaration.field("name")?.text()
    if (!symbol) continue
    for (const pair of declaration.findAll({ rule: { kind: "pair" } })) {
      const property = pair.field("key")?.text().replace(/^["']|["']$/g, "")
      if (!property || !EVENT_PROPERTIES.has(property)) continue
      const value = pair.field("value")
      const literal = value?.kind() === "string" ? value.text().slice(1, -1) : null
      if (!literal) continue
      records.push({ property, value: literal, symbol, file, line: pair.range().start.line + 1 })
    }
  }
  return records
}

/**
 * Most wire shapes in this repo are zod schemas whose DTO type is `z.infer<...>`, so an interface-only
 * reader reports zero events and a Rust side missing every event would diff clean. These two readers
 * walk `z.object({ ... })` inside each schema constant: every key is a wire field, and a key whose value
 * is `z.literal("...")` under `kind`/`type`/`event` is an NDJSON discriminator.
 */
function eachSchemaObject(root: SgNode): Array<{ symbol: string; pairs: SgNode[]; node: SgNode }> {
  const found: Array<{ symbol: string; pairs: SgNode[]; node: SgNode }> = []
  for (const declarator of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const symbol = declarator.field("name")?.text()
    if (!symbol) continue
    for (const call of declarator.findAll({ rule: { kind: "call_expression" } })) {
      if (call.field("function")?.text() !== "z.object") continue
      const argument = namedChildren(call.field("arguments") ?? call).find((node) => node.kind() === "object")
      if (!argument) continue
      found.push({ symbol, pairs: namedChildren(argument).filter((node) => node.kind() === "pair"), node: call })
    }
  }
  return found
}

function readSchemaFields(root: SgNode, file: string): DtoFieldRecord[] {
  return eachSchemaObject(root).flatMap(({ symbol, pairs }) => pairs.map((pair) => {
    const name = pair.field("key")?.text().replace(/^["']|["']$/g, "") ?? ""
    return {
      symbol,
      field: name,
      optional: pair.text().includes(".optional()") || pair.text().includes(".nullish()"),
      file,
      line: pair.range().start.line + 1,
    }
  })).filter((record) => /^[A-Za-z_$][\w$]*$/.test(record.field))
}

function readSchemaEvents(root: SgNode, file: string): NdjsonEventRecord[] {
  const records: NdjsonEventRecord[] = []
  for (const { symbol, pairs } of eachSchemaObject(root)) {
    for (const pair of pairs) {
      const property = pair.field("key")?.text().replace(/^["']|["']$/g, "") ?? ""
      if (!EVENT_PROPERTIES.has(property)) continue
      const value = pair.field("value")?.text() ?? ""
      const literal = /^z\.literal\(\s*(['"`])([^'"`]*)\1/.exec(value)?.[2]
      if (literal) {
        records.push({ property, value: literal, symbol, file, line: pair.range().start.line + 1 })
        continue
      }
      // `type: z.enum(["progress", "log"])` is the real run-event discriminator in this repo, so an
      // enum-only reader would report zero events and every missing event would diff clean.
      const enumeration = /^z\.enum\(\s*\[([^\]]*)\]/.exec(value)?.[1]
      if (!enumeration) continue
      for (const member of enumeration.split(",")) {
        const name = /^\s*(['"`])([^'"`]*)\1\s*$/.exec(member)?.[2]
        if (!name) continue
        records.push({ property, value: name, symbol, file, line: pair.range().start.line + 1 })
      }
    }
  }
  return records
}

/**
 * Rust side of the same protocol. The rewrite promises the Axum backend serves the existing surface, and
 * the only way to know is to read the routes and wire types out of the crate the same way the legacy side
 * is read out of Elysia. Node kinds were confirmed by walking the parsed tree, not guessed: a method call
 * is `call_expression` over a `field_expression` whose `field_identifier` is `route`/`nest`, structs are
 * `struct_item` with `field_declaration_list`, and enums are `enum_item` with `enum_variant_list`.
 */
const AXUM_METHOD_ORDERS = ["get", "post", "put", "patch", "delete", "head", "options"] as const
const RUST_EXTRACTOR_CONTEXTS: Record<string, string> = { Query: "query", Json: "body", Path: "params", Form: "body", Headers: "headers" }

function readRustRoutes(root: SgNode, file: string): HttpRouteRecord[] {
  const contexts = rustHandlerContexts(root)
  const records: HttpRouteRecord[] = []

  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function")
    if (!callee || callee.kind() !== "field_expression") continue
    const method = callee.children().find((child) => child.kind() === "field_identifier")?.text()
    if (method !== "route" && method !== "nest" && method !== "with") continue
    const argumentNode = call.field("arguments")
    if (!argumentNode) continue
    const args = namedChildren(argumentNode).filter((node) => node.kind() !== "comment")
    const pathNode = args[0]
    if (!pathNode || pathNode.kind() !== "string_literal") continue
    const path = pathNode.text().slice(1, -1)
    if (!path.startsWith("/")) continue

    if (method === "nest") {
      records.push({ method: "group", path, file, line: call.range().start.line + 1, context: [] })
      continue
    }

    // Axum spells the pair get(list): the method order is the call and the handler is its identifier
    // argument, so a textual name-followed-by-paren scan finds only the order, never the handler.
    const orders = new Set<string>()
    const handlers: string[] = []
    for (const node of args.slice(1)) {
      for (const inner of node.findAll({ rule: { kind: "call_expression" } })) {
        const callee = inner.field("function")
        // get(handler) is a plain call; a chained .delete(handler) is a method call on the
        // MethodRouter returned by the previous order, so both shapes must be recognised.
        const orderName = callee?.kind() === "identifier"
          ? callee.text()
          : callee?.kind() === "field_expression"
            ? callee.children().find((child) => child.kind() === "field_identifier")?.text()
            : undefined
        if (!orderName || !(AXUM_METHOD_ORDERS as readonly string[]).includes(orderName)) continue
        orders.add(orderName)
        const innerArgs = inner.field("arguments")
        if (!innerArgs) continue
        for (const handler of namedChildren(innerArgs)) {
          if (handler.kind() === "identifier") handlers.push(handler.text())
        }
      }
    }
    const context = [...new Set(handlers.flatMap((handler) => contexts.get(handler) ?? []))].sort()
    for (const order of orders) {
      records.push({ method: order, path, file, line: call.range().start.line + 1, context })
    }
  }

  return records
}

/** Which request parts each handler consumes, read from its extractor parameter types. */
function rustHandlerContexts(root: SgNode): Map<string, string[]> {
  const contexts = new Map<string, string[]>()
  for (const item of root.findAll({ rule: { kind: "function_item" } })) {
    const name = item.child(0)?.kind() === "function_modifiers"
      ? item.children().find((child) => child.kind() === "identifier")?.text()
      : item.field("name")?.text()
    if (!name) continue
    const parameters = item.field("parameters")
    if (!parameters) continue
    const found: string[] = []
    for (const parameter of parameters.children().filter((child) => child.kind() === "parameter")) {
      const extractor = parameter.children().find((child) => child.kind() === "tuple_struct_pattern")
        ?.children().find((child) => child.kind() === "identifier")?.text()
      const mapped = extractor ? RUST_EXTRACTOR_CONTEXTS[extractor] : undefined
      if (mapped) found.push(mapped)
    }
    if (found.length > 0) contexts.set(name, [...new Set(found)].sort())
  }
  return contexts
}

/**
 * Rust attributes are siblings of the item they decorate, not children: the parse tree puts
 * #[derive] / #[serde(rename_all)] in the source list before the struct_item, and a variant attribute
 * in the enum_variant_list before the enum_variant. Reading them off the item itself silently returns
 * nothing, so field names never get their wire case and the diff would report every camelCase DTO field
 * as missing. These helpers collect the preceding attribute text instead.
 */
interface RustAnnotatedItem { node: SgNode; attributes: string }

function collectAnnotatedItems(container: SgNode, kinds: string[]): RustAnnotatedItem[] {
  const items: RustAnnotatedItem[] = []
  let pending: string[] = []
  for (const child of container.children()) {
    const kind = child.kind()
    if (kind === "attribute_item") { pending.push(child.text()); continue }
    if (kinds.includes(kind as string)) items.push({ node: child, attributes: pending.join("\n") })
    if (kind !== "line_comment" && kind !== "block_comment") pending = []
  }
  return items
}

function serdeAttributeFrom(attributes: string, key: string): string | null {
  if (!attributes.includes("serde")) return null
  // The key can sit right after `serde(` with no space, so a leading \s would miss the first entry.
  return new RegExp(`\\b${key}\\s*=\\s*"([^"]+)"`).exec(attributes)?.[1] ?? null
}

function readRustDtoFields(root: SgNode, file: string): DtoFieldRecord[] {
  const records: DtoFieldRecord[] = []
  for (const { node: item, attributes } of collectAnnotatedItems(root, ["struct_item"])) {
    const symbol = item.children().find((child) => child.kind() === "type_identifier")?.text()
    const body = item.children().find((child) => child.kind() === "field_declaration_list")
    if (!symbol || !body) continue
    const renameAll = serdeAttributeFrom(attributes, "rename_all")
    for (const field of body.children().filter((child) => child.kind() === "field_declaration")) {
      // Only pub fields are serialized, so private ones are implementation detail, not protocol.
      if (!field.children().some((child) => child.kind() === "visibility_modifier")) continue
      const name = field.children().find((child) => child.kind() === "field_identifier")?.text()
      if (!name) continue
      const typeNode = field.children().find((child) => (RUST_TYPE_KINDS as readonly string[]).includes(child.kind() as string))
      records.push({
        symbol,
        field: renameAll ? applyRenameCase(name, renameAll) : name,
        optional: /^Option</.test(typeNode?.text() ?? ""),
        file,
        line: field.range().start.line + 1,
      })
    }
  }
  return records
}

function readRustEvents(root: SgNode, file: string): NdjsonEventRecord[] {
  const records: NdjsonEventRecord[] = []
  for (const { node: item, attributes } of collectAnnotatedItems(root, ["enum_item"])) {
    const property = serdeAttributeFrom(attributes, "tag")
    if (!property || !EVENT_PROPERTIES.has(property)) continue
    const symbol = item.children().find((child) => child.kind() === "type_identifier")?.text()
    const body = item.children().find((child) => child.kind() === "enum_variant_list")
    if (!symbol || !body) continue
    const renameAll = serdeAttributeFrom(attributes, "rename_all")
    for (const { node: variant, attributes: variantAttributes } of collectAnnotatedItems(body, ["enum_variant"])) {
      const name = variant.children().find((child) => child.kind() === "identifier")?.text()
      if (!name) continue
      const value = serdeAttributeFrom(variantAttributes, "rename")
        ?? (renameAll ? applyRenameCase(snakeCase(name), renameAll) : snakeCase(name))
      records.push({ property, value, symbol, file, line: variant.range().start.line + 1 })
    }
  }
  return records
}

const RUST_TYPE_KINDS = ["generic_type", "type_identifier", "primitive_type", "reference_type"] as const

/** `Progress` -> `progress`, the baseline serde derives a wire name from. */
function snakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
}

/** Applies the `rename_all` rule serde would apply, so Rust field names compare to the TS wire names. */
function applyRenameCase(snakeName: string, rule: string): string {
  const parts = snakeName.split(/[_-]/).filter(Boolean)
  switch (rule) {
    case "camelCase":
      return parts.map((part, index) => (index === 0 ? part : part[0]!.toUpperCase() + part.slice(1))).join("")
    case "PascalCase":
      return parts.map((part) => part[0]!.toUpperCase() + part.slice(1)).join("")
    case "kebab-case":
      return parts.join("-")
    case "SCREAMING_SNAKE_CASE":
      return parts.join("_").toUpperCase()
    case "snake_case":
      return parts.join("_").toLowerCase()
    default:
      return snakeName
  }
}

function compareRoutes(left: HttpRouteRecord, right: HttpRouteRecord): number {
  return left.method.localeCompare(right.method) || left.path.localeCompare(right.path)
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false
}

async function walkFiles(root: string, accept: (path: string) => boolean): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      found.push(...await walkFiles(join(root, entry.name), accept))
      continue
    }
    const path = join(root, entry.name)
    if (accept(path)) found.push(path)
  }
  return found
}

function gitRevision(repoRoot: string): Promise<string> {
  return new Promise((resolveRevision) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: repoRoot }, (error, stdout) => {
      resolveRevision(error ? "unknown" : stdout.trim())
    })
  })
}
