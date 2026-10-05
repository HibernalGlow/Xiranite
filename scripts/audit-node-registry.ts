#!/usr/bin/env bun
/**
 * Gate for ADR-0073's link-time node registration.
 *
 * Registration is a property of the crate graph, not of a list: a node calls `register_node!`
 * (`crates/xiranite-node-registry/src/lib.rs:283`) and `NodeRegistry::builtin()` collects whatever was
 * linked. So the failure mode is silent — a node crate that is not a workspace member never registers,
 * `cargo build` stays green, and the node simply disappears from the product. The gate this replaces
 * (`scripts/audit-plugin-manifests.ts:185`) could not see it, because it scanned `plugins/` while the
 * real node lived under `crates/nodes/` (ADR-0073 "退役时不要继承的三个洞" item 2). This gate therefore
 * compares three sets it reads from disk — workspace membership, self-registration, and the
 * `retain-rewrite` decision set — instead of scanning one directory and hoping it is the subject.
 *
 * Pending ports are warnings, not failures: `docs/xiranite-target-node-manifest.json` decides that 41
 * nodes survive, ADR-0073 step 3 has not moved them yet, and a gate that is red for work nobody has
 * started gets switched off. `--strict` is the finish line for that debt.
 */
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, posix, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseToml } from "../packages/config/src/xiraniteToml.ts"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const cargoTomlPath = join(repoRoot, "Cargo.toml")
const nodesRoot = join(repoRoot, "crates", "nodes")
const manifestPath = join(repoRoot, "docs", "xiranite-target-node-manifest.json")

/** `docs/xiranite-target-node-manifest.json` dispositions that mean "this node must end up in the host". */
const RETAIN_DISPOSITION = "retain-rewrite"

/**
 * Spelling of a self-registration. The macro is the contract (ADR-0073 decision 2), but it expands to
 * `inventory::submit!`, so a node that submits directly is registered just as well and must not read as
 * missing.
 */
const REGISTRATION_PATTERNS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  // The leading class must accept `::`, because `xiranite_node_registry::register_node!(...)` is the
  // documented call shape, while `unregister_node!`-style word continuations must not match.
  ["register_node!", /(?:^|[^\w])register_node!\s*\(/],
  ["inventory::submit!", /inventory::submit!/],
]

export interface NodeCrate {
  /** Directory name under `crates/nodes/`, which is the node id. */
  id: string
  /** `package.name` from the crate's own manifest, when one exists. */
  packageName?: string
  /** True when the crate directory holds no `Cargo.toml`, i.e. a port that has not started. */
  hasManifest: boolean
  /** True when the crate is compiled into the workspace: listed in `[workspace] members` (directly or by glob), or reachable as a path dependency of a member. */
  isMember: boolean
  /** Why it is or is not linked, quoted straight from the root manifest. */
  memberReason: string
  /** True when the crate declares its own `[workspace]`, i.e. it is a separate build like `plugins/*`. */
  ownWorkspace: boolean
  /** The registration spelling found, or null when the crate never registers itself. */
  registeredVia: string | null
  /** Files the registration was found in, for the report to name. */
  registrationFiles: string[]
}

export interface RegistryReport {
  retainedIds: string[]
  crates: NodeCrate[]
  /** Failures: silent loss, member without registration, crates that are not retained nodes. */
  errors: string[]
  /** Pending ports: a retained node with no crate yet. Strict mode promotes each of these to an error. */
  pending: string[]
  registeredCount: number
  memberCount: number
}

/** Repo-relative, POSIX-normalized path, because Cargo writes members with `/`. */
function toPosix(path: string): string {
  return relative(repoRoot, path).split("\\").join(posix.sep) || "."
}

function normalizeMemberEntry(entry: string): string {
  return entry.trim().replace(/\\/g, posix.sep).replace(/^\.\//, "").replace(/\/+$/, "")
}

/**
 * Cargo allows globs in `members`. Only the `crates/*` shape (one path segment) is expanded here; a
 * pattern this helper cannot express fails closed, because guessing that a node is linked is exactly the
 * silent-loss bug.
 */
function memberGlob(pattern: string): RegExp | null {
  if (!pattern.includes("*")) return null
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  return new RegExp(`^${escaped.join("[^/]+")}$`)
}

interface WorkspaceManifest {
  members: string[]
  excluded: string[]
}

async function readWorkspaceManifest(): Promise<WorkspaceManifest> {
  const raw = await readFile(cargoTomlPath, "utf8")
  const document = parseToml(raw) as Record<string, unknown>
  const workspace = document["workspace"]
  if (typeof workspace !== "object" || workspace === null) {
    throw new Error("Cargo.toml has no [workspace] section: the gate cannot tell what is linked.")
  }
  const readList = (key: string): string[] => {
    const value = (workspace as Record<string, unknown>)[key]
    if (value === undefined) return []
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`Cargo.toml [workspace] ${key} is not an array of strings.`)
    }
    return (value as string[]).map(normalizeMemberEntry)
  }
  return { members: readList("members"), excluded: readList("exclude") }
}

