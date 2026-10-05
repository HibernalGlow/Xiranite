#!/usr/bin/env bun
/**
 * Bundles the probe the way `scripts/build-node-bundles.ts` bundles a node, using the **same** alias tables
 * read live from `packages/quickjs-shims/src/surface.ts`. Reading the tables instead of copying them is the
 * point: if `HOST_SERVED_PACKAGES` stops mapping `@xiranite/config/node` to the realm binding, this probe
 * bundles the Node transport instead, and the run below fails on `open` rather than silently testing the
 * wrong thing.
 *
 * Usage: bun spikes/config-realm-probe/build.ts
 * Output: spikes/config-realm-probe/out/probe.js
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  BARE_BUILTINS,
  BUFFER_GLOBAL,
  HOST_SERVED_PACKAGES,
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
for (const [pkg, file] of Object.entries(HOST_SERVED_PACKAGES)) aliases[pkg] = join(shimDir, file)
aliases[PROCESS_GLOBAL.specifier] = join(shimDir, PROCESS_GLOBAL.module)
aliases[BUFFER_GLOBAL.specifier] = join(shimDir, BUFFER_GLOBAL.module)
aliases.process = join(shimDir, "process.ts")
aliases.buffer = join(shimDir, "buffer.ts")

await mkdir(outDir, { recursive: true })

// The realm prelude (process/Buffer/global/crypto) rides in as an explicit import ahead of the body, the
// same synthesized-entry trick the real bundle build uses.
const synth = join(outDir, "probe-entry.ts")
await writeFile(synth, `import ${JSON.stringify(join(shimDir, "index.ts"))}\nexport * from ${JSON.stringify(probeEntry)}\n`)

const esbuildBin = join(repoRoot, "node_modules/.bin/esbuild")
const args = [
  esbuildBin,
  synth,
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${join(outDir, "probe.js")}`,
  "--log-level=warning",
]
for (const [specifier, target] of Object.entries(aliases)) args.push(`--alias:${specifier}=${target}`)

// Node APIs only (ADR-0075): the runner is `bun` or `node`, and the file must not read as Bun-only.
try {
  execFileSync(esbuildBin, args.slice(1), { stdio: "inherit" })
} catch (error) {
  console.error(`build.ts: esbuild failed: ${(error as { status?: number }).status ?? error}`)
  process.exit(1)
}

const bundle = readFileSync(join(outDir, "probe.js"), "utf8")
const signals = {
  realmBinding: bundle.includes("beginUpdate") ? "yes" : "no",
  nodeLockCode: bundle.includes("ELOCKED") ? "yes" : "no",
  npmLock: bundle.includes("proper-lockfile") ? "yes" : "no",
}
console.log(`built ${bundle.length} bytes; signals=${JSON.stringify(signals)}`)
// The gate: a probe that bundled the Node transport is not testing the realm path at all.
if (signals.realmBinding !== "yes" || signals.nodeLockCode !== "no") {
  console.error("build.ts: the bundle did not pick up the realm config binding — refusing a misleading run")
  process.exit(1)
}
