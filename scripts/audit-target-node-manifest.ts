#!/usr/bin/env bun
// Gate for docs/xiranite-target-node-manifest.json: the single source of truth for which nodes
// survive the Rust/Tauri rewrite. Fails when the manifest, xiranite.build.toml and the node
// directories drift apart, so a decided removal cannot silently survive as dead code.
import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { getDisabledNodeIds } from "./lib/node-build-config.js"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = join(repoRoot, "docs", "xiranite-target-node-manifest.json")
const nodesRoot = join(repoRoot, "packages", "nodes")

export type Disposition = "retain-rewrite" | "drop-to-standalone" | "hold-unmigrated" | "removed"
export type WasmFeasibility = "pending-audit" | "wasm-plugin" | "wasm-with-host-io" | "rust-host" | "blocked-native" | "manual-review"

interface NodeRecord {
  id: string
  disposition: Disposition
  standalone?: string
  wasmFeasibility: WasmFeasibility
  evidence: string[]
  note?: string
}

interface Manifest {
  schemaVersion: number
  decidedBy: string[]
  policy: string
  nodes: NodeRecord[]
}

const DISPOSITIONS = new Set<string>(["retain-rewrite", "drop-to-standalone", "hold-unmigrated", "removed"])
const FEASIBILITIES = new Set<string>(["pending-audit", "wasm-plugin", "wasm-with-host-io", "rust-host", "blocked-native", "manual-review"])

const strict = process.argv.includes("--strict")
const writeSkeleton = process.argv.includes("--write")

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
}

async function nodeDirectories(): Promise<string[]> {
  const entries = await readdir(nodesRoot, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

async function main(): Promise<void> {
  const [manifest, dirs, disabled] = await Promise.all([readManifest(), nodeDirectories(), getDisabledNodeIds({ cwd: repoRoot, env: process.env })])
  const records = new Map(manifest.nodes.map((node) => [node.id, node]))
  const errors: string[] = []
  const warnings: string[] = []

  for (const id of dirs) {
    if (!records.has(id)) errors.push(`packages/nodes/${id} exists but has no manifest record`)
  }

  for (const node of manifest.nodes) {
    const dirExists = dirs.includes(node.id)
    if (!DISPOSITIONS.has(node.disposition)) errors.push(`${node.id}: unknown disposition ${JSON.stringify(node.disposition)}`)
    if (!FEASIBILITIES.has(node.wasmFeasibility)) errors.push(`${node.id}: unknown wasmFeasibility ${JSON.stringify(node.wasmFeasibility)}`)
    if (!dirExists && node.disposition !== "removed" && node.disposition !== "drop-to-standalone") {
      errors.push(`${node.id}: manifest record has no packages/nodes directory but disposition is ${node.disposition}`)
    }
    if (node.disposition === "removed" && dirExists) errors.push(`${node.id}: disposition removed but packages/nodes/${node.id} is still present`)
    if (node.disposition === "drop-to-standalone") {
      if (!node.standalone) errors.push(`${node.id}: drop-to-standalone requires a standalone project name`)
      if (node.wasmFeasibility !== "pending-audit") errors.push(`${node.id}: dropped nodes must not carry a WASM verdict`)
      if (dirExists) warnings.push(`${node.id}: drop-to-standalone but packages/nodes/${node.id} is still in the tree (removal pending)`)
    }
    if (node.disposition === "hold-unmigrated" && !disabled.includes(node.id)) {
      errors.push(`${node.id}: hold-unmigrated requires the id in xiranite.build.toml nodes.disabled`)
    }
    if (node.disposition !== "hold-unmigrated" && disabled.includes(node.id)) {
      errors.push(`${node.id}: listed in xiranite.build.toml nodes.disabled but disposition is ${node.disposition}`)
    }
    if (!node.evidence.length) errors.push(`${node.id}: evidence must name at least one file:line, repo or artifact path`)
    if (node.disposition === "retain-rewrite" && node.wasmFeasibility === "pending-audit") {
      const message = `${node.id}: retained but wasmFeasibility still pending-audit`
      if (strict) errors.push(message)
      else warnings.push(message)
    }
  }

  if (writeSkeleton) {
    for (const id of dirs) {
      if (records.has(id)) continue
      manifest.nodes.push({ id, disposition: "retain-rewrite", wasmFeasibility: "pending-audit", evidence: [`packages/nodes/${id}/src/index.ts`] })
      records.set(id, manifest.nodes[manifest.nodes.length - 1])
    }
    manifest.nodes.sort((a, b) => a.id.localeCompare(b.id))
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`Wrote ${manifest.nodes.length} node records to docs/xiranite-target-node-manifest.json`)
  }

  for (const warning of warnings) console.warn(`WARN  ${warning}`)
  if (errors.length) {
    for (const error of errors) console.error(`FAIL  ${error}`)
    throw new Error(`audit:target-node-manifest found ${errors.length} problem(s).`)
  }

  const pending = warnings.filter((line) => line.includes("pending-audit")).length
  console.log(
    `OK target-node manifest: ${manifest.nodes.length} records, ${dirs.length} node directories, ` +
      `disabled = [${disabled.join(", ")}], ${pending} retained node(s) awaiting the AST feasibility audit${strict ? "" : " (non-strict)"}.`,
  )
}

await main()
