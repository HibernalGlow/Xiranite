#!/usr/bin/env bun
/**
 * Meter for the machine-access migration: which node `platform.ts` files still reach Node's machine
 * builtins directly, instead of going through `@xiranite/host-capabilities`.
 *
 * Why this exists: the plan is "swap a node, then delete what no longer has a consumer". Deletion needs a
 * count that only moves one way, and `spikes/shim-consumer-audit.ts` measures the shim side (who imports a
 * shim) rather than the call side (who reaches the OS). Both are needed: the shim file can only go when its
 * last consumer is gone, and the consumer only goes when its node is migrated.
 *
 * Why AST and not a line regex: the reading is shared with `audit-node-ui-independence.ts`
 * (`extractImportEdges`) rather than re-implemented here. A row-scanning rule silently misses a multi-line
 * import clause, and only a real parse separates `import type { Stats } from "node:fs"` (erased at build
 * time, which ADR-0074 exempts) from the value import that drags a builtin into the bundle. Two AST readers
 * over one rule is also how two lists drift apart.
 *
 * `node:path` is deliberately NOT in the machine set: path arithmetic is not a host operation and moving it
 * is one pass for every consumer, so counting it here would only add noise to the number that is falling.
 *
 * A `platform.ts` can also reach a builtin *without importing it* — by importing a workspace package whose
 * own entry does. `usesCapabilities` alone would call that node migrated while the bundle still drags
 * `node:fs/promises` in, so `hiddenMachine*` measures one hop of that shape. `@xiranite/host-capabilities`
 * is excluded on purpose: inside a bundle its `node.ts` is replaced by `realm.ts` through
 * `REALM_PACKAGE_ALIASES`, and the built artifacts carry zero `node:module` / `node:assert` /
 * `node:worker_threads` literals (measured), so the surface's own Node side never reaches an artifact.
 *
 * Usage: `bun scripts/audit-platform-capabilities.ts` (report + fail if worse than the baseline),
 * `--json` for the raw record, `--update-baseline` to write the current numbers after a real improvement.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { extractImportEdges } from "./audit-node-ui-independence.ts"

/** Builtins whose answer is a machine fact; a `platform.ts` importing one bypasses the capability surface. */
export const MACHINE_BUILTINS: readonly string[] = [
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "node:os",
  "node:crypto",
  "node:worker_threads",
  "node:net",
  "node:http",
  "node:https",
  "node:dns",
  "node:tls",
  "node:dgram",
]

const CAPABILITY_SPECIFIER = "@xiranite/host-capabilities"

/** The manifest's own spelling for a node that ships; a wrong literal here reads zero and looks green. */
const RETAINED_DISPOSITION = "retain-rewrite"

export interface PlatformFileRecord {
  id: string
  /** Repo-relative path, so the baseline survives a moved checkout. */
  file: string
  machineImports: { specifier: string; line: number }[]
  /** Direct `node:path` imports, counted apart from the machine set (see the file header). */
  pathImports: { specifier: string; line: number }[]
  usesCapabilities: boolean
  /** Builtins reached through one workspace package hop; empty when the node only uses the surface. */
  hiddenMachine: HiddenEdge[]
}

export interface PlatformAuditReport {
  schemaVersion: 1
  retainedNodes: number
  platformFiles: number
  filesWithMachineImports: number
  machineImports: number
  pathFiles: number
  pathImports: number
  filesUsingCapabilities: number
  nodesWithHiddenMachine: number
  hiddenMachineEdges: number
  /**
   * Builtins counted per shared workspace package, aggregated over every node that reaches it. This is the
   * work list the deletion leg needs: a shim alias only loses its last consumer when *its* number hits zero,
   * and a node-level count can't say which package still owes the work.
   */
  hiddenByPackage: Record<string, number>
  records: PlatformFileRecord[]
}

