/**
 * Ratchet gate for ADR-0069's "never write code that requires the GUI to depend on Xiranite".
 *
 * The GUI stays one product — every node's Web UI is a view inside Xiranite's single Tauri shell — so the
 * rule is not "ship 43 apps", it is that a node's UI must stay extractable: no Xiranite-only state, no
 * global config, no nexus, no main-app routing, and backend access only through the transport seam.
 * Breaking that closes the option permanently, which is why it gets a gate rather than a comment.
 *
 * Two severities, deliberately:
 * - **coupling** (`@/store`, `@/features`, `@/nexus`, `@/services`, `@/App`, `@/router`) fails when it
 *   grows past the committed baseline;
 * - **transport seam** (`@/backend/*`) is a hard failure at any count. Node UI reaches the backend through
 *   its own seam, `src/nodes/shared/api.ts`, which builds `@xiranite/api/client` instances from the injected
 *   endpoint (`src/lib/xiraniteApiClient.ts`). That is what lets the Rust/Tauri transport swap touch
 *   `src/backend` and nothing inside a node (ADR-0063 principle 2), so a single `@/backend` import re-closes
 *   the option.
 *
 * Import specifiers are read from the syntax tree (`@ast-grep/napi`), not from a line regex and never from bare
 * word grep — ADR-0067's residue rule — because `workspace` appears in unrelated identifiers and comments. Two
 * blind spots that fixes: a multi-line `import {\n a,\n} from "@/store/x"` is invisible to a line regex, and a
 * type-only import must not count at all, because ADR-0074 exempts `import type` — it compiles away and cannot
 * make a node's UI need the shell at runtime.
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"

import { parse, type SgNode } from "@ast-grep/napi"

// Exported so `audit-node-gui-flavor.ts` reads the same vocabulary instead of keeping a second copy:
// both gates answer "may a node's UI touch the shell", and a drift between two lists would make one of
// them quietly blind (ADR-0069, ADR-0067).
export const COUPLING_PREFIXES = ["@/store", "@/features", "@/nexus", "@/services", "@/App", "@/router", "@/hooks/useWorkspace", "@/lib/workspace"]
export const SEAM_PREFIXES = ["@/backend"]

export interface UiCouplingReport {
  filesScanned: number
  nodes: string[]
  coupling: Array<{ node: string, file: string, specifier: string, line: number }>
  seam: Array<{ node: string, file: string, specifier: string, line: number }>
  baseline: Record<string, number>
}

export function classify(specifier: string): "coupling" | "seam" | null {
  if (COUPLING_PREFIXES.some((prefix) => specifier.startsWith(prefix))) return "coupling"
  if (SEAM_PREFIXES.some((prefix) => specifier.startsWith(prefix))) return "seam"
  return null
}

export interface ImportEdge {
  specifier: string
  /** True when the edge is erased at build time, so it carries no bytes into the bundle. */
  typeOnly: boolean
  line: number
}

const TYPE_ONLY_STATEMENT_RE = /^(?:import|export)\s+type\s/
/** Node kinds that mean a position is a *type* position, so an `import("…")` there is erased. */
const TYPE_CONTEXT_KINDS = new Set([
  "type_annotation", "type_alias_declaration", "union_type", "intersection_type", "function_type",
  "parenthesized_type", "array_type", "object_type", "generic_type", "indexed_type",
  "nested_type_identifier", "template_literal_type", "literal_type", "flow_maybe_type",
])

function unquote(text: string): string {
  return text.replace(/^["'`]|["'`]$/g, "")
}

/**
 * A `… { type A, type B } from "x"` clause moves only types, so the whole statement is erased. A clause with
 * even one value binding is a real edge — that is the shape that keeps a module in the bundle.
 */
function clauseIsAllTypes(node: SgNode): boolean {
  for (const clauseKind of ["named_imports", "export_clause"]) {
    const clause = node.find({ rule: { kind: clauseKind } })
    if (!clause) continue
    const specifiers = clause
      .children()
      .filter((child) => child.kind() === "import_specifier" || child.kind() === "export_specifier")
    if (specifiers.length === 0) continue
    return specifiers.every((specifier) => /^type\s/.test(specifier.text()))
  }
  return false
}

/**
 * Every module edge in one source file, read from the syntax tree rather than from a line regex.
 *
 * Both gates walk this, so it has to be the real graph (ADR-0067): a line regex silently misses the
 * multi-line `import {\n a,\n} from "x"` shape this repo uses everywhere, and it cannot tell
 * `import type` apart from a value import — which ADR-0074 exempts, because a type import compiles away.
 * Comments are out of the tree, so mentioning a forbidden path in prose no longer trips anything either.
 */
export function extractImportEdges(source: string, path = ""): ImportEdge[] {
  const language = /\.m?jsx$/.test(path) ? "tsx" : "ts"
  let root: SgNode
  try {
    root = parse(language, source).root()
  } catch {
    // A file that does not parse cannot contribute edges; the scan still reports the other files.
    return []
  }

  const edges: ImportEdge[] = []
  for (const node of root.findAll({
    rule: { any: [{ kind: "import_statement" }, { kind: "export_statement" }, { kind: "call_expression" }] },
  })) {
    const line = node.range().start.line + 1
    if (node.kind() === "call_expression") {
      if (node.field("function")?.text() !== "import") continue
      const literal = node.find({ rule: { kind: "string" } })
      const specifier = literal ? unquote(literal.text()) : ""
      if (!specifier) continue
      edges.push({
        specifier,
        line,
        typeOnly: node.ancestors().some((ancestor) => TYPE_CONTEXT_KINDS.has(ancestor.kind())),
      })
      continue
    }

    const sourceField = node.field("source")
    if (!sourceField) continue
    edges.push({
      specifier: unquote(sourceField.text()),
      line,
      typeOnly: TYPE_ONLY_STATEMENT_RE.test(node.text()) || clauseIsAllTypes(node),
    })
  }
  return edges
}

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  // A missing root yields an empty scan, which the main guard turns into an error: reading it as
  // "no violations" would be the vacuous-green failure mode this gate exists to avoid.
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "__screenshots__" || entry.name.startsWith(".")) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...await sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name)) found.push(path)
  }
  return found
}

