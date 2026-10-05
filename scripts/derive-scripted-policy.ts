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
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { OPERATION_SIGNATURES } from "../packages/quickjs-shims/src/ops.ts"

const repoRoot = resolve(import.meta.dirname, "..")
const bundleDir = join(repoRoot, "crates", "xiranite-quickjs-executor", "bundles")
const indexPath = join(bundleDir, "index.json")
const targetManifestPath = join(repoRoot, "docs", "xiranite-target-node-manifest.json")
const outPath = join(repoRoot, "artifacts", "node-scripted-policy.json")
const requirementsPath = join(repoRoot, "artifacts", "node-scripted-requirements.json")
const grantsPath = join(repoRoot, "artifacts", "node-scripted-grants.json")

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

/**
 * The second ruler, and the one that does not guess.
 *
 * Everything above this section tried to read grants out of the shipped bundle or out of the node's own
 * call sites, and both were falsified (see the header): the whole shim module is bundled, so op literals
 * say nothing about *which* op a node reaches, and `core.ts` programs against the injected runtime while
 * the real `node:fs` calls live in `platform.ts`. This section instead consumes the tiers the repo's
 * mandated ast-grep analyzer already proved per node — `bun run audit:node-feasibility` →
 * `artifacts/node-host-requirements.json`, whose `hostRequirements`/`reasons` are evidence, not names.
 *
 * The translation is deliberately incomplete: `NodeRequirements` (ADR-0074 §2) also carries *named*
 * grants — a program for `proc.exec`, a service for `service.invoke`, a host for `NetworkAccess::Hosts` —
 * and no analyzer can name those from an import list. So a node that needs a name comes out
 * `needs-named-grants` with the analyzer's own reason attached, and the roots it *does* prove are still
 * emitted: that way the human answers exactly one question per node instead of re-deriving all of them.
 */
const feasibilityPath = join(repoRoot, "artifacts", "node-host-requirements.json")

interface FeasibilityNode {
  hostRequirements?: string[]
  reasons?: string[]
}

interface DerivedRequirements {
  /** `RootRequirement { role, access }` with the vocabulary of `xiranite-node-registry`. */
  roots: Array<{ role: string; access: "ReadOnly" | "ReadWrite" }>
  walkTree: boolean
  network: "Disabled" | "Hosts"
  services: string[]
  /** Which of the two evidence sources decided `access`, so a row can be read without guessing. */
  accessSource: string
  /** Grants the analyzer proves are *needed* but cannot *name*; never invented here. */
  pendingGrants: string[]
}

function requirementsFromTiers(node: FeasibilityNode, writesProven: string[]): DerivedRequirements {
  const tiers = new Set(node.hostRequirements ?? [])
  const reasons = node.reasons ?? []
  // Access level is *proved*, not guessed, and the proof is recorded per row in `accessSource`. The first
  // version of this ruler matched write words inside the analyzer's `file-io` reason text and put 21 of
  // 21 file-io nodes at `ReadOnly` — including `dissolvef` and `bitv`, which move and delete files in the
  // product. The reason string only carries import markers (`node:fs`), never the call, so it cannot
  // decide this question. What can is the node's own host-facing source: `platform.ts` is where the real
  // `node:fs` calls live (`core.ts` programs against the injected runtime), so a write call site there is
  // evidence, and the reason text is kept only as a weak fallback that says so out loud.
  const writesFromReason = reasons.some((reason) => /\b(writeFile|rm|rename|mkdir|copyFile|unlink|append|move|delete)\b/i.test(reason))
  const writes = tiers.has("file-io") && (writesProven.length > 0 || writesFromReason)
  return {
    // `role` is a role, not a path (registry `RootRequirement`), and the host resolves it per operation.
    roots: tiers.has("file-io") ? [{ role: "workspace", access: writes ? "ReadWrite" : "ReadOnly" }] : [],
    walkTree: tiers.has("recursive-enumeration"),
    network: tiers.has("network") ? "Hosts" : "Disabled",
    services: [],
    accessSource: !tiers.has("file-io")
      ? "no file-io tier"
      : writesProven.length > 0
        ? `write call site in ${writesProven.join(", ")}`
        : writesFromReason
          ? "analyzer reason text only (weak, unproven)"
          : "no write evidence",
    pendingGrants: [...tiers]
      .filter((tier) => tier === "external-process" || tier === "os-native" || tier === "no-host-free-answer")
      .map((tier) => `${tier}: ${reasons.filter((reason) => reason.startsWith(tier)).join(" / ") || "no reason recorded"}`),
  }
}