export function auditPlatformFiles(repoRoot: string): PlatformAuditReport {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "docs", "xiranite-target-node-manifest.json"), "utf8"),
  ) as { nodes: { id: string; disposition: string }[] }
  const retained = manifest.nodes.filter((node) => node.disposition === RETAINED_DISPOSITION)

  const index = packageIndex(repoRoot)
  const records: PlatformFileRecord[] = []
  for (const node of retained) {
    const file = join(repoRoot, "packages", "nodes", node.id, "src", "platform.ts")
    if (!existsSync(file)) continue
    const edges = extractImportEdges(readFileSync(file, "utf8"), file)
    records.push({
      id: node.id,
      file: resolve(file).replace(`${resolve(repoRoot)}/`, ""),
      machineImports: edges
        .filter((edge) => MACHINE_BUILTINS.includes(edge.specifier) && !edge.typeOnly)
        .map((edge) => ({ specifier: edge.specifier, line: edge.line })),
      pathImports: edges
        .filter((edge) => (edge.specifier === "node:path" || edge.specifier === "path") && !edge.typeOnly)
        .map((edge) => ({ specifier: edge.specifier, line: edge.line })),
      usesCapabilities: edges.some(
        (edge) =>
          edge.specifier === CAPABILITY_SPECIFIER || edge.specifier.startsWith(`${CAPABILITY_SPECIFIER}/`),
      ),
      hiddenMachine: hiddenMachineEdges(file, repoRoot, index),
    })
  }

  return {
    schemaVersion: 1,
    retainedNodes: retained.length,
    platformFiles: records.length,
    filesWithMachineImports: records.filter((record) => record.machineImports.length > 0).length,
    machineImports: records.reduce((sum, record) => sum + record.machineImports.length, 0),
    filesUsingCapabilities: records.filter((record) => record.usesCapabilities).length,
    pathFiles: records.filter((record) => record.pathImports.length > 0).length,
    pathImports: records.reduce((sum, record) => sum + record.pathImports.length, 0),
    nodesWithHiddenMachine: records.filter((record) => record.hiddenMachine.length > 0).length,
    hiddenMachineEdges: records.reduce((sum, record) => sum + record.hiddenMachine.length, 0),
    hiddenByPackage: hiddenPackageTotals(records),
    records,
  }
}

/**
 * One machine builtin reached through a workspace package rather than imported by the node itself.
 *
 * `via` is repo-relative so the baseline survives a moved checkout, and it names the file *inside* that
 * package: the fix for a row here is in the shared package, not in the node.
 */
interface HiddenEdge {
  package: string
  specifier: string
  via: string
}

interface PackageLocation {
  dir: string
  exports: Record<string, unknown> | string | undefined
  name: string
}

function relativeTo(file: string, repoRoot: string): string {
  return resolve(file).replace(`${resolve(repoRoot)}/`, "")
}

function packageIndex(repoRoot: string): Map<string, PackageLocation> {
  const index = new Map<string, PackageLocation>()
  for (const root of [join(repoRoot, "packages"), join(repoRoot, "packages", "nodes")]) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      const manifest = join(root, entry, "package.json")
      if (!existsSync(manifest)) continue
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string
        exports?: Record<string, unknown>
        main?: string
      }
      if (typeof parsed.name !== "string") continue
      index.set(parsed.name, { dir: join(root, entry), exports: parsed.exports ?? parsed.main, name: parsed.name })
    }
  }
  return index
}

/** `@xiranite/file-operations/platform` is package `@xiranite/file-operations` at subpath `./platform`. */
function splitWorkspaceSpecifier(specifier: string): { name: string; subpath: string } | null {
  if (!specifier.startsWith("@")) return null
  const parts = specifier.split("/")
  if (parts.length < 2) return null
  const rest = parts.slice(2)
  return { name: `${parts[0]}/${parts[1]}`, subpath: rest.length === 0 ? "." : `./${rest.join("/")}` }
}

/**
 * The source file behind a resolved specifier.
 *
 * Two shapes have to be translated because the workspace packages publish compiled output: an `exports`
 * target under `dist/` names the *built* file (`./dist/platform.js`), and NodeNext-style relative imports
 * inside a package carry a `.js` extension their `.ts` source does not. Both are mapped to the source, which
 * is the only version a static reach measure can honestly call current — `XIRANITE_NODE_SOURCE=1` exists in
 * this repo for the same reason. A `dist` path with no source sibling is returned unchanged, and the walk
 * then drops it: an unbuilt package is not evidence of a reach, and pretending otherwise would let a stale
 * build decide what a gate reports.
 */
