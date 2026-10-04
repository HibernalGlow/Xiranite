#!/usr/bin/env bun
// Gate for docs/xiranite-target-node-manifest.json: the single source of truth for which nodes
// survive the Rust/Tauri rewrite. Fails when the manifest, xiranite.build.toml and the node
// directories drift apart, so a decided removal cannot silently survive as dead code.
import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { getDisabledNodeIds } from "./lib/node-build-config.js"
import { BLOCKING_SURFACE, findNodeRemovalSurfaces, listSurfaceFiles, summarizeSurface } from "./lib/node-removal-surface.js"

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
const feasibilityArg = process.argv.indexOf("--apply-feasibility")
const feasibilityPath = feasibilityArg >= 0 ? process.argv[feasibilityArg + 1] : undefined
const surfaceArgIndex = process.argv.indexOf("--surface")
const surfaceArg = surfaceArgIndex >= 0 ? process.argv[surfaceArgIndex + 1] : undefined

interface FeasibilityReport {
  nodes: Array<{
    id: string
    feasibility: WasmFeasibility
    reasons: string[]
    evidence: Array<{ file: string; line: number; specifier: string }>
  }>
}

/**
 * Verdicts come from the AST artifact only; the manifest stays the single written source of truth so a
 * generated report can never be hand-edited into a claim about which node may become a plugin.
 */
async function applyFeasibility(reportFile: string): Promise<string> {
  const [report, manifest] = await Promise.all([
    readFile(resolve(reportFile), "utf8"),
    readManifest(),
  ])
  const parsed = JSON.parse(report) as FeasibilityReport
  const byId = new Map(parsed.nodes.map((node) => [node.id, node]))
  let applied = 0

  for (const node of manifest.nodes) {
    if (node.disposition !== "retain-rewrite") continue
    const verdict = byId.get(node.id)
    if (!verdict) continue
    node.wasmFeasibility = verdict.feasibility
    const evidence = [
      `artifacts: ${relative(repoRoot, resolve(reportFile))}`,
      ...verdict.reasons.map((reason) => `${verdict.feasibility}: ${reason}`),
      ...verdict.evidence.slice(0, 3).map((item) => `${item.file}:${item.line} ${item.specifier}`),
    ]
    node.evidence = [...new Set(evidence)]
    applied += 1
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return `Applied ${applied} AST feasibility verdict(s) to docs/xiranite-target-node-manifest.json`
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
}

async function nodeDirectories(): Promise<string[]> {
  const entries = await readdir(nodesRoot, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

async function main(): Promise<void> {
  if (feasibilityPath) console.log(await applyFeasibility(feasibilityPath))
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

  // A node marked removed must actually be gone from the build graph, and a node marked out of the
  // rewrite prints how much of its surface is still wired in. This is the completion proof for the
  // removal decision, so it cannot rest on a remembered checklist.
  const decided = manifest.nodes.filter((node) => node.disposition === "removed" || node.disposition === "drop-to-standalone")
  const surfaceIds = new Set(decided.map((node) => node.id))
  if (surfaceArg && !surfaceIds.has(surfaceArg)) surfaceIds.add(surfaceArg)
  if (surfaceIds.size > 0) {
    const surfaces = await findNodeRemovalSurfaces({ repoRoot, ids: [...surfaceIds], files: await listSurfaceFiles(repoRoot) })
    for (const node of decided) {
      const findings = surfaces.get(node.id) ?? []
      const blocking = findings.filter((finding) => BLOCKING_SURFACE.includes(finding.category))
      if (surfaceArg === node.id) {
        for (const finding of findings) console.log(`SURFACE ${node.id} ${finding.category} ${finding.path} :: ${finding.detail}`)
      }
      if (node.disposition === "removed") {
        if (blocking.length > 0) {
          errors.push(`${node.id}: disposition removed but ${blocking.length} blocking seam(s) remain: ${blocking.map((item) => item.path).slice(0, 8).join(", ")}`)
        } else if (findings.length > 0) {
          warnings.push(`${node.id}: removed, ${findings.length} non-blocking mention(s) left (${summarizeSurface(findings)})`)
        } else {
          console.log(`REMOVED ${node.id}: no surface left (${summarizeSurface(findings)})`)
        }
      } else if (blocking.length > 0) {
        warnings.push(`${node.id}: drop-to-standalone with ${blocking.length} blocking seam(s) still wired (${summarizeSurface(findings)})`)
      } else {
        warnings.push(`${node.id}: drop-to-standalone, build graph already clean (${summarizeSurface(findings)})`)
      }
    }
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