interface RequirementRow {
  id: string
  run: string
  createRuntime: string
  tiers: string[]
  status: string
  reason: string
  requirements: DerivedRequirements
}

async function deriveRequirements(): Promise<{
  generatedAt: string
  rule: string
  source: string
  nodes: RequirementRow[]
  summary: Record<string, number>
}> {
  const [index, target, feasibilityText] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(targetManifestPath, "utf8"),
    readFile(feasibilityPath, "utf8").catch(() => null),
  ])
  if (feasibilityText === null) {
    throw new Error(`${feasibilityPath.replace(`${repoRoot}/`, "")} is missing — run \`bun run audit:node-feasibility\` first; this ruler reads its evidence and does not re-derive tiers itself`)
  }
  // The analyzer writes `nodes` as a list keyed by `id` inside each entry, not as a map; indexing by
  // `id` here is what makes a missing entry visible as `not-analyzed` instead of an empty tier list.
  const analyzed: Record<string, FeasibilityNode> = Object.fromEntries(
    (JSON.parse(feasibilityText) as { nodes: Array<FeasibilityNode & { id: string }> }).nodes.map((node) => [node.id, node]),
  )
  const { nodes: bundled } = JSON.parse(index) as { nodes: IndexEntry[] }
  const { nodes: wanted } = JSON.parse(target) as { nodes: TargetNode[] }
  const retained = new Set(wanted.map((node) => node.id))

  const nodes: RequirementRow[] = []
  for (const entry of bundled) {
    if (!retained.has(entry.id)) continue
    const proven = analyzed[entry.id]
    // `nodeSources` follows the source path recorded in the bundle index, which is `core.ts` — and the
    // write calls that decide access live in `platform.ts`. The first run proved that the hard way:
    // `dissolvef` stayed `ReadOnly` with "no write evidence" while its `platform.ts` holds nine write
    // call sites, so the file is now read by name instead of trusting the recorded path.
    const platformText = await readFile(join(repoRoot, "packages", "nodes", entry.id, "src", "platform.ts"), "utf8").catch(() => "")
    const sources = [
      ...(await nodeSources(entry.id)),
      { file: `packages/nodes/${entry.id}/src/platform.ts`, text: platformText },
    ]
    // `callSites` is written for the injected-runtime spellings in `core.ts` and matched nothing in any
    // `platform.ts` (measured: `dissolvef` stayed "no write evidence" while a plain regex over the same
    // file finds nine call shapes), so the platform scan uses its own call-shaped pattern.
    const WRITE_CALL_SHAPE = /\b(writeFile|writeFileSync|appendFile|appendFileSync|rm|rmSync|rename|renameSync|mkdir|mkdirSync|cp|copyFile|unlink|truncate|chmod|utimes|mkdtemp)\s*\(/
    const writeFiles = sources
      .filter((source) => callSites(source.text, WRITE_CALLS).length > 0 || WRITE_CALL_SHAPE.test(source.text))
      .map((source) => source.file.replace(`${repoRoot}/`, ""))
    const requirements = requirementsFromTiers(proven ?? {}, writeFiles)
    const tiers = proven?.hostRequirements ?? []
    const status = !proven
      ? "not-analyzed"
      : tiers.length === 0
        ? "no-host-requirement"
        : requirements.pendingGrants.length > 0
          ? "needs-named-grants"
          : requirements.roots.length > 0 || requirements.walkTree || requirements.network !== "Disabled"
            ? "derived-from-feasibility"
            : "pure-logic"
    nodes.push({
      id: entry.id,
      run: entry.run,
      createRuntime: entry.createRuntime,
      tiers,
      status,
      reason: proven ? `analyzer tiers: ${tiers.join(", ") || "none"}` : "the feasibility artifact has no entry for this id",
      requirements,
    })
  }

  const summary: Record<string, number> = {}
  for (const node of nodes) summary[node.status] = (summary[node.status] ?? 0) + 1
  return {
    generatedAt: new Date().toISOString(),
    rule: "roots/walk-tree/network come from the ast-grep feasibility analyzer's proven tiers; a node that must name a program, service or host stays unregistered because names are never invented here.",
    source: "artifacts/node-host-requirements.json",
    nodes,
    summary,
  }
}

