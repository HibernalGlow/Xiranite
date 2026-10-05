/**
 * The frontend half of a route A flavour (ADR-0069 §Standalone, ADR-0074 §5).
 *
 * A flavour is two artifacts, not one. The backend half is the generated registration table
 * (`crates/xiranite-scripted-nodes/src/registration.rs`), and `scripts/build-node-flavor.ts` already owns
 * that one. The frontend half is the *set of node UIs that exist in the bundle*: `src/main.tsx` renders its
 * node rail, module library and dashboards from `MODULE_REGISTRY`, which spreads
 * `PACKAGE_MODULES` out of a checked-in generated file. The webview never asks the host "which nodes are
 * there", so a host that serves one node behind the full table ships a product with 27 entries that open
 * into failing operation calls. Shrinking the bundle is therefore a correctness step, not a size step.
 *
 * The lever is build-time and already exists: `XIRANITE_BUILD_ONLY_NODES` is read by
 * `scripts/generate-node-registries.ts`, which rewrites four checked-in generated files. Four, because one
 * node list feeds the webview table, the runtime spec table the headless faces read, the CLI command table,
 * and the external-launch registry — so a subset build dirties all of them and must give all of them back,
 * exactly like `registration.rs`. Hence this module: snapshot bytes, run the generator under the subset,
 * restore byte-for-byte, and verify by digest.
 *
 * It restores from the bytes read at start-up rather than `git checkout HEAD --` for the same reason the
 * host half does: another lane may hold uncommitted work in one of these files, and restoring from HEAD
 * would silently drop it.
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * The files `scripts/generate-node-registries.ts` writes. Listed here rather than discovered, so a fifth
 * generated artifact has to be added to this array to take part in the restore discipline — an unlisted
 * file would be left dirty in the tree with no error anywhere.
 */
export const FRONTEND_GENERATED_ARTIFACTS: readonly string[] = [
  "packages/runtime/src/node-runner.generated.ts",
  "src/components/modules/packageModules.generated.ts",
  "packages/cli/src/node-cli-registry.generated.ts",
  "external_node_launch_registry.generated.go",
]

export interface ArtifactSnapshot {
  path: string
  bytes: Uint8Array
  digest: string
}

