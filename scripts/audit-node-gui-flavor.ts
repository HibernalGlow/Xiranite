/**
 * Gate for ADR-0069 §"Standalone is a build target": the per-node GUI door must stay *reachable*, not
 * merely permitted on paper.
 *
 * `audit:node-ui-independence` scans every file under `src/nodes/<id>/`, which answers "does this node's
 * directory touch the shell". A flavor answers the harder question: **starting from that node's own entry, what
 * does the bundle actually pull in?** A shell import sitting in an unreached file is debt; the same import
 * reached from the entry closes the door. So this gate walks the import closure of `src/nodes/<id>/entry.ts`
 * and reports three kinds of breakage:
 *
 * - **missing entry** — a node with a UI directory but no `entry.ts` has no flavor to build; hard failure with
 *   no baseline allowance, because the entry *is* the door.
 * - **shell coupling / seam** — the closure reaches Xiranite-only state or `@/backend`, i.e. the standalone
 *   window could not run without the unified app. One vocabulary with the other gate, imported not restated.
 * - **sibling leak** — the closure reaches another node's directory. `src/nodes/shared` is the exempt edge
 *   because it is the seam every node is told to use. Without this check a "per-node" bundle would drag the
 *   whole product in, and the size argument in ADR-0074 §6 would be fiction.
 *
 * Coupling, seam and sibling counts are ratcheted per node against a committed baseline: existing debt stays
 * visible, new debt is red. The baseline is never seeded from live counts (that would make growth invisible),
 * only from `--update-baseline`, which is an explicit act.
 *
 * Scope edge, recorded so nobody reads more into it than it proves: bare package specifiers are not followed
 * into `node_modules`, except `@xiranite/node-<id>`, checked by name. A node importing its *own* package is the
 * flavor's intended shape (`entry.ts` hands `{def, core, Component}` to the shell); importing someone else's
 * is a leak.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"

import { classify, extractImportEdges } from "./audit-node-ui-independence"

export type FlavorKind = "coupling" | "seam" | "sibling"

export interface NodeFlavorCounts {
  coupling: number
  seam: number
  sibling: number
}

export interface FlavorViolation {
  node: string
  kind: FlavorKind
  file: string
  line: number
  specifier: string
}

export interface FlavorReport {
  nodes: string[]
  entries: string[]
  missingEntry: string[]
  violations: FlavorViolation[]
  counts: Map<string, NodeFlavorCounts>
  baseline: Record<string, NodeFlavorCounts>
}

/** Extension-less specifiers are either a file or a directory holding an index. */
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]
const LEAF_RE = /\.(?:css|scss|svg|png|jpe?g|gif|webp|json|woff2?|md)$/

async function resolveModule(base: string): Promise<string | null> {
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    const info = await stat(candidate).catch(() => null)
    if (info?.isFile()) return candidate
  }
  return null
}

/** Node UI directories; `shared` is the exempt seam directory every node may reach, not a node. */
async function nodeDirs(nodesRoot: string): Promise<string[]> {
  const entries = await readdir(nodesRoot, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .filter((name) => name !== "shared")
    .sort()
}

/** Which node owns a path under `src/nodes`; `shared` and anything outside answer null. */
function ownerOf(path: string, nodesRoot: string): string | null {
  const fromRoot = relative(nodesRoot, path)
  if (fromRoot === "" || fromRoot.startsWith("..")) return null
  const [first] = fromRoot.split(sep)
  return first && first !== "shared" ? first : null
}

interface Edge {
  file: string
  line: number
  specifier: string
  resolved: string | null
}

async function closureOf(entryPath: string, nodesRoot: string, srcRoot: string): Promise<Edge[]> {
  const seen = new Set<string>()
  const edges: Edge[] = []
  const queue = [entryPath]

  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = await readFile(file, "utf8")
    for (const edge of extractImportEdges(source, file)) {
      // A type-only import is erased, so it is neither a bundle edge nor a violation. Counting those was the
      // first version's false positive: `FloatingWindowFrame` reached `@/backend/runtime/runtime` only through
      // `import type { MainWindowAction }`, and that made 26 of 27 seam hits fiction.
      if (edge.typeOnly) continue
      const specifier = edge.specifier
      let resolvedPath: string | null = null
      if (specifier.startsWith("@/")) resolvedPath = await resolveModule(join(srcRoot, specifier.slice(2)))
      else if (specifier.startsWith(".") && !LEAF_RE.test(specifier)) {
        resolvedPath = await resolveModule(resolve(dirname(file), specifier))
      }
      // Reaching into another node's directory is a leak even when the owning node is the importer's own
      // neighbour, so the edge is followed either way: the closure must be the real bundle graph.
      if (resolvedPath) {
        const outsideNodes = relative(nodesRoot, resolvedPath).startsWith("..")
        const outsideSrc = relative(srcRoot, resolvedPath).startsWith("..")
        if (!outsideNodes || !outsideSrc) queue.push(resolvedPath)
      }
      edges.push({ file, line: edge.line, specifier, resolved: resolvedPath })
    }
  }
  return edges
}

function emptyCounts(): NodeFlavorCounts {
  return { coupling: 0, seam: 0, sibling: 0 }
}