function sourceFile(absolute: string): string | null {
  const withoutJs = absolute.replace(/\.js$/, "")
  const inDist = absolute.includes("/dist/")
  const candidates = inDist
    ? [absolute.replace(`${sep}dist${sep}`, `${sep}src${sep}`).replace(/\.js$/, ".ts"), withoutJs, `${withoutJs}.ts`, `${withoutJs}.tsx`]
    : [absolute, `${withoutJs}.ts`, `${withoutJs}.tsx`, absolute.replace(/\.js$/, ""), join(absolute, "index.ts")]
  for (const candidate of candidates) {
    if (candidate.endsWith("/")) continue
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** The `exports` map's arms are resolved the way esbuild resolves them: `import` first, then `default`. */
function entryFileOf(location: PackageLocation, subpath: string): string | null {
  const table = location.exports
  if (typeof table === "string") return subpath === "." ? sourceFile(join(location.dir, table)) : null
  if (table === null || table === undefined) return null
  const pick = (candidate: unknown): string | null => {
    if (typeof candidate === "string") return candidate
    if (candidate !== null && typeof candidate === "object") {
      for (const arm of ["import", "default", "types", "require"] as const) {
        const chosen = pick((candidate as Record<string, unknown>)[arm])
        if (chosen !== null) return chosen
      }
    }
    return null
  }
  const target = pick(table[subpath])
  return target === null ? null : sourceFile(join(location.dir, target))
}

/**
 * Files reachable from one entry while staying inside its own package: relative specifiers and the package's
 * own name are followed, everything else is a leaf. One hop of indirection is the shape this column needs; a
 * full cross-package graph would count the same builtin once per dependency edge and stop being a number
 * anyone can drive down.
 */
function machineReachFrom(entry: string, location: PackageLocation, repoRoot: string): HiddenEdge[] {
  const found: HiddenEdge[] = []
  const seen = new Set<string>()
  const queue: string[] = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file) || file.includes("/dist/") || file.endsWith(".test.ts") || file.endsWith(".d.ts")) continue
    seen.add(file)
    for (const edge of extractImportEdges(readFileSync(file, "utf8"), file)) {
      if (edge.typeOnly) continue
      if (MACHINE_BUILTINS.includes(edge.specifier)) {
        found.push({ package: location.name, specifier: edge.specifier, via: relativeTo(file, repoRoot) })
        continue
      }
      const own = splitWorkspaceSpecifier(edge.specifier)
      const next = edge.specifier.startsWith(".")
        ? sourceFile(resolve(dirname(file), edge.specifier))
        : own !== null && own.name === location.name
          ? entryFileOf(location, own.subpath)
          : null
      if (next !== null && next.startsWith(`${location.dir}/`)) queue.push(next)
    }
  }
  return found
}

/** The distinct `package x builtin` pairs one node reaches, deduped so a ten-file package counts once. */
function hiddenMachineEdges(platformFile: string, repoRoot: string, index: Map<string, PackageLocation>): HiddenEdge[] {
  const edges: HiddenEdge[] = []
  for (const edge of extractImportEdges(readFileSync(platformFile, "utf8"), platformFile)) {
    if (edge.typeOnly) continue
    if (edge.specifier === CAPABILITY_SPECIFIER || edge.specifier.startsWith(`${CAPABILITY_SPECIFIER}/`)) continue
    const split = splitWorkspaceSpecifier(edge.specifier)
    if (split === null) continue
    const location = index.get(split.name)
    if (location === undefined) continue
    const entry = entryFileOf(location, split.subpath)
    if (entry === null) continue
    edges.push(...machineReachFrom(entry, location, repoRoot))
  }
  const byKey = new Map<string, HiddenEdge>()
  for (const edge of edges) byKey.set(`${edge.package}|${edge.specifier}`, edge)
  return [...byKey.values()].sort((left, right) =>
    `${left.package} ${left.specifier}`.localeCompare(`${right.package} ${right.specifier}`),
  )
}

/** Aggregate the per-node edges into one distinct-builtin count per shared package. */
export function hiddenPackageTotals(records: readonly PlatformFileRecord[]): Record<string, number> {
  const builtins = new Map<string, Set<string>>()
  for (const record of records) {
    for (const edge of record.hiddenMachine) {
      const set = builtins.get(edge.package) ?? new Set<string>()
      set.add(edge.specifier)
      builtins.set(edge.package, set)
    }
  }
  return Object.fromEntries([...builtins].sort(([left], [right]) => left.localeCompare(right)).map(([name, set]) => [name, set.size]))
}

function baselinePath(repoRoot: string): string {
  return join(repoRoot, "docs", "platform-capabilities-baseline.json")
}

/**
 * The baseline is a ceiling, not a snapshot: a number above it fails, and a number below it means the file
 * should be lowered deliberately. A gate that auto-updates itself is a meter that cannot measure anything.
 */
