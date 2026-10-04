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
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(repoRoot, "crates", "xiranite-cli-runtime")
const target = join(repoRoot, "artifacts", "cli-runtime-verify")

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })

const manifest = (await readFile(join(target, "Cargo.toml"), "utf8")).replaceAll(
  'path = "../xiranite-plugin-api"',
  `path = ${JSON.stringify(join(repoRoot, "crates", "xiranite-plugin-api"))}`,
)
await writeFile(join(target, "Cargo.toml"), `${manifest}\n[workspace]\n`, "utf8")
console.log(`prepared ${target}`)
