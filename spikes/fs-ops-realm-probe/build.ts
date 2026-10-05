#!/usr/bin/env bun
/**
 * Bundles the fs-ops probe with the **same** alias tables `scripts/build-node-bundles.ts` reads from
 * `packages/quickjs-shims/src/surface.ts`, so a specifier that stops being mapped fails here instead of resolving
 * to the Node builtin under Vitest and passing for the wrong reason.
 *
 * Usage: bun spikes/fs-ops-realm-probe/build.ts
 * Output: spikes/fs-ops-realm-probe/out/probe.js
 *
 * Run it in the embedded host against a throwaway granted directory:
 *   dir=$(mktemp -d) && target/debug/quickjs-run spikes/fs-ops-realm-probe/out/probe.js run - \
 *     "{\"dir\":\"$dir\"}" "$dir"
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

// Positive control: this probe exists to exercise the newly wired fs/os operations. If the tables stop mapping
// the modules it imports, the bundle would carry a real `node:fs` and answer from the host process instead.
for (const specifier of ["node:fs", "node:fs/promises", "node:os"]) {
  if (!(specifier in aliases)) {
    console.error(`build.ts: surface.ts no longer aliases ${specifier} — the probe would test the Node builtin`)
    process.exit(1)
  }
}

await mkdir(outDir, { recursive: true })

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

try {
  execFileSync(esbuildBin, args, { stdio: "inherit" })
} catch (error) {
  console.error(`build.ts: esbuild failed: ${(error as { status?: number }).status ?? error}`)
  process.exit(1)
}

const bundle = readFileSync(join(outDir, "probe.js"), "utf8")

function scanForUnmapped(source: string): string[] {
  const pattern = /(?:from|require\()\s*["'](node:[A-Za-z_/]+|buffer|events|string_decoder|path|fs|util|os|crypto|url|stream|assert|module|zlib|readline|worker_threads)["']/g
  const found: string[] = []
  for (const match of source.matchAll(pattern)) found.push(match[1]!)
  return [...new Set(found)].sort()
}

const unmapped = scanForUnmapped(bundle)
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
