#!/usr/bin/env bun
/**
 * Bundles the polyfill probe the way `scripts/build-node-bundles.ts` bundles a node: the alias list is **read
 * live** from `packages/quickjs-shims/src/surface.ts`, never copied. That is the point — if `node:buffer` stops
 * being an aliased specifier, `safe-buffer` inside `string_decoder` would keep a bare `require("buffer")` in the
 * bundle, the realm could not resolve it, and the run would test the wrong thing (or nothing).
 *
 * Usage: bun spikes/polyfill-realm-probe/build.ts
 * Output: spikes/polyfill-realm-probe/out/probe.js
 *
 * Then run it in the embedded host:
 *   target/debug/quickjs-run spikes/polyfill-realm-probe/out/probe.js run - '{}' .
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { BARE_BUILTINS, SHIMMED_BUILTINS } from "../../packages/quickjs-shims/src/surface.ts"

const repoRoot = join(import.meta.dirname, "..", "..")
const shimDir = join(repoRoot, "packages/quickjs-shims/src")
const outDir = join(import.meta.dirname, "out")
const probeEntry = join(import.meta.dirname, "src", "probe.ts")

const aliases: Record<string, string> = {}
for (const [specifier, file] of Object.entries(SHIMMED_BUILTINS)) aliases[specifier] = join(shimDir, file)
for (const [bare, file] of Object.entries(BARE_BUILTINS)) aliases[bare] = join(shimDir, file)

// Positive control for the alias tables themselves: this probe exists to test the three swapped modules, so a
// table that no longer maps them must fail here rather than bundle the Node original and pass.
for (const specifier of ["node:buffer", "node:events", "node:string_decoder"]) {
  if (!(specifier in aliases)) {
    console.error(`build.ts: surface.ts no longer aliases ${specifier} — the probe would test nothing`)
    process.exit(1)
  }
}

await mkdir(outDir, { recursive: true })

// The realm prelude (process/Buffer/global) rides in as an explicit import ahead of the body, the same
// synthesized-entry trick the real bundle build uses.
const synth = join(outDir, "probe-entry.ts")
await writeFile(synth, `import ${JSON.stringify(join(shimDir, "index.ts"))}\nexport * from ${JSON.stringify(probeEntry)}\n`)

const esbuildBin = join(repoRoot, "node_modules/.bin/esbuild")
const args = [
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
  execFileSync(esbuildBin, args, { stdio: "inherit" })
} catch (error) {
  console.error(`build.ts: esbuild failed: ${(error as { status?: number }).status ?? error}`)
  process.exit(1)
}

const bundle = readFileSync(join(outDir, "probe.js"), "utf8")

/** Any surviving builtin import in the output is an unmapped specifier the realm cannot resolve. */
function scanForUnmapped(source: string): string[] {
  const pattern = /(?:from|require\()\s*["'](node:[A-Za-z_/]+|buffer|events|string_decoder|path|fs|util|os|crypto|url|stream|assert|constants|module|zlib|readline|worker_threads)["']/g
  const found: string[] = []
  for (const match of source.matchAll(pattern)) found.push(match[1]!)
  return [...new Set(found)].sort()
}

const unmapped = scanForUnmapped(bundle)
// The gauge must be able to see a violation: run the same scan over the probe **source**, which does import
// `node:buffer`/`node:events`/`node:string_decoder`, and refuse a report that comes back empty.
const control = scanForUnmapped(readFileSync(probeEntry, "utf8"))
console.log(`built ${bundle.length} bytes; unmapped-in-bundle=${JSON.stringify(unmapped)} control-in-source=${JSON.stringify(control)}`)
if (control.length < 3) {
  console.error("build.ts: the unmapped-import scan found nothing even in the source — the gauge is blind, not the bundle")
  process.exit(1)
}
if (unmapped.length > 0) {
  console.error(`build.ts: ${unmapped.length} builtin specifier(s) escaped the alias table: ${unmapped.join(", ")}`)
  process.exit(1)
}
