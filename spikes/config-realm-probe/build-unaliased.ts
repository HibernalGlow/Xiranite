#!/usr/bin/env bun
/**
 * The **negative arm** of the probe: bundle the same `src/probe.ts` WITHOUT the `@xiranite/config/node`
 * realm alias, to measure what a realm actually does when `HOST_SERVED_PACKAGES` has no entry for it.
 * Recorded in `docs/migration/quickjs-substrate-evaluation.md` §15.6.2 as the cost of the three
 * registration lines still sitting in other lanes' uncommitted files.
 *
 * Measured 2026-10-05: load succeeds (no `no setter for property`), then every action — `load`, `exists`,
 * `merge`, `writeNode` — dies on `quickjs-shim: fs/promises.realpath is not implemented`, because
 * `packages/config/src/node.ts` canonicalizes with `realpath` before it touches the lock. `open` is behind
 * that and is never reached. The aliased bundle, same harness and same granted directory, returns
 * `success: true`.
 *
 * Usage:
 *   bun spikes/config-realm-probe/build-unaliased.ts
 *   target/debug/quickjs-run spikes/config-realm-probe/out/probe-unaliased.js run - \
 *     '{"action":"writeNode","dir":"<granted dir>"}' <granted dir> --node-id probe --services config
 *
 * Output: spikes/config-realm-probe/out/probe-unaliased.js
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  BARE_BUILTINS,
  BUFFER_GLOBAL,
  PROCESS_GLOBAL,
  SHIMMED_BUILTINS,
} from "../../packages/quickjs-shims/src/surface.ts"

const repoRoot = join(import.meta.dirname, "..", "..")
const shimDir = join(repoRoot, "packages/quickjs-shims/src")
const outDir = join(import.meta.dirname, "out")
const probeEntry = join(import.meta.dirname, "src", "probe.ts")

const aliases: Record<string, string> = {}
for (const [specifier, file] of Object.entries(SHIMMED_BUILTINS)) aliases[specifier] = join(shimDir, file)
for (const [bare, file] of Object.entries(BARE_BUILTINS)) aliases[bare] = join(shimDir, file)
// The whole point: HOST_SERVED_PACKAGES is deliberately not folded in, so `@xiranite/config/node` resolves
// through node_modules to packages/config/dist/node.js — the Node transport — the way it would if the
// registration line were missing.
aliases[PROCESS_GLOBAL.specifier] = join(shimDir, PROCESS_GLOBAL.module)
aliases[BUFFER_GLOBAL.specifier] = join(shimDir, BUFFER_GLOBAL.module)
aliases.process = join(shimDir, "process.ts")
aliases.buffer = join(shimDir, "buffer.ts")

await mkdir(outDir, { recursive: true })

const synth = join(outDir, "probe-entry-unaliased.ts")
await writeFile(synth, `import ${JSON.stringify(join(shimDir, "index.ts"))}\nexport * from ${JSON.stringify(probeEntry)}\n`)

const esbuildBin = join(repoRoot, "node_modules/.bin/esbuild")
const args = [
  synth,
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${join(outDir, "probe-unaliased.js")}`,
  "--log-level=warning",
]
for (const [specifier, target] of Object.entries(aliases)) args.push(`--alias:${specifier}=${target}`)

try {
  execFileSync(esbuildBin, args, { stdio: "inherit" })
} catch (error) {
  console.error(`build-unaliased: esbuild failed: ${(error as { status?: number }).status ?? error}`)
  process.exit(1)
}

const bundle = readFileSync(join(outDir, "probe-unaliased.js"), "utf8")
const signals = {
  // `hostConfigTransport` lives only in the realm binding.
  realmBinding: bundle.includes("hostConfigTransport") ? "yes" : "no",
  // `ELOCKED` and the temp-file prefix are literals only in the Node transport (`packages/config/src/node.ts`).
  nodeTransport: bundle.includes("ELOCKED") && bundle.includes(".xiranite-tmp-") ? "yes" : "no",
  // The Node transport's call to fs/promises `open` must be bundled, not left as an external import.
  openImported: bundle.includes('from "node:fs/promises"') ? "left-as-import" : "bundled",
}
console.log(`built ${bundle.length} bytes; signals=${JSON.stringify(signals)}`)
// Positive control: a bundle that still carries the realm binding would not be measuring the missing line.
if (signals.nodeTransport !== "yes" || signals.realmBinding === "yes") {
  console.error("build-unaliased: bundle did not pick up the Node transport — the measurement would be meaningless")
  process.exit(1)
}