export function compareWithBaseline(
  report: PlatformAuditReport,
  baseline: {
    machineImports: number
    filesWithMachineImports: number
    hiddenFiles?: number
    hiddenEdges?: number
    hiddenByPackage?: Record<string, number>
  },
): string[] {
  const errors: string[] = []
  if (report.machineImports > baseline.machineImports) {
    errors.push(
      `machine builtins imported by a node platform.ts rose to ${report.machineImports} (baseline ${baseline.machineImports})`,
    )
  }
  if (report.filesWithMachineImports > baseline.filesWithMachineImports) {
    errors.push(
      `platform.ts files reaching the machine directly rose to ${report.filesWithMachineImports} (baseline ${baseline.filesWithMachineImports})`,
    )
  }
  if (baseline.pathImports !== undefined && report.pathImports > baseline.pathImports) {
    errors.push(
      `node:path imported directly by a node platform.ts rose to ${report.pathImports} (baseline ${baseline.pathImports})`,
    )
  }
  if (baseline.pathFiles !== undefined && report.pathFiles > baseline.pathFiles) {
    errors.push(
      `platform.ts files importing node:path rose to ${report.pathFiles} (baseline ${baseline.pathFiles})`,
    )
  }
  if (baseline.hiddenFiles !== undefined && report.nodesWithHiddenMachine > baseline.hiddenFiles) {
    errors.push(
      `nodes reaching a machine builtin THROUGH a workspace package rose to ${report.nodesWithHiddenMachine} (baseline ${baseline.hiddenFiles})`,
    )
  }
  if (baseline.hiddenEdges !== undefined && report.hiddenMachineEdges > baseline.hiddenEdges) {
    errors.push(
      `package x builtin edges a node reaches through a package rose to ${report.hiddenMachineEdges} (baseline ${baseline.hiddenEdges})`,
    )
  }
  // Per package, so the number says who still owes the work. A package missing from the baseline is a new
  // one reached from a node, which is exactly the edge this column exists to catch: the ceiling has to name
  // it before it can be driven down.
  if (baseline.hiddenByPackage !== undefined) {
    for (const [name, count] of Object.entries(report.hiddenByPackage)) {
      const ceiling = baseline.hiddenByPackage[name]
      if (ceiling === undefined) {
        errors.push(
          `a node now reaches the machine THROUGH ${name} (${count} builtin(s)), which the baseline does not carry — migrate it or add the package deliberately`,
        )
      } else if (count > ceiling) {
        errors.push(`${name} reaches ${count} machine builtins from node code (baseline ${ceiling})`)
      }
    }
  }
  return errors
}

if (import.meta.main) {
  const repoRoot = dirname(dirname(resolve(import.meta.filename)))
  const report = auditPlatformFiles(repoRoot)
  const asJson = process.argv.includes("--json")
  // With --json, stdout is exactly one document (the rule `print-host-ops` and `quickjs-run` follow), so the
  // per-file rows and the verdict go to stderr and the pipe stays parseable.
  const say = asJson ? console.error : console.log
  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    for (const record of report.records.filter((item) => item.machineImports.length > 0)) {
      say(
        `${record.id.padEnd(12)} ${record.machineImports.map((item) => `${item.specifier}:${item.line}`).join(" ")}`,
      )
    }
    for (const record of report.records.filter((item) => item.hiddenMachine.length > 0)) {
      say(`${record.id.padEnd(12)} via ${record.hiddenMachine.map((item) => `${item.package}->${item.specifier}`).join(" ")}`)
    }
    say(
      [
        `retained ${report.retainedNodes}`,
        `platform.ts ${report.platformFiles}`,
        `still on node: machine builtins ${report.filesWithMachineImports} files / ${report.machineImports} imports`,
        `on the capability surface ${report.filesUsingCapabilities}`,
        `node:path still imported directly ${report.pathFiles} files / ${report.pathImports} imports`,
        `machine builtins reached THROUGH a package ${report.nodesWithHiddenMachine} nodes / ${report.hiddenMachineEdges} edges (${
          Object.entries(report.hiddenByPackage)
            .map(([name, count]) => `${name.replace("@xiranite/", "")} ${count}`)
            .join(", ") || "none"
        })`,
      ].join(" — "),
    )
  }

  const path = baselinePath(repoRoot)
  if (process.argv.includes("--update-baseline")) {
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          machineImports: report.machineImports,
          filesWithMachineImports: report.filesWithMachineImports,
          pathImports: report.pathImports,
          pathFiles: report.pathFiles,
          hiddenFiles: report.nodesWithHiddenMachine,
          hiddenEdges: report.hiddenMachineEdges,
          hiddenByPackage: report.hiddenByPackage,
          note: "Ceiling, not snapshot: lower it when a node migrates. See scripts/audit-platform-capabilities.ts.",
        },
        null,
        2,
      )}\n`,
    )
    say(`wrote ${path}`)
  } else {
    if (!existsSync(path)) {
      console.error(`no baseline at ${path}; run bun scripts/audit-platform-capabilities.ts --update-baseline`)
      process.exit(1)
    }
    const errors = compareWithBaseline(report, JSON.parse(readFileSync(path, "utf8")))
    if (errors.length > 0) {
      for (const error of errors) console.error(`FAIL ${error}`)
      process.exit(1)
    }
    say(
      `audit:platform-capabilities OK (${report.filesUsingCapabilities}/${report.platformFiles} platform files on the surface)`,
    )
  }
}
