/**
 * Inventory of every retained node's legacy CLI surface, as the acceptance checklist for its clap port.
 *
 * Why this is read from the syntax tree instead of by running the CLI (ADR-0067): a node's own entry
 * intercepts `--help` and renders the help card, so the per-subcommand flags are never printed by the running
 * program — measured on `trename`: `--help` and `scan --help` produce the identical help card, and only an
 * unknown flag falls through to the parser's command table. Probing with an unknown flag to get that table is
 * also a command-execution risk on nodes whose root program accepts it, which a read-only inventory must not
 * be. `defineCommand` / `subCommands` / `args` are therefore the fact, and this gate keeps that fact from
 * rotting when the legacy layer is deleted.
 *
 * `bun run audit:node-cli-surface` compares the live inventory with `docs/node-cli-surface-baseline.json`;
 * `bun run migrate:node-cli-surface` rewrites the baseline after a deliberate change.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { parse, type SgNode } from "@ast-grep/napi"

import { nodeCliName } from "@xiranite/cli-runtime"

export interface CliCommand {
  /** Path from the root command, e.g. `history clear`. */
  name: string
  description: string | null
  /** Flag names in declaration order, without the leading `--`. */
  flags: string[]
  /** `inline` when `args` is an object literal, else the helper that supplies the flags. */
  argsFrom: string
}

export interface NodeCliSurface {
  nodeId: string
  file: string
  /** What the legacy CLI calls itself (`xtrename`), or `null` when the name is not a resolvable literal. */
  program: string | null
  /** How `program` was obtained, so an unresolved one is visible instead of looking like a real name. */
  programFrom: string
  /**
   * How the file declares its surface, measured over the 40 inventoried nodes: 22 `citty` command trees,
   * 15 `interaction-driven` (they hand the node's interaction definition to the shared `runInteractionCli`,
   * so the definition is already the flag list), 1 `parseArgs`, 2 `none` — `bitv` compares flag strings by hand
   * and `findz` is GUI-only (`FINDZ_GUI_ONLY_HELP`), which is why `none` is disclosed rather than failed.
   */
  style: string
  commands: CliCommand[]
  /**
   * Every `--flag` string literal in the file, sorted. Supplementary: a hand-rolled parser compares literals
   * instead of declaring a schema, so this is the only way to see its surface — and it can also contain flags
   * the file merely mentions. The port checklist uses it as a lead, never as proof.
   */
  flagLiterals: string[]
}

export interface CliSurfaceDrift {
  nodeId: string
  added: string[]
  removed: string[]
}

export interface CliSurfaceOptions {
  nodesRoot: string
  manifestPath: string
  baselinePath: string
}

interface PropMap {
  get: (key: string) => SgNode | undefined
  has: (key: string) => boolean
  entries: () => [string, SgNode][]
}

