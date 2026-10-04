/**
 * Builds a node's WASM business implementation and stages it for the host.
 *
 * Stage layout (what `crates/xiranite-node-runtime::NodeRegistry::load` reads):
 *
 *   artifacts/plugins/<id>/manifest.json
 *   artifacts/plugins/<id>/<id>.wasm
 *
 * The same directory is what a Tauri `resources` entry ships, so the desktop host, a node CLI and a
 * packaged app read one shape (ADR-0069).
 *
 * Usage:
 *   bun scripts/build-node-wasm.ts                  # every crate under crates/nodes/
 *   bun scripts/build-node-wasm.ts dissolvef        # one node
 *
 * The build is serial (`-j 1`) because this repository's Windows dev budget requires it, and the
 * rustup toolchain is prepended to PATH rather than assumed: Homebrew's rustc on this machine has no
 * `wasm32-unknown-unknown` std, so a plain `cargo build --target wasm32-unknown-unknown` fails with
 * E0463 while `rustup target list --installed` still reports the target as installed.
 */

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "..")
const nodesRoot = join(repositoryRoot, "crates", "nodes")
const stageRoot = join(repositoryRoot, "artifacts", "plugins")
const cargoProfile = "wasm"
const wasmTarget = "wasm32-unknown-unknown"

interface NodeBuild {
  nodeId: string
  manifestPath: string
  wasmPath: string
  bytes: number
  sha256: string
}

function toolchainPath(): string {
  // `rustup show` is the only stable way to find the active toolchain's bin directory without
  // shelling through the `rustup` shim for every cargo invocation. `Bun.spawnSync` returns a
  // synchronous result whose stdout is a buffer, so it is decoded with `toString()`.
  const home = Bun.spawnSync(["rustup", "show", "home"]).stdout.toString().trim()
  const active = Bun.spawnSync(["rustup", "show", "active-toolchain"]).stdout.toString().trim().split(" ")[0]
  const bin = join(home, "toolchains", active, "bin")
  return existsSync(join(bin, "cargo")) ? `${bin}:${process.env.PATH ?? ""}` : process.env.PATH ?? ""
}

async function listNodeIds(requested: string[]): Promise<string[]> {
  if (requested.length > 0) return requested
  const entries = await readdir(nodesRoot, { withFileTypes: true })
  return entries.filter(entry => entry.isDirectory() && existsSync(join(nodesRoot, entry.name, "Cargo.toml"))).map(entry => entry.name).sort()
}

async function cargoBuild(nodeId: string): Promise<void> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PATH: toolchainPath() }
  if (Bun.which("sccache")) env.RUSTC_WRAPPER = "sccache"
  const command = ["cargo", "build", "-j", "1", "--profile", cargoProfile, "--target", wasmTarget, "-p", nodeId]
  console.log(`> ${command.join(" ")}`)
  const child = Bun.spawn(command, { cwd: repositoryRoot, env, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) {
    process.stderr.write(stdout)
    process.stderr.write(stderr)
    throw new Error(`cargo build for ${nodeId} exited ${code}`)
  }
}

async function findArtifact(nodeId: string): Promise<string> {
  const profileDir = join(repositoryRoot, "target", wasmTarget, cargoProfile)
  // Rust names a wasm32 cdylib after the lib name; a `lib`-prefixed variant shows up for some
  // target/profile combinations, so the file is discovered rather than assumed.
  for (const candidate of [`${nodeId}.wasm`, `lib${nodeId}.wasm`]) {
    const path = join(profileDir, candidate)
    if (existsSync(path)) return path
  }
  const listed = existsSync(profileDir) ? (await readdir(profileDir)).filter(name => name.endsWith(".wasm")).join(", ") || "(none)" : "(profile dir missing)"
  throw new Error(`no ${nodeId}.wasm under ${profileDir}; found: ${listed}`)
}

async function stage(nodeId: string): Promise<NodeBuild> {
  const manifestPath = join(nodesRoot, nodeId, "manifest.json")
  if (!existsSync(manifestPath)) throw new Error(`${nodeId} has no manifest.json in crates/nodes/${nodeId}`)
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { id: string; wasm: string }
  if (manifest.id !== nodeId) throw new Error(`manifest id "${manifest.id}" does not match node directory "${nodeId}"`)

  const artifact = await findArtifact(nodeId)
  const bytes = await readFile(artifact)
  const directory = join(stageRoot, nodeId)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, manifest.wasm), bytes)
  await copyFile(manifestPath, join(directory, "manifest.json"))

  return {
    nodeId,
    manifestPath: join(directory, "manifest.json"),
    wasmPath: join(directory, manifest.wasm),
    bytes: (await stat(join(directory, manifest.wasm))).size,
    sha256: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
  }
}

async function main(): Promise<number> {
  const requested = process.argv.slice(2).filter(argument => !argument.startsWith("-"))
  const ids = await listNodeIds(requested)
  if (ids.length === 0) {
    console.error(`no nodes to build: ${nodesRoot} is empty and no id was given`)
    return 2
  }
  const builds: NodeBuild[] = []
  for (const id of ids) {
    await cargoBuild(id)
    builds.push(await stage(id))
  }
  for (const build of builds) {
    console.log(`${build.nodeId}\t${build.bytes} bytes\t${build.sha256}\t${build.wasmPath}`)
  }
  console.log(`staged ${builds.length} node plugin(s) under ${stageRoot}`)
  return 0
}

if (import.meta.main) {
  process.exitCode = await main().catch(error => {
    console.error(String(error instanceof Error ? error.message : error))
    return 1
  })
}

export { stage as stageNodePlugin, listNodeIds }
export type { NodeBuild }
