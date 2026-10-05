#!/usr/bin/env bun
/**
 * Publish the built node bundles where the **embedded** executor reads them.
 *
 * ADR-0074 §6 says the host binary carries every linked node, and `crates/xiranite-quickjs-executor`
 * expresses that with `include_str!("../bundles/<id>.js")` at the registration site. `include_str!` is a
 * *compile-time* read: the artifact must exist in the source tree before `cargo build` runs, which makes
 * `crates/xiranite-quickjs-executor/bundles/` a checked-in generated directory, not a build cache. This
 * script is the only thing allowed to write it.
 *
 * Input is the manifest `bun run build:node-bundles` produces (`artifacts/node-bundles/manifest.json`), so
 * the universe here is derived, never hand-maintained: a node enters `bundles/` exactly when its host bundle
 * (core `run` plus, for a platform node, `createRuntime`) built successfully.
 *
 * Usage:
 *   bun scripts/embed-node-bundles.ts          write bundles/ from the current manifest
 *   bun scripts/embed-node-bundles.ts --check  exit 1 if the tree and the manifest disagree (gate mode)
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

interface BundleArtifact {
  path: string
  bytes: number
  ok: boolean
  error: string | null
}

interface ManifestNode {
  id: string
  run: string | null
  createRuntime: string | null
  host: BundleArtifact | null
}

interface Manifest {
  generatedAt: string
  scope: string
  nodes: Record<string, ManifestNode>
}

const repoRoot = resolve(dirname(import.meta.path), "..")
const manifestPath = join(repoRoot, "artifacts", "node-bundles", "manifest.json")
const bundleSourceRoot = join(repoRoot, "artifacts", "node-bundles")
const embedDir = join(repoRoot, "crates", "xiranite-quickjs-executor", "bundles")
const indexName = "index.json"

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
  } catch (error) {
    throw new Error(`read ${manifestPath} first with \`bun run build:node-bundles\` (${(error as Error).message})`)
  }
}

/** The nodes that have a usable embedded artifact: a registered `run` and a host bundle that built. */
function embeddable(manifest: Manifest): ManifestNode[] {
  return Object.values(manifest.nodes)
    .filter((node) => node.run !== null && node.host?.ok)
    .sort((left, right) => left.id.localeCompare(right.id))
}

interface IndexEntry {
  id: string
  file: string
  run: string
  createRuntime: string | null
  bytes: number
  sha256: string
  /** Where the artifact came from, so a stale file is traceable to its producer. */
  source: string
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check")
  const manifest = await readManifest()
  const wanted = embeddable(manifest)

  const entries: IndexEntry[] = []
  const writes: Array<{ path: string; text: string }> = []
  for (const node of wanted) {
    const source = join(repoRoot, node.host!.path)
    const text = await readFile(source, "utf8")
    entries.push({
      id: node.id,
      file: `${node.id}.js`,
      run: node.run!,
      createRuntime: node.createRuntime,
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
      source: node.host!.path,
    })
    writes.push({ path: join(embedDir, `${node.id}.js`), text })
  }

  const index = {
    generatedAt: new Date().toISOString(),
    producer: "scripts/embed-node-bundles.ts",
    manifestGeneratedAt: manifest.generatedAt,
    nodes: entries,
  }
  const indexText = `${JSON.stringify(index, null, 2)}\n`

  if (check) {
    const problems: string[] = []
    const current = await readdir(embedDir).catch(() => [])
    const expected = new Set([...entries.map((entry) => entry.file), indexName])
    for (const name of current.filter((name) => !name.startsWith("."))) {
      if (!expected.has(name)) problems.push(`stale file in bundles/: ${name}`)
    }
    for (const entry of entries) {
      const onDisk = await readFile(join(embedDir, entry.file), "utf8").catch(() => null)
      if (onDisk === null) problems.push(`missing embedded bundle: ${entry.file}`)
      else if (sha256(onDisk) !== entry.sha256) problems.push(`embedded bundle is stale vs the manifest: ${entry.file}`)
    }
    const onDiskIndex = await readFile(join(embedDir, indexName), "utf8").catch(() => null)
    if (onDiskIndex === null) problems.push(`missing ${indexName}`)
    else {
      const recorded = ((JSON.parse(onDiskIndex).nodes ?? []) as IndexEntry[]).map((n) => `${n.id}:${n.sha256}`).join(",")
      const fresh = entries.map((n) => `${n.id}:${n.sha256}`).join(",")
      if (recorded !== fresh) problems.push(`${indexName} does not describe the current bundles/`)
    }
    if (problems.length > 0) {
      for (const problem of problems) console.error(`FAIL ${problem}`)
      throw new Error(`embed:node-bundles --check found ${problems.length} problem(s).`)
    }
    console.log(`OK bundles/: ${entries.length} embedded node bundle(s), all matching the manifest.`)
    return
  }

  await mkdir(embedDir, { recursive: true })
  // Drop leftovers from nodes that no longer qualify, so `include_str!` can never read a retired bundle.
  const keep = new Set([...writes.map((write) => write.path), join(embedDir, indexName)])
  for (const name of await readdir(embedDir).catch(() => [])) {
    const path = join(embedDir, name)
    if (!keep.has(path) && !name.startsWith(".")) await rm(path, { force: true })
  }
  for (const write of writes) {
    await writeFile(write.path, write.text)
    // Compare bytes to bytes: the bundles carry non-ASCII text, so a character count would read smaller
    // than the file size and turn a whole write into a false alarm.
    const onDisk = await readFile(write.path)
    if (onDisk.byteLength !== (await stat(write.path)).size || sha256(onDisk.toString("utf8")) !== undefined && onDisk.toString("utf8") !== write.text) {
      throw new Error(`${write.path} did not land whole`)
    }
  }
  await writeFile(join(embedDir, indexName), indexText)

  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  console.log(
    `wrote ${embedDir.replace(`${repoRoot}/`, "")}: ${entries.length} bundle(s), ${(totalBytes / 1048576).toFixed(2)} MiB, index ${indexName}`,
  )
}

await main()
