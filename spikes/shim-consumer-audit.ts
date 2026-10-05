#!/usr/bin/env bun
/**
 * Who still imports each QuickJS shim, now that `@xiranite/config` no longer drags a lock implementation
 * into every platform closure.
 *
 * `docs/migration/quickjs-substrate-evaluation.md` §15.3 parked this question: the hand-written shim files
 * were justified by "the config lock path needs them", and §15.6 warned that writing polyfills for something
 * about to move to the host is furnishing a room that is being demolished. The move has happened, so the bill
 * gets read again against the current graph.
 *
 * Method: bundle every retained node's `core.ts` and `platform.ts` the way `scripts/build-node-bundles.ts`
 * does (same alias tables read live from `surface.ts`, same realm prelude), but keep `--metafile` instead of
 * deleting it, then read the importer edges back. An alias only lands in the graph when some input actually
 * imports that specifier, so "no importer edge" is a statement about the node set, not about file quality.
 *
 * Nothing is written inside the repository; artifacts go to `../.shim-attrib/`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

import {
  BARE_BUILTINS,
  BUFFER_GLOBAL,
  HOST_SERVED_PACKAGES,
  PROCESS_GLOBAL,
  SHIMMED_BUILTINS,
  REALM_PACKAGE_ALIASES,
} from "../packages/quickjs-shims/src/surface.ts"

const repoRoot = process.cwd()
const shimDir = join(repoRoot, "packages/quickjs-shims/src")
const outDir = join(repoRoot, "..", ".shim-attrib")
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const aliases: Record<string, string> = {}
for (const [specifier, file] of Object.entries(SHIMMED_BUILTINS)) aliases[specifier] = join(shimDir, file)
for (const [bare, file] of Object.entries(BARE_BUILTINS)) aliases[bare] = join(shimDir, file)
for (const [pkg, file] of Object.entries(HOST_SERVED_PACKAGES)) aliases[pkg] = join(shimDir, file)
aliases[PROCESS_GLOBAL.specifier] = join(shimDir, PROCESS_GLOBAL.module)
aliases[BUFFER_GLOBAL.specifier] = join(shimDir, BUFFER_GLOBAL.module)
aliases.process = join(shimDir, "process.ts")
aliases.buffer = join(shimDir, "buffer.ts")
// Same table the bundle build uses, so this audit measures the graph the realm actually gets. Without it the
// bare capability specifier resolves through package `exports` to the Node transport, and that transport's
// own `node:fs` / `node:crypto` imports get counted as shim consumers — an inflated and backwards number.
for (const [specifier, file] of Object.entries(REALM_PACKAGE_ALIASES)) aliases[specifier] = join(repoRoot, file)

const manifest = JSON.parse(readFileSync(join(repoRoot, "docs/xiranite-target-node-manifest.json"), "utf8")) as {
  nodes: Array<{ id: string; disposition: string }>
}
const nodeIds = manifest.nodes.filter((n) => n.disposition === "retain-rewrite").map((n) => n.id).sort()
const esbuildBin = join(repoRoot, "node_modules/.bin/esbuild")
const nodesRoot = join(repoRoot, "packages/nodes")

/** shim file -> importers, across every retained node and both faces. */
const importers = new Map<string, Set<string>>()
let built = 0
let failed = 0

for (const id of nodeIds) {
  for (const face of ["core.ts", "platform.ts"]) {
    const entry = join(nodesRoot, id, "src", face)
    let exists = true
    try {
      readFileSync(entry, "utf8")
    } catch {
      exists = false
    }
    if (!exists) continue
    const metaPath = join(outDir, `${id}.${face}.meta.json`)
    const args = [
      entry,
      "--bundle",
      "--platform=node",
      "--format=esm",
      `--outfile=${join(outDir, `${id}.${face}.js`)}`,
      `--metafile=${metaPath}`,
      "--log-level=error",
    ]
    for (const [specifier, target] of Object.entries(aliases)) args.push(`--alias:${specifier}=${target}`)
    if (spawnSync(esbuildBin, args, { encoding: "utf8" }).status !== 0) {
      failed += 1
      continue
    }
    built += 1
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      inputs?: Record<string, { imports?: Array<{ path?: string }> }>
    }
    // esbuild writes metafile input and import paths relative to the *repository* root, already clean
    // ("packages/quickjs-shims/src/host.ts"). Resolving them against the metafile's own directory was my
    // first guess and made every lookup miss — the run then reported `fs.ts` with zero consumers, an absurd
    // number that is proof the instrument is blind, not that the graph is empty. Match on the marker, and
    // keep the positive control below so a future path-shape change fails loudly instead of reporting zero.
    const MARKER = "quickjs-shims/src/"
    const shimName = (path: string | undefined): string | null => {
      if (!path) return null
      const at = path.lastIndexOf(MARKER)
      return at >= 0 ? path.slice(at + MARKER.length) : null
    }
    for (const [inputPath, input] of Object.entries(meta.inputs ?? {})) {
      const short = inputPath
      for (const imp of input.imports ?? []) {
        const file = shimName(imp.path)
        if (!file) continue
        if (!importers.has(file)) importers.set(file, new Set())
        importers.get(file)!.add(short)
      }
    }
  }
}

