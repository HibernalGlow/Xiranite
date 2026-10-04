#!/usr/bin/env bun
/**
 * Prepare the out-of-workspace build copy of `crates/xiranite-cli-runtime`.
 *
 * The root `Cargo.toml` belongs to the workspace-unification lane and is still uncommitted, so the new crate
 * cannot be added to `members` yet. Copying it under `artifacts/` (which cargo never looks at) with its own
 * `[workspace]` table and absolute path deps lets `cargo test` run against the real model, and the copy is
 * rebuilt from the sources every time so nothing drifts.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
// Both shared face libraries are outside the root workspace for the same reason, so one preparer serves both:
// `bun scripts/verify-cli-runtime-out-of-workspace.ts xiranite-tui-runtime`.
const crate = process.argv[2] ?? "xiranite-cli-runtime"
if (!["xiranite-cli-runtime", "xiranite-tui-runtime"].includes(crate)) {
  throw new Error(`unknown crate ${crate}; the preparer copies a crate that keeps its deps as path references`)
}
const source = join(repoRoot, "crates", crate)
const target = join(repoRoot, "artifacts", `${crate}-verify`)

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })

const manifest = (await readFile(join(target, "Cargo.toml"), "utf8")).replaceAll(
  'path = "../xiranite-plugin-api"',
  `path = ${JSON.stringify(join(repoRoot, "crates", "xiranite-plugin-api"))}`,
)
await writeFile(join(target, "Cargo.toml"), `${manifest}\n[workspace]\n`, "utf8")
console.log(`prepared ${target} — run: cd ${relative(repoRoot, target)} && cargo test -j 1 --all-features`)