function properties(object: SgNode): PropMap {
  const map = new Map<string, SgNode>()
  for (const pair of object.children().filter((child) => child.kind() === "pair")) {
    const key = pair.field("key")
    const value = pair.field("value")
    if (key && value) map.set(key.text().replace(/^["']|["']$/g, ""), value)
  }
  return { get: (key) => map.get(key), has: (key) => map.has(key), entries: () => [...map.entries()] }
}

/**
 * The callee of a call expression.
 *
 * This `@ast-grep/napi` binding exposes no `callee` field on `call_expression` (measured: `field("callee")`
 * is `undefined`), while `field("arguments")` does exist, so the callee is the first child node.
 */
function calleeText(node: SgNode): string {
  return node.children()[0]?.text() ?? ""
}

const isDefineCommand = (node: SgNode): boolean => calleeText(node) === "defineCommand"

/** The object literal argument of a `defineCommand({ … })` call, or the object itself when inlined. */
function commandOptions(node: SgNode): SgNode | null {
  if (node.kind() === "object") return node
  if (node.kind() !== "call_expression" || !isDefineCommand(node)) return null
  const args = node.field("arguments")
  return args?.children().find((child) => child.kind() === "object") ?? null
}

function literal(node: SgNode | undefined): string | null {
  if (!node || node.kind() !== "string") return null
  return node.text().replace(/^["'`]|["'`]$/g, "")
}

/** Flag names from an `args` object literal: citty declares one property per flag. */
function inlineFlags(value: SgNode): string[] | null {
  const object = value.kind() === "object" ? value : null
  return object ? properties(object).entries().map(([key]) => key) : null
}

/**
 * `function commonArgs() { return { … } }` in the same file. 80 of the ~94 `args:` sites go through such a
 * helper, so resolving it locally is what keeps the flag counts real instead of reported as unknown.
 */
function helperFlags(root: SgNode, helper: string): string[] | null {
  const declarations = root
    .findAll({ rule: { kind: "function_declaration" } })
    .filter((node) => node.children().some((child) => child.kind() === "identifier" && child.text() === helper))
  for (const declaration of declarations) {
    for (const object of declaration.findAll({ rule: { kind: "object" } })) {
      const flags = inlineFlags(object)
      if (flags && flags.length > 0) return flags
    }
  }
  return null
}

function readCommand(options: SgNode, root: SgNode, path: string, surface: NodeCliSurface, isRoot: boolean): void {
  const props = properties(options)
  const meta = props.get("meta")
  const description = meta ? literal(properties(meta).get("description")) : null

  if (!isRoot) {
    const args = props.get("args")
    if (!args) {
      // A command may take no flags at all (`guided`); it is still an action the port must keep reachable.
      surface.commands.push({ name: path, description, flags: [], argsFrom: "none" })
    } else {
      const inline = inlineFlags(args)
      if (inline) surface.commands.push({ name: path, description, flags: inline, argsFrom: "inline" })
      else if (args.kind() === "call_expression") {
        const helper = calleeText(args)
        const resolved = helperFlags(root, helper)
        surface.commands.push({
          name: path,
          description,
          flags: resolved ?? [],
          // An unresolved helper means the flags live outside this file; the entry is reported, not invented.
          argsFrom: resolved ? `helper:${helper}` : `unresolved:${helper}`,
        })
      } else {
        surface.commands.push({ name: path, description, flags: [], argsFrom: `unknown:${args.kind()}` })
      }
    }
  }

  const subCommands = props.get("subCommands")
  if (!subCommands || subCommands.kind() !== "object") return
  for (const [key, value] of properties(subCommands).entries()) {
    const child = commandOptions(value)
    if (child) readCommand(child, root, isRoot ? key : `${path} ${key}`, surface, false)
  }
}

/** The initializer of `const NAME = …` in the same file. */
function constValue(root: SgNode, name: string): SgNode | null {
  for (const declarator of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const children = declarator.children()
    // The declarator keeps the `=` as a child between name and value, so the value is the last node.
    if (children[0]?.text() === name) return children.at(-1) ?? null
  }
  return null
}

/**
 * The name the legacy CLI prints for itself.
 *
 * `meta.name` is usually `CLI_NAME`, i.e. `const CLI_NAME = nodeCliName("trename")`, so the identifier alone is
 * not the fact and a literal-only reader silently reports the first *sub*command's name instead (measured: the
 * first version of this extractor returned `scan` for trename). `nodeCliName` is imported from the runtime
 * package rather than re-typed here, so the prefix has one definition; it reproduces the observed `USAGE
 * xtrename …` line.
 */
function resolveProgram(root: SgNode, options: SgNode): { name: string | null; from: string } {
  const meta = properties(options).get("meta")
  const declared = meta ? properties(meta).get("name") : null
  if (!declared) return { name: null, from: "missing" }
  if (declared.kind() === "string") return { name: literal(declared), from: "literal" }
  if (declared.kind() === "identifier") {
    const initializer = constValue(root, declared.text())
    if (!initializer) return { name: null, from: `undeclared:${declared.text()}` }
    if (initializer.kind() === "string") return { name: literal(initializer), from: "const-literal" }
    if (initializer.kind() === "call_expression" && calleeText(initializer) === "nodeCliName") {
      const argument = initializer.children().flatMap((child) => child.children()).find((child) => child.kind() === "string")
      const nodeId = literal(argument)
      return nodeId ? { name: nodeCliName(nodeId), from: "const-nodeCliName" } : { name: null, from: "nodeCliName-without-literal" }
    }
    return { name: null, from: `const-expression:${initializer.kind()}` }
  }
  return { name: null, from: `expression:${declared.kind()}` }
}

/**
 * `parseArgs({ options: { … } })` from `node:util`, the second CLI style in this tree: a single command whose
 * flags are the keys of one object. Read from the tree so a flag added to the parser lands in the inventory.
 */
function parseArgsFlags(root: SgNode): string[] {
  const flags = new Set<string>()
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    if (calleeText(call) !== "parseArgs") continue
    const options = call.field("arguments")?.children().find((child) => child.kind() === "object")
    const declared = options ? properties(options).get("options") : undefined
    if (declared?.kind() === "object") for (const [key] of properties(declared).entries()) flags.add(key)
  }
  return [...flags].sort((left, right) => left.localeCompare(right))
}

export function extractNodeCliSurface(nodeId: string, file: string, source: string): NodeCliSurface {
  const root = parse("typescript", source).root()
  const surface: NodeCliSurface = { nodeId, file, program: null, programFrom: "missing", style: "none", commands: [], flagLiterals: [] }

  const allCalls = root.findAll({ rule: { kind: "call_expression" } })
  const calls = allCalls.filter(isDefineCommand)
  const optionsFor = calls.map((call) => commandOptions(call)).filter((options): options is SgNode => options !== null)
  const rootOptions = optionsFor.find((options) => properties(options).has("subCommands")) ?? optionsFor[0]
  if (rootOptions) {
    const program = resolveProgram(root, rootOptions)
    surface.program = program.name
    surface.programFrom = program.from
    readCommand(rootOptions, root, program.name ?? "(root)", surface, true)
    if (surface.commands.length > 0) surface.style = "citty"
  }

  if (surface.commands.length === 0) {
    const flags = parseArgsFlags(root)
    if (flags.length > 0) {
      surface.style = "parseArgs"
      surface.commands.push({ name: "(root)", description: null, flags, argsFrom: "parseArgs" })
    } else if (allCalls.some((call) => calleeText(call) === "runInteractionCli")) {
      // Most of the tree: the CLI has no flags of its own, it renders the node's interaction definition.
      surface.style = "interaction-driven"
    }
  }

  // Supplementary, and deliberately not a claim about the accepted surface: every `--flag` literal in the file.
  surface.flagLiterals = [
    ...new Set(
      root
        .findAll({ rule: { kind: "string" } })
        .map((node) => literal(node) ?? "")
        .filter((text) => /^--[a-z][\w-]*$/.test(text))
        .map((text) => text.slice(2)),
    ),
  ].sort((left, right) => left.localeCompare(right))
  return surface
}

async function retainedNodes(manifestPath: string): Promise<string[]> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { nodes: { id: string; disposition: string }[] }
  return manifest.nodes
    .filter((entry) => entry.disposition === "retain-rewrite")
    .map((entry) => entry.id)
    .sort((left, right) => left.localeCompare(right))
}

export async function auditNodeCliSurface(options: CliSurfaceOptions): Promise<{ surfaces: NodeCliSurface[]; unreadable: string[] }> {
  const surfaces: NodeCliSurface[] = []
  const unreadable: string[] = []
  for (const nodeId of await retainedNodes(options.manifestPath)) {
    const file = join(options.nodesRoot, nodeId, "src", "cli.ts")
    const source = await readFile(file, "utf8").catch(() => null)
    if (source === null) {
      unreadable.push(nodeId)
      continue
    }
    surfaces.push(extractNodeCliSurface(nodeId, `packages/nodes/${nodeId}/src/cli.ts`, source))
  }
  return { surfaces, unreadable }
}

/** Everything the inventory claims about one node, as comparable and printable tokens. */
function surfaceSignature(surface: NodeCliSurface): Set<string> {
  return new Set([
    `style ${surface.style}`,
    ...surface.commands.map((command) => `command ${command.name} [--${command.flags.join("], [")}]`),
    ...surface.flagLiterals.map((flag) => `literal --${flag}`),
  ])
}

export function cliSurfaceDrift(baseline: NodeCliSurface[], current: NodeCliSurface[]): CliSurfaceDrift[] {
  const drift: CliSurfaceDrift[] = []
  const byId = new Map(baseline.map((surface) => [surface.nodeId, surface]))
  for (const surface of current) {
    const previous = byId.get(surface.nodeId)
    if (!previous) continue
    const before = surfaceSignature(previous)
    const now = surfaceSignature(surface)
    const added = [...now].filter((entry) => !before.has(entry))
    const removed = [...before].filter((entry) => !now.has(entry))
    if (added.length > 0 || removed.length > 0) drift.push({ nodeId: surface.nodeId, added, removed })
  }
  return drift
}

async function writeBaseline(options: CliSurfaceOptions, surfaces: NodeCliSurface[]): Promise<void> {
  const path = options.baselinePath
  await mkdir(dirname(path), { recursive: true })
  const sorted = [...surfaces].sort((left, right) => left.nodeId.localeCompare(right.nodeId))
  await writeFile(path, `${JSON.stringify({ surfaces: sorted }, null, 2)}\n`, "utf8")
}

if (import.meta.main) {
  const options: CliSurfaceOptions = {
    nodesRoot: join(process.cwd(), "packages", "nodes"),
    manifestPath: join(process.cwd(), "docs", "xiranite-target-node-manifest.json"),
    baselinePath: join(process.cwd(), "docs", "node-cli-surface-baseline.json"),
  }
  const { surfaces, unreadable } = await auditNodeCliSurface(options)
  if (surfaces.length === 0) {
    throw new Error("audit:node-cli-surface inventoried no node CLIs: an empty scan must not read as a passing gate.")
  }

  const commandCount = surfaces.reduce((total, surface) => total + surface.commands.length, 0)
  const literalCount = surfaces.reduce((total, surface) => total + surface.flagLiterals.length, 0)
  const helperCommands = surfaces.reduce((total, surface) => total + surface.commands.filter((command) => command.argsFrom.startsWith("helper:")).length, 0)
  const unresolved = surfaces.flatMap((surface) => surface.commands.filter((command) => command.argsFrom.startsWith("unresolved:")).map((command) => `${surface.nodeId}: ${command.argsFrom}`))
  const unknownShapes = surfaces.flatMap((surface) => surface.commands.filter((command) => command.argsFrom.startsWith("unknown:")).map((command) => `${surface.nodeId}: ${command.argsFrom}`))
  const noProgram = surfaces.filter((surface) => surface.program === null).map((surface) => surface.nodeId)
  const styles = surfaces.reduce<Record<string, number>>((counted, surface) => {
    counted[surface.style] = (counted[surface.style] ?? 0) + 1
    return counted
  }, {})

  if (process.argv.includes("--write")) {
    await writeBaseline(options, surfaces)
    console.log(`CLI surface baseline written: ${surfaces.length} node(s), ${commandCount} command(s).`)
  }

  const baselineRaw = await readFile(options.baselinePath, "utf8").catch(() => null)
  if (baselineRaw === null) throw new Error(`audit:node-cli-surface found no baseline at ${options.baselinePath}; run bun run migrate:node-cli-surface.`)
  const baseline = (JSON.parse(baselineRaw) as { surfaces: NodeCliSurface[] }).surfaces
  const drift = cliSurfaceDrift(baseline, surfaces)
  for (const entry of drift) {
    for (const added of entry.added) console.error(`FAIL  ${entry.nodeId}: new in the legacy CLI but not in the baseline: ${added}`)
    for (const removed of entry.removed) console.error(`FAIL  ${entry.nodeId}: gone from the legacy CLI but still in the baseline: ${removed}`)
  }
  for (const nodeId of unreadable) console.log(`DEBT  ${nodeId}: retained per the target manifest but has no packages/nodes/${nodeId}/src/cli.ts, so there is no legacy CLI surface to reproduce.`)
  for (const entry of unresolved) console.log(`DEBT  ${entry}: flags live outside the node's own cli.ts; the inventory reports none rather than guessing.`)
  for (const nodeId of noProgram) console.log(`DEBT  ${nodeId}: no root meta.name, so the legacy CLI has no self-name to reproduce.`)

  console.log(
    `Node CLI surface: ${surfaces.length} node(s) inventoried (${Object.entries(styles).map(([style, count]) => `${count} ${style}`).join(", ")}), `
    + `${commandCount} command(s), ${helperCommands} of them taking flags through a shared helper, `
    + `${literalCount} flag literal(s) seen in the sources, ${unresolved.length} helper(s) unresolved, `
    + `${unknownShapes.length} unrecognised args shape(s), ${drift.length} drifted, ${unreadable.length} without a CLI file.`,
  )
  if (drift.length > 0) throw new Error(`audit:node-cli-surface found ${drift.length} node(s) whose CLI surface moved since the baseline.`)
}