export function digestOf(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export async function snapshotFrontendArtifacts(repoRoot: string): Promise<ArtifactSnapshot[]> {
  const snapshots: ArtifactSnapshot[] = []
  for (const relative of FRONTEND_GENERATED_ARTIFACTS) {
    const bytes = await readFile(join(repoRoot, relative))
    snapshots.push({ path: relative, bytes, digest: digestOf(bytes) })
  }
  return snapshots
}

/**
 * Write every snapshot back and report the ones that did not come back byte-identical. Returned rather
 * than thrown: the caller's `finally` has to be able to print all four verdicts, and a throw from here
 * would replace the real failure (a build that did not produce a flavour) with a restore detail.
 */
export async function restoreFrontendArtifacts(
  repoRoot: string,
  snapshots: readonly ArtifactSnapshot[],
): Promise<Array<{ path: string; restored: string; expected: string }>> {
  const mismatches: Array<{ path: string; restored: string; expected: string }> = []
  for (const snapshot of snapshots) {
    await writeFile(join(repoRoot, snapshot.path), snapshot.bytes)
    const restored = digestOf(await readFile(join(repoRoot, snapshot.path)))
    if (restored !== snapshot.digest) {
      mismatches.push({ path: snapshot.path, restored: restored.slice(0, 12), expected: snapshot.digest.slice(0, 12) })
    }
  }
  return mismatches
}

/**
 * The environment that makes the frontend build one flavour.
 *
 * Two keys, deliberately paired: filtering the node table without redirecting the output would overwrite the
 * `dist/` the full app is served from, and redirecting the output without the filter would just build the
 * same 28-node app into another folder. `vite.config.ts` reads the second,
 * `scripts/generate-node-registries.ts` reads the first.
 */
export function frontendSubsetEnv(nodes: readonly string[], outDir: string | null = null): Record<string, string> {
  const env: Record<string, string> = { XIRANITE_BUILD_ONLY_NODES: [...new Set(nodes)].join(",") }
  if (outDir !== null) env["XIRANITE_BUILD_OUT_DIR"] = outDir
  return env
}

/** The bundle directory a flavour owns, next to `dist/` rather than inside it. */
export function flavorOutDir(nodes: readonly string[]): string {
  return `dist-flavors/${[...new Set(nodes)].sort().join("+")}`
}

/**
 * Node ids the generated webview table actually serves. Read from the loader object rather than
 * `PACKAGE_MODULES`, because the loader map is what decides whether a node UI is in the bundle graph at
 * all; a metadata row without a loader would already be a broken flavour.
 *
 * The shape is stable by construction: the generator emits `  <id>: () => import("@/nodes/<id>/entry")`.
 */
export function frontendNodeIds(tableText: string): string[] {
  const block = /export const packageModuleLoaders = \{([\s\S]*?)\n\}/.exec(tableText)?.[1] ?? ""
  return [...block.matchAll(/^ {2}("?)([a-z][a-z0-9]*)\1:\s*\(\)\s*=>\s*import\(/gm)].map((found) => found[2] as string)
}

/**
 * Symmetric subset check, mirroring `flavourMismatch` on the host side: too few ids is a silently shrunken
 * flavour, too many means the subset never reached the bundle, and both look like a green build.
 */
export function frontendSubsetMismatch(
  requested: readonly string[],
  present: readonly string[],
): { expected: string[]; present: string[] } | null {
  const expected = [...new Set(requested)].sort()
  const actual = [...new Set(present)].sort()
  return expected.join("|") === actual.join("|") ? null : { expected, present: actual }
}

/**
 * Regenerate the four tables for `nodes` and return the webview table's text, so the caller can assert what
 * it got before anything downstream reads it. Runs on `git`-clean-by-assumption paths: this is the write
 * step, and the caller owns the snapshot taken before it.
 */
export function regenerateFrontendTables(repoRoot: string, nodes: readonly string[]): string {
  const generator = join(repoRoot, "scripts", "generate-node-registries.ts")
  execFileSync("bun", [generator], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, ...frontendSubsetEnv(nodes) },
  })
  return readWebviewTable(repoRoot)
}

// Read synchronously on purpose: the caller needs the table inside a `finally`-guarded window, and awaiting
// across that boundary would let a concurrent lane's write slip between the generator run and the assertion.
export function readWebviewTable(repoRoot: string): string {
  return readFileSync(join(repoRoot, "src", "components", "modules", "packageModules.generated.ts"), "utf8")
}

/**
 * Diagnostic entry point: `bun scripts/lib/node-flavor-frontend.ts --node <id> [--build] [--out-dir <dir>]`.
 *
 * It exists because the frontend half has a measurement use that is not a build: "what would this node's
 * bundle cost, and does the subset table really shrink?" Running it also proves the restore window is safe
 * on a node whose *host* policy has not been named yet — `build-node-flavor.ts` refuses those at its step 1,
 * and that refusal is correct for a packageable flavour but would otherwise hide the frontend half entirely.
 * `--build` is the only arm that runs `vite build`, and it always writes to its own out dir so the shared
 * `dist/` the full app is served from is never the thing under test.
 */
if (import.meta.main) {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | null => {
    const at = argv.indexOf(name)
    return at === -1 ? null : (argv[at + 1] ?? null)
  }
  const nodes = argv.flatMap((value, at) => (value === "--node" ? [argv[at + 1] ?? ""] : []))
  if (nodes.length === 0 || nodes.some((id) => id === "")) {
    console.error("usage: bun scripts/lib/node-flavor-frontend.ts --node <id> [--node <id> …] [--build] [--out-dir <dir>]")
    process.exit(2)
  }
  const build = argv.includes("--build")
  const outDir = flag("--out-dir") ?? flavorOutDir(nodes)
  const root = join(import.meta.dirname, "..", "..")
  const snapshots = await snapshotFrontendArtifacts(root)
  let failures: string[] = []
  try {
    process.env["XIRANITE_BUILD_ONLY_NODES"] = [...new Set(nodes)].join(",")
    process.env["XIRANITE_BUILD_OUT_DIR"] = outDir
    const table = regenerateFrontendTables(root, nodes)
    const ids = frontendNodeIds(table)
    const drift = frontendSubsetMismatch(nodes, ids)
    console.log(`webview table for [${nodes.join(", ")}] -> ${ids.length} loader(s): ${ids.join(", ") || "none"}`)
    if (drift !== null) throw new Error(`table lists [${drift.present.join(", ")}]`)
    if (build) {
      // No `--outDir` flag here on purpose: this has to go down the same path a packaged flavour takes,
      // which is `bun run build` reading `XIRANITE_BUILD_OUT_DIR` in `vite.config.ts`.
      console.log(`$ vite build  (XIRANITE_BUILD_OUT_DIR=${outDir})`)
      execFileSync("bunx", ["vite", "build"], { cwd: root, stdio: "inherit" })
      const measured = measureTree(join(root, outDir))
      console.log(`built ${outDir}: ${measured.files} file(s), ${(measured.bytes / 1e6).toFixed(2)} MB of files`)
    }
  } catch (error) {
    failures = [(error as Error).message]
  } finally {
    delete process.env["XIRANITE_BUILD_ONLY_NODES"]
    delete process.env["XIRANITE_BUILD_OUT_DIR"]
    const mismatches = await restoreFrontendArtifacts(root, snapshots)
    for (const mismatch of mismatches) console.error(`FATAL: ${mismatch.path} ${mismatch.restored} != ${mismatch.expected}`)
    console.log(`restored ${snapshots.length} checked-in artifact(s)${mismatches.length === 0 ? ", digests verified" : ""}`)
    process.exit(failures.length > 0 || mismatches.length > 0 ? 1 : 0)
  }
}

/** Sum of file bytes under one directory. A byte count, not `du`'s block count: the comparison that matters
 *  here is one bundle against another, and block size would drown a 50 KB difference. */
function measureTree(dir: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = measureTree(path)
      files += nested.files
      bytes += nested.bytes
    } else if (entry.isFile()) {
      files += 1
      bytes += statSync(path).size
    }
  }
  return { files, bytes }
}
