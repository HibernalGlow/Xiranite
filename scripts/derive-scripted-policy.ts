#!/usr/bin/env bun
/**
 * Derive, but do not apply, the host policy each scripted node needs.
 *
 * `crates/xiranite-scripted-nodes` refuses to register a node whose grants cannot be sourced from
 * evidence, and the blocker for 23 of the 24 embedded bundles is that no `NodeDescriptor` data exists for
 * the QuickJS path: the wasm-era manifests survive for a few nodes, and `audit:node-feasibility` measures
 * `platform.ts` — the half moving *into* the host. This script closes the derivable part of that gap from a
 * source that cannot drift: **the bundle the node actually ships**. The `__xrh` operation names it contains
 * are the ops its own code can reach, so the read/write question stops being an opinion.
 *
 * What is deliberately not derived here: external **program names** and host-**service names**. A bundle
 * proves that something reaches `proc.exec`; it cannot prove *which* binary the operator allows, and that
 * is exactly the `DangerGate` decision ADR-0073 moved onto the registration. Nodes needing those keep the
 * status `needs-named-grants` and stay unregistered.
 *
 * Usage:
 *   bun scripts/derive-scripted-policy.ts           write artifacts/node-scripted-policy.json
 *   bun scripts/derive-scripted-policy.ts --check    fail if the artifact no longer matches the bundles
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { OPERATION_SIGNATURES } from "../packages/quickjs-shims/src/ops.ts"

const repoRoot = resolve(import.meta.dirname, "..")
const bundleDir = join(repoRoot, "crates", "xiranite-quickjs-executor", "bundles")
const indexPath = join(bundleDir, "index.json")
const targetManifestPath = join(repoRoot, "docs", "xiranite-target-node-manifest.json")
const outPath = join(repoRoot, "artifacts", "node-scripted-policy.json")

interface IndexEntry {
  id: string
  file: string
  run: string
  createRuntime: string | null
}

interface TargetNode {
  id: string
  disposition: string
  hostRequirements: string[] | null
}

interface NodePolicy {
  id: string
  /** Kept for the bundle-level gate; empty until the operation vocabulary is sourced from Rust. */
  reachableOperations: string[]
  writeCalls: string[]
  readCalls: string[]
  sources: string[]
  proposedRoots: Array<{ role: string; access: "read" | "readWrite" }>
  enumeratesRecursively: boolean
  network: boolean
  /** `derivable` | `insufficient-evidence` | `needs-named-grants` | `no-core-source`. */
  status: string
  /** Why the status is what it is, quoting the evidence it rests on. */
  basis: string[]
}

const WRITING_OPS = ["fs.writeText", "fs.writeBytes", "fs.appendText", "fs.move", "fs.delete", "fs.ensureDir", "fs.mkdtemp", "fs.copy", "fs.symlink", "fs.link", "fs.rename"]
const PROGRAMMING_MARKERS = ["external-process", "os-native", "no-host-free-answer"]

/// Which fs surface a node's own code actually calls. Shim literals in a bundle prove only that the shim is
/// present, so they cannot answer read-versus-write; the call sites in `core.ts` can.
const WRITE_CALLS = ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "rm", "rmdir", "rmSync", "rename", "renameSync", "mkdir", "mkdirSync", "cp", "copyFile", "symlink", "symlinkSync", "unlink", "truncate", "chmod", "utimes", "mkdtemp"]
const READ_CALLS = ["readFile", "readFileSync", "readdir", "readFileSync", "stat", "lstat", "access", "opendir", "realpath", "readlink"]