/** Every `path = "..."` value in a crate manifest, resolved to a repo-relative directory. */
async function pathDependencies(memberRelDir: string): Promise<string[]> {
  const found: string[] = []
  const walk = (node: unknown, key?: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, key)
      return
    }
    if (typeof node !== "object" || node === null) {
      if (key === "path" && typeof node === "string") {
        // Resolve against the member's own directory: `../../nodes/dissolvef` is the same crate as the
        // `crates/nodes/dissolvef` member entry, and comparing raw strings would miss it.
        found.push(toPosix(resolve(repoRoot, memberRelDir, node)))
      }
      return
    }
    for (const [childKey, child] of Object.entries(node as Record<string, unknown>)) walk(child, childKey)
  }
  const raw = await readFile(join(repoRoot, memberRelDir, "Cargo.toml"), "utf8").catch(() => null)
  if (raw === null) return found
  try {
    walk(parseToml(raw))
  } catch {
    // A member whose manifest does not parse is cargo's problem, not this gate's; the membership lists
    // were already read from the root manifest.
  }
  return found
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.filter((item) => item.isDirectory() || item.isFile())) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)))
    else if (entry.name.endsWith(".rs")) out.push(path)
  }
  return out
}

/** Registrations, ignoring comment lines so a doc example cannot read as a real submission. */
async function findRegistration(crateDir: string): Promise<{ via: string | null; files: string[] }> {
  const files = await sourceFiles(join(crateDir, "src"))
  const via = new Set<string>()
  const hits: string[] = []
  for (const file of files) {
    const raw = await readFile(file, "utf8").catch(() => null)
    if (raw === null) continue
    const code = raw
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join("\n")
    for (const [label, pattern] of REGISTRATION_PATTERNS) {
      if (pattern.test(code)) {
        via.add(label)
        hits.push(toPosix(file))
      }
    }
  }
  return { via: via.size ? [...via].sort().join(" + ") : null, files: hits.sort() }
}

async function readRetainedIds(): Promise<{ retained: string[]; dispositions: Map<string, string> }> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    nodes: Array<{ id: string; disposition: string }>
  }
  const dispositions = new Map(manifest.nodes.map((node) => [node.id, node.disposition]))
  const retained = manifest.nodes
    .filter((node) => node.disposition === RETAIN_DISPOSITION)
    .map((node) => node.id)
    .sort()
  return { retained, dispositions }
}