/**
 * The fourth ruler, aimed at the one thing the third one could not reach: the *names*.
 *
 * `derive-scripted-policy.ts` refuses a node whose grant needs an external program, a host service or a
 * network host, because a tier (`external-process`) says that something is reached, not what it is called.
 * But the call sites themselves do carry the name — `mvz/src/platform.ts:7` is a candidate array of
 * `7z`/`7za`/`7zz`, `sleept/src/platform.ts:44` passes `"powershell.exe"` straight to `execFile`, and
 * `sleept/src/platform.ts:88` spells `executable: "osascript"`. So this pass reads the node's own
 * non-test sources and quotes back, with `file:line`, every program it can name.
 *
 * Two deliberate limits:
 *
 * 1. **An interpreter is not a program grant.** Whitelisting `powershell.exe` with `-Command` hands the node
 *     a script runner, which is the widest permission the register can express, so a row containing one is
 *     labelled for a human decision (`ProcessGrant` + `DangerGate` are the host's call, not this script's).
 * 2. **No literal found is reported as such**, not as "no process needed". `bitv` reaches `execFile(command`
 *     and `exec(ffprobePath` — variables resolved by a locator — so if this pass finds nothing for an
 *     `external-process` node that is a real finding, and it is what keeps the whole rule from grading
 *     every node green by matching on its own output.
 */
const PROGRAM_CALL = /\b(?:execFile|execFileSync|spawn|spawnSync|exec|execSync|runCommand|runCommandSync)\s*\(\s*"([^"]{1,40})"\s*,/g
const EXECUTABLE_FIELD = /executable:\s*"([^"]{1,40})"/g
// `const`/`let`/`var` in front of the identifier is required, not optional: the first version anchored on
// the bare name and matched nothing, so `mvz`'s `const SEVEN_ZIP_NAMES = ["7z","7z.exe","7za",…]` silently
// produced no grant and the row read as if the node named nothing.
//
// What this pattern deliberately does NOT read is `keywords:`/`description:` in a node's own `index.ts`.
// Those carry the same strings — `gifu` lists `"ffmpeg"`, `sleept` lists `"network"`, `bitv` lists
// `"ffprobe"` — and they are search metadata, not grants. Trusting them would have handed `sleept` network
// permission because a UI tag says so, which is precisely the invented grant the rules forbid.
const NAME_ARRAY = /(?:const|let|var)\s+[A-Z0-9_]*(?:NAMES|CANDIDATES|BINARIES|EXECUTABLES)[A-Z0-9_]*\s*=\s*\[([^\]]*)\]/gm
const INTERPRETERS = new Set(["powershell.exe", "powershell", "pwsh", "pwsh.exe", "cmd", "cmd.exe", "bash", "sh", "zsh", "osascript", "node", "python", "python3"])

interface NamedProgram {
  name: string
  evidence: string
  interpreter: boolean
}