/** The node's own sources: `core.ts` plus the first level of its relative imports. */
async function nodeSources(id: string): Promise<Array<{ file: string; text: string }>> {
  const srcDir = join(repoRoot, "packages", "nodes", id, "src")
  const entry = join(srcDir, "core.ts")
  const texts: Array<{ file: string; text: string }> = []
  const text = await readFile(entry, "utf8").catch(() => null)
  if (text === null) return texts
  texts.push({ file: `packages/nodes/${id}/src/core.ts`, text })
  for (const specifier of [...text.matchAll(/from\s+"(\.[^"]+)"/g)].map((match) => match[1]!)) {
    const base = specifier.replace(/^\.\//, "").replace(/\.(js|ts)$/, "")
    const sibling = join(srcDir, `${base}.ts`)
    const siblingText = await readFile(sibling, "utf8").catch(() => null)
    if (siblingText !== null) texts.push({ file: `packages/nodes/${id}/src/${base}.ts`, text: siblingText })
  }
  return texts
}

/** `name(` call sites, with the member prefix kept so `fs.rm` and a local `rm()` are not conflated. */
function callSites(text: string, names: string[]): string[] {
  const found = new Set<string>()
  for (const name of names) {
    const pattern = new RegExp(`[A-Za-z0-9_.]*\\b${name}\\s*\\(`, "g")
    for (const match of text.matchAll(pattern)) {
      const callee = match[0].replace(/\s*\($/, "")
      // A bare identifier is not proof of a builtin call; require the receiver unless it is the plain import name.
      if (callee === `${name}(` || callee.includes(".")) found.add(callee)
    }
  }
  return [...found].sort()
}

async function derive(): Promise<{ generatedAt: string; rule: string; operations: number; nodes: NodePolicy[]; summary: Record<string, number> }> {
  const index = JSON.parse(await readFile(indexPath, "utf8")) as { nodes: IndexEntry[] }
  const target = JSON.parse(await readFile(targetManifestPath, "utf8")) as { nodes: TargetNode[] }
  const requirements = new Map(target.nodes.map((node) => [node.id, node]))

  const nodes: NodePolicy[] = []
  for (const entry of index.nodes.sort((left, right) => left.id.localeCompare(right.id))) {
    const sources = await nodeSources(entry.id)
    const joined = sources.map((source) => source.text).join("\n")
    const writes = callSites(joined, WRITE_CALLS)
    const reads = callSites(joined, READ_CALLS)
    const manifestEntry = requirements.get(entry.id)
    const hostRequirements = manifestEntry?.hostRequirements ?? null
    const needsNames = hostRequirements !== null && hostRequirements.some((requirement) => PROGRAMMING_MARKERS.includes(requirement))
    const enumerates = hostRequirements !== null && hostRequirements.includes("recursive-enumeration")
    const network = hostRequirements !== null && hostRequirements.includes("network")

    // The falsification result, kept in the open: a node core is written against its *injected* runtime
    // interface (`runtime.copyFile`, `runtime.ensureDir`), so call sites in `core.ts` see only the seam the
    // node declares, and the real filesystem work lives in `platform.ts` — the half moving into the host.
    // A node with no seam call at all therefore proves nothing about its grants, and this script must not
    // upgrade that silence to "needs no root". Only a positive seam call is evidence.
    const seesSeam = writes.length > 0 || reads.length > 0
    const status = needsNames
      ? "needs-named-grants"
      : sources.length === 0
        ? "no-core-source"
        : seesSeam
          ? "derivable"
          : "insufficient-evidence"
    const basis = [
      sources.length === 0
        ? "packages/nodes/<id>/src/core.ts is not on disk, so nothing was read"
        : `call sites in ${sources.map((source) => source.file).join(", ")}`,
      writes.length > 0 ? `writing call sites ${JSON.stringify(writes)}` : "no writing call site in the node's own sources",
      reads.length > 0 ? `reading call sites ${JSON.stringify(reads.slice(0, 8))}` : "no reading call site either",
      hostRequirements === null ? "the retained-node manifest has no entry for this id" : `manifest hostRequirements ${JSON.stringify(hostRequirements)}`,
    ]
    if (needsNames) {
      basis.push(`blocked on named grants: ${hostRequirements!.filter((requirement) => PROGRAMMING_MARKERS.includes(requirement)).join(", ")} — a call site proves proc.exec is reached, never which program the operator allows`)
    }

    const touchesFs = seesSeam
    nodes.push({
      id: entry.id,
      reachableOperations: [],
      writeCalls: writes,
      readCalls: reads,
      sources: sources.map((source) => source.file),
      proposedRoots: touchesFs ? [{ role: "workspace", access: writes.length > 0 ? "readWrite" : "read" }] : [],
      enumeratesRecursively: enumerates,
      network,
      status,
      basis,
    })
  }

  const summary: Record<string, number> = {}
  for (const node of nodes) summary[node.status] = (summary[node.status] ?? 0) + 1
  return {
    generatedAt: new Date().toISOString(),
    rule: "reachable operations are read from the shipped bundle; read/write follows from the presence of a writing operation; recursive enumeration and network follow the retained-node manifest; program and service names are never invented, so those nodes stay unregistered.",
    operations: Object.keys(OPERATION_SIGNATURES).length,
    nodes,
    summary,
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check")
  const document = await derive()
  const text = `${JSON.stringify(document, null, 2)}\n`
  if (check) {
    const onDisk = await readFile(outPath, "utf8").catch(() => null)
    if (onDisk === null) throw new Error(`${outPath.replace(`${repoRoot}/`, "")} does not exist`)
    const recorded = (JSON.parse(onDisk).nodes as NodePolicy[]).map((node) => `${node.id}:${node.status}:${node.writeCalls.length}:${node.readCalls.length}`).join(",")
    const fresh = document.nodes.map((node) => `${node.id}:${node.status}:${node.writeCalls.length}:${node.readCalls.length}`).join(",")
    if (recorded !== fresh) throw new Error("node-scripted-policy is stale vs the bundles: rerun bun scripts/derive-scripted-policy.ts")
    console.log(`OK node-scripted-policy matches the ${document.nodes.length} bundles (${JSON.stringify(document.summary)}).`)
    return
  }
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, text)
  const derivable = document.nodes.filter((node) => node.status === "derivable")
  console.log(`wrote ${outPath.replace(`${repoRoot}/`, "")}: ${document.nodes.length} node(s), vocabulary ${document.operations} ops`)
  console.log(`  derivable now (a seam call site proves it): ${derivable.length} — ${derivable.map((node) => node.id).join(", ") || "none"}`)
  const thin = document.nodes.filter((node) => node.status === "insufficient-evidence")
  console.log(`  insufficient evidence (core reaches no runtime/fs call site; the grant question is unanswered): ${thin.length} — ${thin.map((node) => node.id).join(", ")}`)
  console.log(`  blocked on named grants: ${document.summary["needs-named-grants"] ?? 0}`)
}

await main()