export async function auditNodeGuiFlavor(options: {
  nodesRoot: string
  srcRoot: string
  baselinePath: string
  generateBaseline?: boolean
}): Promise<FlavorReport> {
  const baselineText = await readFile(options.baselinePath, "utf8").catch(() => null)
  const baseline = baselineText === null || options.generateBaseline
    ? {}
    : (JSON.parse(baselineText) as { nodes?: Record<string, NodeFlavorCounts> }).nodes ?? {}

  const nodes = await nodeDirs(options.nodesRoot)
  const report: FlavorReport = {
    nodes,
    entries: [],
    missingEntry: [],
    violations: [],
    counts: new Map(),
    baseline,
  }

  for (const node of nodes) {
    const entryPath = join(options.nodesRoot, node, "entry.ts")
    const entry = await readFile(entryPath, "utf8").catch(() => null)
    if (entry === null) {
      report.missingEntry.push(node)
      continue
    }
    report.entries.push(entryPath)
    const counts = emptyCounts()
    report.counts.set(node, counts)
    for (const edge of await closureOf(entryPath, options.nodesRoot, options.srcRoot)) {
      const kind = classify(edge.specifier)
      if (kind === "coupling" || kind === "seam") {
        counts[kind] += 1
        report.violations.push({ node, kind, file: edge.file, line: edge.line, specifier: edge.specifier })
        continue
      }
      const packageSibling = /^@xiranite\/node-([a-z0-9]+)/.exec(edge.specifier)
      if (packageSibling && packageSibling[1] !== node) {
        counts.sibling += 1
        report.violations.push({ node, kind: "sibling", file: edge.file, line: edge.line, specifier: edge.specifier })
        continue
      }
      if (edge.resolved) {
        const owner = ownerOf(edge.resolved, options.nodesRoot)
        if (owner && owner !== node) {
          counts.sibling += 1
          report.violations.push({ node, kind: "sibling", file: edge.file, line: edge.line, specifier: edge.specifier })
        }
      }
    }
  }

  if (options.generateBaseline) {
    const out: Record<string, NodeFlavorCounts> = {}
    for (const [node, counts] of report.counts) out[node] = counts
    await writeFile(options.baselinePath, `${JSON.stringify({ schemaVersion: 1, nodes: out }, null, 2)}\n`, "utf8")
    // The freshly written numbers become the allowance; comparing against the pre-write baseline would
    // report every recorded debt node as growth and make `migrate:` exit non-zero on its own success.
    report.baseline = out
  }

  return report
}

/** Nodes whose live counts exceed the committed baseline, with both sides shown. */
export function flavorGrowth(report: FlavorReport): Array<{ node: string, from: NodeFlavorCounts, to: NodeFlavorCounts }> {
  const grew: Array<{ node: string, from: NodeFlavorCounts, to: NodeFlavorCounts }> = []
  for (const [node, to] of report.counts) {
    const from = report.baseline[node] ?? emptyCounts()
    if (to.coupling > from.coupling || to.seam > from.seam || to.sibling > from.sibling) {
      grew.push({ node, from, to })
    }
  }
  return grew
}

function totals(report: FlavorReport): NodeFlavorCounts {
  const sum = emptyCounts()
  for (const counts of report.counts.values()) {
    sum.coupling += counts.coupling
    sum.seam += counts.seam
    sum.sibling += counts.sibling
  }
  return sum
}

if (import.meta.main) {
  const root = process.cwd()
  const nodesRoot = join(root, "src/nodes")
  const report = await auditNodeGuiFlavor({
    nodesRoot,
    srcRoot: join(root, "src"),
    baselinePath: join(root, "docs/node-gui-flavor-baseline.json"),
    generateBaseline: process.argv.includes("--update-baseline"),
  })

  // Vacuity control: an empty scan is a broken scan, never a green one.
  if (report.nodes.length === 0) {
    throw new Error("audit:node-gui-flavor found no node UI directories — the scan path is wrong, not the result.")
  }
  if (report.entries.length === 0 && report.missingEntry.length === 0) {
    throw new Error("audit:node-gui-flavor reached no entries — refusing to read \"nothing scanned\" as \"nothing wrong\".")
  }

  const summary = totals(report)
  for (const node of report.missingEntry) {
    console.error(`FAIL ${node}: no src/nodes/${node}/entry.ts, so there is no per-node GUI flavor to build`)
  }
  for (const item of flavorGrowth(report)) {
    console.error(`FAIL ${item.node}: flavor closure grew from ${JSON.stringify(item.from)} to ${JSON.stringify(item.to)}`)
  }
  for (const hit of report.violations) {
    console.error(`  ${hit.kind}  ${relative(root, hit.file)}:${hit.line} → ${hit.specifier}`)
  }
  console.log(
    `Node GUI flavor reachability: ${report.entries.length} entries over ${report.nodes.length} node UI dirs`
    + ` (missing ${report.missingEntry.length}); closure imports {coupling ${summary.coupling},`
    + ` seam ${summary.seam}, sibling ${summary.sibling}}.`,
  )
  if (report.missingEntry.length > 0) {
    throw new Error(`audit:node-gui-flavor: ${report.missingEntry.length} node(s) without a standalone entry.`)
  }
  if (flavorGrowth(report).length > 0) {
    throw new Error("audit:node-gui-flavor: a node's flavor closure gained shell or sibling reach.")
  }
}