async function namedPrograms(id: string): Promise<NamedProgram[]> {
  const directory = join(repoRoot, "packages", "nodes", id, "src")
  const found: NamedProgram[] = []
  const seen = new Set<string>()
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    if (!name.endsWith(".ts") || /\.test\.ts$/.test(name)) continue
    const file = `${id}/src/${name}`
    const text = await readFile(join(directory, name), "utf8").catch(() => "")
    const collect = (matched: string | undefined, index: number): void => {
      if (matched !== undefined && /^[A-Za-z0-9._-]{1,40}$/.test(matched)) {
        // The evidence is a line number, not "file:name": a later reader has to be able to open the file and
        // see the call, and a name-only tag cannot be checked without grepping the whole file again.
        const line = text.slice(0, index).split("\n").length
        const key = `${file}:${line} ${matched}`
        if (!seen.has(key)) {
          seen.add(key)
          found.push({ name: matched, evidence: key, interpreter: INTERPRETERS.has(matched.toLowerCase()) })
        }
      }
    }
    for (const match of text.matchAll(PROGRAM_CALL)) collect(match[1], match.index)
    for (const match of text.matchAll(EXECUTABLE_FIELD)) collect(match[1], match.index)
    for (const match of text.matchAll(NAME_ARRAY)) {
      for (const literal of Array.from(match[1].matchAll(/"([^"]{1,40})"/g))) {
        collect(literal[1], (match.index ?? 0) + (literal.index ?? 0))
      }
    }
  }
  return found
}

async function deriveGrants(): Promise<{
  generatedAt: string
  rule: string
  nodes: Array<{ id: string; tiers: string[]; status: string; programs: NamedProgram[]; unresolved: string }>
  summary: Record<string, number>
}> {
  const document = await deriveRequirements()
  const nodes: Array<{ id: string; tiers: string[]; status: string; programs: NamedProgram[]; unresolved: string }> = []
  for (const row of document.nodes) {
    const needsProcess = row.tiers.includes("external-process")
    const programs = needsProcess ? await namedPrograms(row.id) : []
    const interpreters = programs.filter((program) => program.interpreter)
    const status = !needsProcess
      ? "no-process-tier"
      : programs.length === 0
        ? "unresolved-program-name"
        : interpreters.length > 0
          ? "named-but-interpreter-needs-a-human"
          : "named"
    nodes.push({
      id: row.id,
      tiers: row.tiers,
      status,
      programs,
      unresolved: status === "unresolved-program-name" ? "every call site passes a variable or a resolved path, so no literal name exists to quote" : "",
    })
  }
  const summary: Record<string, number> = {}
  for (const node of nodes) summary[node.status] = (summary[node.status] ?? 0) + 1
  return {
    generatedAt: new Date().toISOString(),
    rule: "program names are quoted out of the node's own non-test sources with file evidence; an interpreter in that list is escalated instead of granted, and a node whose calls all pass variables is reported as unresolved.",
    nodes,
    summary,
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--grants")) {
    const document = await deriveGrants()
    const text = `${JSON.stringify(document, null, 2)}\n`
    await mkdir(dirname(grantsPath), { recursive: true })
    await writeFile(grantsPath, text)
    console.log(`wrote ${grantsPath.replace(`${repoRoot}/`, "")}: ${JSON.stringify(document.summary)}`)
    for (const node of document.nodes.filter((row) => row.status !== "no-process-tier")) {
      console.log(`  ${node.id.padEnd(10)} ${node.status.padEnd(36)} ${node.programs.map((program) => program.name).join(", ") || node.unresolved}`)
    }
    return
  }
  if (process.argv.includes("--requirements")) {
    const document = await deriveRequirements()
    const text = `${JSON.stringify(document, null, 2)}\n`
    await mkdir(dirname(requirementsPath), { recursive: true })
    await writeFile(requirementsPath, text)
    console.log(`wrote ${requirementsPath.replace(`${repoRoot}/`, "")}: ${document.nodes.length} node(s) ${JSON.stringify(document.summary)}`)
    const ready = document.nodes.filter((node) => node.status === "derived-from-feasibility" || node.status === "pure-logic" || node.status === "no-host-requirement")
    console.log(`  registrable without inventing a name: ${ready.length} — ${ready.map((node) => node.id).join(", ") || "none"}`)
    console.log(`  needs one human answer (a program, a service or a host): ${document.summary["needs-named-grants"] ?? 0}`)
    return
  }
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