/* positive control: the instrument must see a consumer for a module every node face really does use. */
const control = importers.get("fs-promises.ts") ?? importers.get("fs.ts")
if (!control || control.size === 0) {
  console.error("控制组失败：node:fs 不可能零消费者，路径解析仍是错的，拒绝出报告")
  process.exit(1)
}
/**
 * A consumer edge is classified, not just counted, because "no outside package imports this file" and
 * "nothing imports this file" are different claims and the difference is exactly what a deletion decision
 * turns on. Measured the hard way: reading the flat "第一方 0" line as "deletable" put `ops.ts`+
 * `internal.ts`+`constants.ts` (909 lines) on the kill list, when all three are imported by the very shim
 * modules that are still alive (`fs.ts`, `host.ts`, `child-process.ts`) and can only go with them.
 *
 * `dist` is its own class and never counts toward "alive": esbuild resolves a workspace specifier through
 * package `exports`, which for these packages is a gitignored build output, so a node migrated an hour ago
 * can still show up as a consumer of `node:fs` from its stale `dist/platform.js`.
 */
function classify(path: string): "npm" | "stale-dist" | "internal" | "capabilities" | "live-src" {
  if (path.includes("node_modules")) return "npm"
  if (path.includes("/dist/") || path.includes("\\dist\\")) return "stale-dist"
  if (path.startsWith("packages/quickjs-shims/")) return "internal"
  if (path.startsWith("packages/host-capabilities/")) return "capabilities"
  return "live-src"
}

const rows = [...importers.entries()].sort((a, b) => b[1].size - a[1].size)
console.log(`bundles built=${built} failed=${failed}; 有消费者边的 shim 模块: ${rows.length}`)
const linesByModule: Record<string, number> = {}
for (const file of importers.keys()) {
  const source = join(shimDir, file)
  linesByModule[file] = existsSync(source) ? readFileSync(source, "utf8").split("\n").length : 0
}
const verdicts: string[] = []
const conditional: string[] = []
for (const [file, set] of rows) {
  const buckets: Record<string, string[]> = { "live-src": [], "stale-dist": [], npm: [], internal: [], capabilities: [] }
  for (const path of [...set].sort()) buckets[classify(path)].push(path)
  const alive = buckets["live-src"].length + buckets["capabilities"].length
  const label =
    alive === 0 && buckets.npm.length === 0 && buckets["stale-dist"].length === 0
      ? buckets.internal.length > 0
        ? "只剩包内引用 ⇒ 跟着引用者一起走，不能单独删"
        : "可删"
      : alive === 0 && buckets.npm.length === 0
        // Stale `dist/` is not a consumer (the measurement rule in ADR-0079), so this row is deletable in
        // principle. Saying "仍有打包依赖" here would give the wrong reason and hide the real one: the alias
        // row still has to go, and the artifact has to be rebuilt before the build can falsify it.
        ? "只剩旧产物引用 ⇒ 产物不算消费者；删的条件是别名行也撤掉并重建产物复跑构建"
        : alive === 0
          ? "第一方清零，仍有打包依赖 ⇒ 保留"
          : "仍有活引用"
  console.log(`\n${file} (${linesByModule[file]} 行)  活引用=${alive} 仅旧dist=${buckets["stale-dist"].length} npm=${buckets.npm.length} 包内=${buckets.internal.length}  ⇒ ${label}`)
  for (const path of [...buckets["live-src"], ...buckets.capabilities].slice(0, 5)) console.log(`   ${path}`)
  if (buckets["live-src"].length + buckets.capabilities.length > 5) {
    console.log(`   … 另有 ${buckets["live-src"].length + buckets.capabilities.length - 5} 个`)
  }
  if (buckets.npm.length > 0) console.log(`   打包依赖：${buckets.npm.slice(0, 3).join(", ")}`)
  if (buckets["stale-dist"].length > 0) console.log(`   旧产物(不算消费者)：${buckets["stale-dist"].slice(0, 3).join(", ")}`)
  if (label === "可删") verdicts.push(`${file} ${linesByModule[file]} 行`)
  else if (label.startsWith("只剩旧产物引用")) conditional.push(`${file} ${linesByModule[file]} 行`)
}

const served = new Set<string>([...Object.values(SHIMMED_BUILTINS), ...Object.values(BARE_BUILTINS)])
const unreferenced = [...served].filter((f) => f !== "index.ts" && !importers.has(f))
console.log(`\n完全没有任何引用边: ${unreferenced.length ? unreferenced.join(", ") : "无"}`)
console.log(`可删（含零引用边的那 ${unreferenced.length} 个，共 ${unreferenced.reduce((n, f) => n + (linesByModule[f] ?? 0), 0)} 行）`)
for (const line of verdicts) console.log(`   ${line}`)
if (conditional.length > 0) {
  console.log(`只剩旧产物引用（条件性可删：别名行也要撤，删后重建产物复跑构建）`)
  for (const line of conditional) console.log(`   ${line}`)
}

writeFileSync(join(outDir, "report.json"), JSON.stringify(Object.fromEntries(rows.map(([f, s]) => [f, [...s].sort()])), null, 2))
console.log(`明细: ${join(outDir, "report.json")}`)