export async function auditNodeUiIndependence(options: {
  nodesRoot: string
  baselinePath: string
  generateBaseline?: boolean
}): Promise<UiCouplingReport> {
  const baselineText = await readFile(options.baselinePath, "utf8").catch(() => null)
  const baseline = baselineText === null || options.generateBaseline ? {} : (JSON.parse(baselineText) as Record<string, number>)
  const files = await sourceFiles(options.nodesRoot)
  const report: UiCouplingReport = { filesScanned: files.length, nodes: [], coupling: [], seam: [], baseline }
  const nodes = new Set<string>()

  for (const path of files) {
    const fromRoot = relative(process.cwd(), path)
    // The node is the directory under `src/nodes`, taken from the scan root rather than from the
    // caller's cwd: the same function has to answer identically when a test points it at a fixture tree.
    const node = path.slice(options.nodesRoot.length + 1).split(/[\\/]/)[0] || "?"
    nodes.add(node)
    const source = await readFile(path, "utf8")
    for (const edge of extractImportEdges(source, path)) {
      // A type-only import compiles away, so it cannot make a node's UI depend on the shell (ADR-0074).
      if (edge.typeOnly) continue
      const kind = classify(edge.specifier)
      if (kind === "coupling") report.coupling.push({ node, file: fromRoot, specifier: edge.specifier, line: edge.line })
      else if (kind === "seam") report.seam.push({ node, file: fromRoot, specifier: edge.specifier, line: edge.line })
    }
  }

  report.nodes = [...nodes].sort()

  if (options.generateBaseline) {
    const counts: Record<string, number> = {}
    for (const hit of report.coupling) counts[hit.node] = (counts[hit.node] ?? 0) + 1
    await writeFile(options.baselinePath, `${JSON.stringify(counts, null, 2)}\n`, "utf8")
    report.baseline = counts
  }

  return report
}

/** Growth beyond the recorded baseline, per node. */
export function couplingGrowth(report: UiCouplingReport): Array<{ node: string, from: number, to: number }> {
  const counts: Record<string, number> = {}
  for (const hit of report.coupling) counts[hit.node] = (counts[hit.node] ?? 0) + 1
  return Object.entries(counts)
    .filter(([node, count]) => count > (report.baseline[node] ?? 0))
    .map(([node, to]) => ({ node, from: report.baseline[node] ?? 0, to }))
}

/**
 * Every `@/backend` import inside `src/nodes/**`. There is no allowance for these: node UI reaches the backend
 * through `src/nodes/shared/api.ts`, so any hit here is a node re-coupling itself to Xiranite's shell transport
 * and the Tauri/Rust swap would have to reach into that node.
 */
export function seamViolations(report: UiCouplingReport): UiCouplingReport["seam"] {
  return report.seam
}

if (import.meta.main) {
  const generate = process.argv.includes("--update-baseline")
  const report = await auditNodeUiIndependence({
    nodesRoot: join(process.cwd(), "src/nodes"),
    baselinePath: join(process.cwd(), "docs/node-ui-coupling-baseline.json"),
    generateBaseline: generate,
  })

  if (report.filesScanned === 0 || report.nodes.length === 0) {
    throw new Error("audit:node-ui-independence scanned no node UI files — the scan path is wrong, not the result.")
  }

  const growth = couplingGrowth(report)
  for (const item of growth) {
    console.error(`FAIL ${item.node}: Xiranite-only imports grew from ${item.from} to ${item.to}`)
  }
  for (const hit of report.coupling) {
    console.error(`  coupling  ${hit.file}:${hit.line} → ${hit.specifier}`)
  }
  for (const hit of report.seam) {
    console.error(`  FAIL seam  ${hit.file}:${hit.line} → ${hit.specifier} (use @/nodes/shared/api instead of @/backend)`)
  }
  console.log(
    `Node UI independence: ${report.filesScanned} files across ${report.nodes.length} nodes;`
    + ` coupling ${report.coupling.length} (baseline-allowed, growth ${growth.length}),`
    + ` transport-seam call sites ${report.seam.length} (must stay 0: node UI reaches the backend only`
    + ` through src/nodes/shared/api.ts → @xiranite/api/client).`,
  )
  const violations = seamViolations(report)
  if (violations.length > 0) {
    throw new Error(`audit:node-ui-independence: ${violations.length} @/backend import(s) inside src/nodes — the node transport seam is src/nodes/shared/api.ts.`)
  }
  if (growth.length > 0) throw new Error(`audit:node-ui-independence: ${growth.length} node(s) increased coupling.`)
}
