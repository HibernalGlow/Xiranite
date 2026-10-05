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
 * Usage: `bun scripts/audit-platform-capabilities.ts` (report + fail if worse than the baseline),
 * `--json` for the raw record, `--update-baseline` to write the current numbers after a real improvement.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
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
  records: PlatformFileRecord[]
}

export function auditPlatformFiles(repoRoot: string): PlatformAuditReport {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "docs", "xiranite-target-node-manifest.json"), "utf8"),
  ) as { nodes: { id: string; disposition: string }[] }
  const retained = manifest.nodes.filter((node) => node.disposition === RETAINED_DISPOSITION)

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
    records,
  }
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
  baseline: { machineImports: number; filesWithMachineImports: number },
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
    say(
      [
        `retained ${report.retainedNodes}`,
        `platform.ts ${report.platformFiles}`,
        `still on node: machine builtins ${report.filesWithMachineImports} files / ${report.machineImports} imports`,
        `on the capability surface ${report.filesUsingCapabilities}`,
        `node:path still imported directly ${report.pathFiles} files / ${report.pathImports} imports`,
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