export async function auditNodeRegistry(): Promise<RegistryReport> {
  const [{ members, excluded }, { retained, dispositions }] = await Promise.all([
    readWorkspaceManifest(),
    readRetainedIds(),
  ])
  const globs = members.map(memberGlob)
  const entries = await readdir(nodesRoot, { withFileTypes: true }).catch(() => [])
  const crateDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()

  const directMatch = (relDir: string): string | null => {
    const exact = members.find((member) => member === relDir)
    if (exact) return `listed in [workspace] members as ${JSON.stringify(exact)}`
    for (let index = 0; index < members.length; index += 1) {
      if (globs[index]?.test(relDir)) return `matched by [workspace] members glob ${JSON.stringify(members[index])}`
    }
    return null
  }

  const crates: NodeCrate[] = []
  for (const id of crateDirs) {
    const crateDir = join(nodesRoot, id)
    const relDir = toPosix(crateDir)
    const raw = await readFile(join(crateDir, "Cargo.toml"), "utf8").catch(() => null)
    const { via, files } = await findRegistration(crateDir)
    let isMember = false
    let memberReason = ""
    let ownWorkspace = false
    let packageName: string | undefined
    if (raw === null) {
      memberReason = `no Cargo.toml at ${relDir}, so there is no crate to link yet`
    } else {
      const document = parseToml(raw) as Record<string, unknown>
      ownWorkspace = typeof document["workspace"] === "object" && document["workspace"] !== null
      const pkg = document["package"]
      if (pkg && typeof pkg === "object" && typeof (pkg as Record<string, unknown>)["name"] === "string") {
        packageName = (pkg as Record<string, unknown>)["name"] as string
      }
      const listed = directMatch(relDir)
      if (listed !== null) {
        isMember = true
        memberReason = listed
      } else {
        // A crate can also enter the workspace without being listed: cargo links any path dependency of a
        // member. Missing that reads as a silent-loss failure that is not one, so it is checked.
        const viaDep = (await Promise.all(members.filter((m) => m.includes("/") && !m.includes("*")).map(pathDependencies)))
          .flat()
          .find((dep) => dep === relDir || dep === `${relDir}/`)
        const excludedBy = excluded.find((entry) => entry === relDir || relDir.startsWith(`${entry}/`))
        if (viaDep !== undefined) {
          isMember = true
          memberReason = "not listed in members, but a path dependency of a member"
        } else if (excludedBy !== undefined) {
          memberReason = `named in [workspace] exclude as ${JSON.stringify(excludedBy)}, so it is never built by the root workspace`
        } else if (ownWorkspace) {
          memberReason = "declares its own [workspace] (a separate build, like plugins/*) and is not a root member"
        } else {
          memberReason = "absent from [workspace] members"
        }
      }
    }
    crates.push({ id, packageName, hasManifest: raw !== null, isMember, memberReason, ownWorkspace, registeredVia: via, registrationFiles: files })
  }

  const errors: string[] = []
  const pending: string[] = []
  const byId = new Map(crates.map((crate) => [crate.id, crate]))

  for (const crate of crates) {
    if (!crate.hasManifest) continue
    const disposition = dispositions.get(crate.id)
    if (disposition !== RETAIN_DISPOSITION) {
      // A crate under crates/nodes/ that the manifest never retained, or never mentions at all. Either way
      // something is being linked (or dropped) that no decision authorised.
      errors.push(
        `crates/nodes/${crate.id}: not a ${RETAIN_DISPOSITION} node (${
          disposition === undefined ? "no record in docs/xiranite-target-node-manifest.json" : `disposition ${disposition}`
        }) — delete the crate or record the decision`,
      )
    }
    if (!crate.isMember) {
      errors.push(
        `crates/nodes/${crate.id}: node crate exists but is NOT linked into the host (${crate.memberReason}). ` +
          "Registration is link-time, so this node silently vanishes from the product while cargo stays green — add it to [workspace] members.",
      )
    } else if (crate.registeredVia === null) {
      errors.push(
        `crates/nodes/${crate.id}: is a workspace member but never calls register_node! (${crate.memberReason}), ` +
          "so NodeRegistry::builtin() cannot see it — a member that registers nothing is the same silent loss as a missing member.",
      )
    }
  }

  for (const id of retained) {
    const crate = byId.get(id)
    if (crate === undefined) pending.push(`${id}: retained but has no crate under crates/nodes/ (ADR-0073 step 3 has not ported it)`)
    else if (!crate.hasManifest) pending.push(`${id}: retained, crates/nodes/${id}/ exists but has no Cargo.toml yet`)
  }

  return {
    retainedIds: retained,
    crates,
    errors,
    pending,
    registeredCount: crates.filter((crate) => crate.registeredVia !== null).length,
    memberCount: crates.filter((crate) => crate.isMember).length,
  }
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict")
  const report = await auditNodeRegistry()

  // Positive control, same rule as scripts/audit-plugin-manifests.ts:186: a scan that found nothing must
  // fail, or a renamed directory would read as a passing gate.
  if (report.crates.length === 0) {
    throw new Error("audit:node-registry scanned crates/nodes/ and found no node crates: an empty scan must not read as a passing gate.")
  }
  if (report.retainedIds.length === 0) {
    throw new Error("audit:node-registry read docs/xiranite-target-node-manifest.json and found no retain-rewrite nodes: an empty decision set must not read as a passing gate.")
  }

  for (const warning of report.pending) console.warn(`WARN  ${warning}`)
  for (const error of report.errors) console.error(`FAIL  ${error}`)

  if (strict) {
    for (const item of report.pending) console.error(`FAIL  ${item}`)
  }
  const blocking = report.errors.length + (strict ? report.pending.length : 0)
  if (blocking > 0) {
    throw new Error(`audit:node-registry found ${report.errors.length} failure(s) and ${report.pending.length} pending port(s) (${strict ? "strict" : "non-strict"}).`)
  }

  console.log(
    `OK node registry: ${report.retainedIds.length} retained node(s), ${report.crates.length} crate dir(s) under crates/nodes/, ` +
      `${report.memberCount} linked into the root workspace, ${report.registeredCount} self-registering, ` +
      `${report.pending.length} port(s) pending${strict ? "" : " (non-strict)"}.`,
  )
}

if (import.meta.main) {
  await main()
}
