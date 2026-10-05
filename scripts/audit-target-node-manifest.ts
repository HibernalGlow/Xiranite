#!/usr/bin/env bun
/**
 * Gate for docs/xiranite-target-node-manifest.json: the single source of truth for which nodes
 * survive the Rust/Tauri rewrite. Fails when the manifest, xiranite.build.toml and the node
 * directories drift apart, so a decided removal cannot silently survive as dead code.
 *
 * ADR-0073 (`docs/adr/0073-…:161`) renamed the field this gate carries: the single-string
 * `wasmFeasibility` verdict became `hostRequirements`, an ARRAY of the host-service tiers the AST
 * analyzer measures. The tier vocabulary is imported from that analyzer
 * (`packages/tauri-migrate/src/node-feasibility.ts`, `HOST_REQUIREMENTS`) instead of being declared a
 * second time here: a third list inside the gate is exactly the producer/consumer drift this rename
 * left behind, and the package's built entry point is not usable as the source either (its stale
 * `dist/index.js` still exports the pre-rename `FEASIBILITY_TIERS`, so importing `@xiranite/tauri-migrate`
 * yields `undefined` for the tiers). Importing the source module is the live spelling; it costs one
 * napi load (~13 ms measured) and no build step.
 *
 * "Not audited yet" is spelled `null`, and that is the only spelling. The array-in sentinels a half-done
 * rename left in this file's history (`["pending-audit"]`) and the retired `wasmFeasibility` key are
 * rejected with their own messages — a value that no artifact can produce must not be tolerated, or the
 * gate cannot tell "not audited" from "hand-typed", and `--strict` loses its teeth. `[]` is likewise a
 * hard failure rather than a silent read as `pure-logic`, because `pure-logic` is the analyzer's residual
 * and always stands alone.
 */
import { existsSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { HOST_REQUIREMENTS, type HostRequirement, type NodeHostRequirementRecord } from "../packages/tauri-migrate/src/node-feasibility.ts"

import { getDisabledNodeIds } from "./lib/node-build-config.ts"
import { BLOCKING_SURFACE, findNodeRemovalSurfaces, listSurfaceFiles, summarizeSurface } from "./lib/node-removal-surface.ts"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = join(repoRoot, "docs", "xiranite-target-node-manifest.json")
const nodesRoot = join(repoRoot, "packages", "nodes")
/** The artifact `bun run audit:node-feasibility` writes; the only sanctioned source of verdicts. */
const defaultArtifactPath = join(repoRoot, "artifacts", "node-host-requirements.json")

export type Disposition = "retain-rewrite" | "drop-to-standalone" | "hold-unmigrated" | "removed"

export type { HostRequirement }

/** The tier list, or null when no verdict is carried (the only way "not audited" is spelled). */
export type HostRequirements = HostRequirement[] | null

/**
 * One allowlist entry. `confirmBeforeRun` is stored, not defaulted from "it's just a program": a name that can
 * run arbitrary code (a shell, an interpreter, a DLL loader) needs the user's yes *at the registration point*,
 * which is where ADR-0069 hangs the danger gate. `--apply-host-requirements` seeds it from
 * {@link ARBITRARY_CODE_PROGRAMS} and a human may change it; the gate only requires the field to be present.
 */
export interface ProgramGrantRecord {
  name: string
  confirmBeforeRun: boolean
}

const ARBITRARY_CODE_PROGRAMS = new Set([
  "powershell.exe", "powershell", "pwsh.exe", "pwsh", "cmd.exe", "cmd", "conhost.exe",
  "sh", "bash", "zsh", "dash", "cscript.exe", "wscript.exe", "mshta.exe",
  "rundll32.exe", "regsvr32.exe", "certutil.exe", "bitsadmin.exe",
])

/** The seed for a freshly proven name: shells confirm, ordinary tools do not. */
export function confirmBeforeRunFor(program: string): boolean {
  return ARBITRARY_CODE_PROGRAMS.has(program.toLowerCase())
}

export interface NodeRecord {
  id: string
  disposition: Disposition
  standalone?: string  /** Absent key reads as null; the written form is `"hostRequirements": null` so it stays greppable. */
  hostRequirements?: HostRequirements
  evidence: string[]
  /**
   * External programs this node may be granted. A name gets here one of two ways: the analyzer proved it from a
   * call site (`processes` in `artifacts/node-host-requirements.json`, written by `--apply-host-requirements`), or
   * a human decided it and the record carries an `evidence` line `program: <name> <file>:<line>`. A name with
   * neither is a gate failure — an invented allowlist entry is worse than a missing one, because it silently
   * widens what a bundle may run.
   */
  programs?: ProgramGrantRecord[]
  /**
   * Spawn calls whose program is computed at run time (a 7-Zip locator, a config read). Disclosed, never guessed.
   * A retained node carrying `external-process` must have `programs`, `pendingProcessGrants`, or both — otherwise
   * "it shells out" and "to what" are both missing from the single source of truth.
   */
  pendingProcessGrants?: string[]
  /**
   * The node's live-byte ceiling, in bytes. `null` or absent means nobody has decided it, which is not the same as
   * "no limit": `NodeRequirements::max_live_bytes = 0` is documented (`crates/xiranite-node-registry/src/lib.rs:108-111`)
   * as "undeclared", and the QuickJS executor refuses to schedule such a run. So an unset ceiling keeps the node out
   * of the scripted registry, and the gate says so by name.
   *
   * A number here must come with an `evidence` line starting `maxLiveBytes: <where the number comes from>`. This
   * gate never fills the field: a ceiling invented by a producer is a policy decision disguised as measurement, one
   * step too small breaks the node and one step too large deletes the limit it exists to enforce.
   */
  maxLiveBytes?: number | null
  note?: string
  /** Retired by ADR-0073. Typed so the gate can name the leftover field and fail on it. */
  wasmFeasibility?: unknown
  /**
   * Paths that still name the id on purpose and are therefore not counted as blocking. Each one must
   * exist, so a resolved coupling cannot linger here as a hidden allowlist.
   */
  keptReferences?: string[]
}

export interface Manifest {
  schemaVersion: number
  decidedBy: string[]
  policy: string
  nodes: NodeRecord[]
}

/** Bumped by this rename: a v1 file carries `wasmFeasibility`, so reading it as v2 would be a lie. */
export const MANIFEST_SCHEMA_VERSION = 2

const DISPOSITIONS = new Set<string>(["retain-rewrite", "drop-to-standalone", "hold-unmigrated", "removed"])

/** The analyzer's tier list, imported so producer and gate cannot drift apart again. */
export const TIERS: readonly HostRequirement[] = HOST_REQUIREMENTS
const TIER_SET = new Set<string>(TIERS)
/**
 * The pre-rename spelling of "no verdict", kept out of the tier vocabulary on purpose: it names a state,
 * not a host service. The gate rejects it with its own message so a half-migrated record tells the operator
 * what to write instead, and never reads as a measured verdict.
 */
const PENDING_SENTINEL = "pending-audit"
/**
 * The analyzer emits a node's tiers in report order (`REQUIREMENT_ORDER`, most host-coupled first) and
 * the sanctioned write path preserves it, so any other spelling of an array was typed by hand.
 */
const TIER_RANK = new Map(TIERS.map((tier, index) => [tier, index]))

export interface ManifestAuditInput {
  manifest: Manifest
  /** Directory names under `packages/nodes/`. */
  dirs: string[]
  /** Ids disabled in `xiranite.build.toml` `[nodes].disabled`. */
  disabled: string[]
  strict: boolean
}

export interface ManifestAuditResult {
  errors: string[]
  warnings: string[]
  /** Retained nodes carrying no measured verdict: warnings normally, errors under `--strict`. */
  unauditedRetained: string[]
  /** Tier occurrences over the retained set only. */
  tierCounts: Record<HostRequirement, number>
  recordCount: number
  dirCount: number
  retainedCount: number
}

/**
 * The field rules, kept away from fs so `scripts/audit-target-node-manifest.test.ts` can inject
 * malformed records (the positive control) without touching the repo.
 */
export function auditManifestRecords(input: ManifestAuditInput): ManifestAuditResult {
  const { manifest, dirs, disabled, strict } = input
  const errors: string[] = []
  const warnings: string[] = []
  const unauditedRetained: string[] = []
  const ceilingless: string[] = []
  const tierCounts = Object.fromEntries(TIERS.map((tier) => [tier, 0])) as Record<HostRequirement, number>
  const knownIds = new Set(manifest.nodes.map((node) => node.id))

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push(`manifest schemaVersion is ${JSON.stringify(manifest.schemaVersion)}, expected ${MANIFEST_SCHEMA_VERSION} (the hostRequirements tier list, ADR-0073)`)
  }

  // Positive control, same rule as scripts/audit-node-registry.ts:306: a scan that found nothing must fail,
  // or a moved directory reads as a passing gate. Kept here rather than in main() so the test can drive it.
  if (dirs.length === 0) errors.push("scanned packages/nodes/ and found no node directories: an empty scan must not read as a passing gate.")
  if (manifest.nodes.length === 0) errors.push("read docs/xiranite-target-node-manifest.json and found no records: an empty decision set must not read as a passing gate.")
  if (manifest.nodes.length > 0 && manifest.nodes.every((node) => node.disposition !== "retain-rewrite")) {
    errors.push("the manifest holds no retain-rewrite record: an empty retained set must not read as a passing gate.")
  }

  for (const id of dirs) {
    if (!knownIds.has(id)) errors.push(`packages/nodes/${id} exists but has no manifest record`)
  }

  for (const node of manifest.nodes) {
    const dirExists = dirs.includes(node.id)
    const requirements = readHostRequirements(node, errors)
    if (!DISPOSITIONS.has(node.disposition)) errors.push(`${node.id}: unknown disposition ${JSON.stringify(node.disposition)}`)
    if (node.wasmFeasibility !== undefined) {
      errors.push(`${node.id}: still carries the retired wasmFeasibility field; ADR-0073 replaced it with the hostRequirements tier list`)
    }
    if (!dirExists && node.disposition !== "removed" && node.disposition !== "drop-to-standalone") {
      errors.push(`${node.id}: manifest record has no packages/nodes directory but disposition is ${node.disposition}`)
    }
    if (node.disposition === "removed" && dirExists) errors.push(`${node.id}: disposition removed but packages/nodes/${node.id} is still present`)
    if (node.disposition === "drop-to-standalone" && !node.standalone) {
      errors.push(`${node.id}: drop-to-standalone requires a standalone project name`)
    }
    if (node.disposition === "hold-unmigrated" && !disabled.includes(node.id)) {
      errors.push(`${node.id}: hold-unmigrated requires the id in xiranite.build.toml nodes.disabled`)
    }
    if (node.disposition !== "hold-unmigrated" && disabled.includes(node.id)) {
      errors.push(`${node.id}: listed in xiranite.build.toml nodes.disabled but disposition is ${node.disposition}`)
    }
    if (!node.evidence.length) errors.push(`${node.id}: evidence must name at least one file:line, repo or artifact path`)

    // ADR-0073's rework of the old "dropped nodes must not carry a WASM verdict" rule: only a node the
    // rewrite actually owes a native crate carries a tier list. A removed or dropped node has no
    // packages/nodes core left for the analyzer to measure, so any array on it was typed by hand; a
    // shelved node is not this round's decision (AGENTS.md: 只有保留节点的宿主需求必须来自 AST 审计).
    if (requirements !== null) {
      if (node.disposition === "removed" || node.disposition === "drop-to-standalone") {
        errors.push(
          `${node.id}: disposition ${node.disposition} must carry "hostRequirements": null, got ${JSON.stringify(requirements)} — ` +
            "no packages/nodes core is left for bun run audit:node-feasibility to measure (ADR-0064/ADR-0073)",
        )
      } else if (node.disposition === "hold-unmigrated") {
        errors.push(
          `${node.id}: hold-unmigrated must carry "hostRequirements": null, got ${JSON.stringify(requirements)} — ` +
            "a shelved node is not rewritten this round, so no verdict is owed even though its core is measurable",
        )
      }
    }

    if (node.disposition === "retain-rewrite") {
      if (requirements === null) {
        unauditedRetained.push(node.id)
        const message =
          `${node.id}: retained but hostRequirements carries no measured verdict (null); ` +
          "run bun run audit:node-feasibility then bun run audit:target-node-manifest -- --apply-host-requirements"
        if (strict) errors.push(message)
        else warnings.push(message)
      } else {
        // Unique tiers only: a duplicated tier is already a finding above, and must not inflate the report line.
        for (const tier of new Set(requirements)) tierCounts[tier] += 1
      }

      // External-program grants are data, and the manifest is the single source the registry reads. So a node the
      // analyzer says shells out must either name the program (proven at a call site, or decided by a human with
      // evidence) or disclose that the name is computed at run time. Silence is the failure mode: it is how every
      // `proc.exec` from a bundle ends up refused with nothing pointing at the cause.
      const programs = node.programs ?? []
      const pendingPrograms = node.pendingProcessGrants ?? []
      if (requirements?.includes("external-process")) {
        if (programs.length === 0 && pendingPrograms.length === 0) {
          errors.push(
            `${node.id}: hostRequirements carries external-process but the record names no program and no pending grant; ` +
              "run --apply-host-requirements (proven names come from the analyzer), or list the run-time-computed call under pendingProcessGrants — never guess a name",
          )
        }
        for (const grant of programs) {
          if (typeof grant?.name !== "string" || grant.name.length === 0 || typeof grant.confirmBeforeRun !== "boolean") {
            errors.push(
              `${node.id}: programs entry ${JSON.stringify(grant)} must be { name, confirmBeforeRun }; leaving the danger gate unset is how a shell ends up runnable with no prompt`,
            )
            continue
          }
          if (!node.evidence.some((line) => line.startsWith(`program: ${grant.name} `))) {
            errors.push(
              `${node.id}: programs lists ${JSON.stringify(grant.name)} with no "program: ${grant.name} <file>:<line>" evidence line; ` +
                "an allowlist entry nobody proved silently widens what a bundle may run",
            )
          }
        }
      } else if (programs.length > 0 || pendingPrograms.length > 0) {
        errors.push(
          `${node.id}: carries program grants (${JSON.stringify([...programs.map((grant) => grant?.name), ...pendingPrograms].slice(0, 3))}) but hostRequirements has no external-process tier; one of the two is wrong`,
        )
      }

      // The live-byte ceiling is the other half of "will the host run this at all". `max_live_bytes = 0` is spelled
      // "undeclared" by the registry and the QuickJS executor refuses to schedule such a node, so the scripted
      // generator keeps ceiling-less nodes out of its table on purpose. The gate's job is to make that visible:
      // a set value must state where the number came from, and a retained node with no source anywhere is named.
      const declaredCeiling = node.maxLiveBytes ?? null
      if (declaredCeiling !== null) {
        if (!Number.isInteger(declaredCeiling) || declaredCeiling <= 0) {
          errors.push(
            `${node.id}: maxLiveBytes ${JSON.stringify(node.maxLiveBytes)} must be a positive whole byte count or null — 0 is exactly the "undeclared" spelling the host refuses`,
          )
        } else if (!node.evidence.some((line) => line.startsWith("maxLiveBytes: "))) {
          errors.push(
            `${node.id}: maxLiveBytes ${declaredCeiling} has no "maxLiveBytes: <source>" evidence line — a ceiling with no stated origin is a magic number, and the two ways to get it wrong are breaking the node and deleting its limit`,
          )
        }
      } else {
        ceilingless.push(node.id)
      }
    }
  }

  // The wasm-era `plugins/<id>/manifest.toml` page count was an external ceiling source until 2026-10-05;
  // with the Extism tree deleted, the manifest column is the only one, so an unset value is named outright.
  if (ceilingless.length > 0) {
    warnings.push(
      `${ceilingless.length} retained node(s) have no live-byte ceiling in the manifest (${ceilingless.slice(0, 20).join(", ")}): ` +
        "the scripted generator refuses to register them, because max_live_bytes = 0 reads as undeclared and the host " +
        'will not schedule the run — set maxLiveBytes with a "maxLiveBytes: <source>" evidence line',
    )
  }

  return {
    errors,
    warnings,
    unauditedRetained,
    tierCounts,
    recordCount: manifest.nodes.length,
    dirCount: dirs.length,
    retainedCount: manifest.nodes.filter((node) => node.disposition === "retain-rewrite").length,
  }
}

/**
 * Validates one record's `hostRequirements` and returns the tier list, or null both when no verdict is
 * carried and when the value is malformed (after pushing the error), so a broken value can never be
 * counted as a verdict by the caller.
 */
function readHostRequirements(node: NodeRecord, errors: string[]): HostRequirement[] | null {
  const raw = node.hostRequirements
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw)) {
    errors.push(`${node.id}: hostRequirements must be an array of tiers or null, got ${JSON.stringify(raw)}`)
    return null
  }
  // Values are strings in every well-formed record, but this gate's job is to survive the ones that are not,
  // so everything below compares text rather than relying on the declared type.
  const values = raw.map((tier) => String(tier))

  // The half-done rename's sentinel: not a tier, so it never counts as a verdict, and it gets its own
  // message rather than a generic unknown-tier line that hides which record still needs auditing.
  if (values.includes(PENDING_SENTINEL)) {
    errors.push(
      `${node.id}: hostRequirements carries the pre-rename "pending-audit" sentinel (${JSON.stringify(raw)}); ` +
        'write "hostRequirements": null and fill it with bun run audit:target-node-manifest -- --apply-host-requirements',
    )
    return null
  }
  // Never a silent `pure-logic`: the analyzer emits that residual only when it measured nothing else.
  if (values.length === 0) {
    errors.push(`${node.id}: hostRequirements is an empty array, which the analyzer never emits (its residual is "pure-logic")`)
    return null
  }
  for (const tier of values) {
    if (!TIER_SET.has(tier)) {
      errors.push(`${node.id}: unknown hostRequirements tier ${JSON.stringify(tier)} (the analyzer's vocabulary is [${TIERS.join(", ")}])`)
    }
  }
  if (new Set(values).size !== values.length) {
    errors.push(`${node.id}: hostRequirements lists a tier twice: ${JSON.stringify(raw)}`)
  }
  if (values.includes("pure-logic") && values.length > 1) {
    errors.push(`${node.id}: pure-logic must stand alone in hostRequirements, got ${JSON.stringify(raw)}`)
  }
  const ranks = values.map((tier) => TIER_RANK.get(tier) ?? -1)
  if (ranks.every((rank) => rank >= 0) && ranks.some((rank, index) => index > 0 && rank < (ranks[index - 1] ?? 0))) {
    errors.push(`${node.id}: hostRequirements must use the analyzer's report order [${TIERS.join(", ")}], got ${JSON.stringify(raw)}`)
  }
  return values.every((tier) => TIER_SET.has(tier)) ? (values as HostRequirement[]) : null
}

/** Only the fields this write path reads; the artifact carries much more evidence than the manifest needs. */
type HostRequirementsArtifactNode = Pick<
  NodeHostRequirementRecord,
  "id" | "hostRequirements" | "reasons" | "requirementEvidence" | "processes" | "unresolvedProcessCalls"
>

interface HostRequirementsArtifact {
  nodes: HostRequirementsArtifactNode[]
}

/**
 * Verdicts come from the AST artifact only; the manifest stays the single written source of truth so a
 * generated report can never be hand-edited into a claim about which host services a crate needs
 * (ADR-0067). Retained nodes the artifact never measured keep null and are named in the report line.
 */
async function applyHostRequirements(reportFile: string): Promise<string> {
  const [report, manifest] = await Promise.all([
    readFile(resolve(reportFile), "utf8").then((text) => JSON.parse(text) as HostRequirementsArtifact),
    readManifest(),
  ])
  const artifactRelative = relative(repoRoot, resolve(reportFile))
  const byId = new Map(report.nodes.map((node) => [node.id, node]))
  const filled: string[] = []
  const unaudited: string[] = []
  let normalized = 0

  manifest.schemaVersion = MANIFEST_SCHEMA_VERSION
  for (const node of manifest.nodes) {
    // Only a node the rewrite owes a native crate carries a verdict; the rest normalize to null so an
    // older spelling (`wasmFeasibility`, a `pending-audit` element) cannot survive the write path.
    if (node.disposition !== "retain-rewrite") {
      delete node.wasmFeasibility
      delete node.programs
      delete node.pendingProcessGrants
      if (node.hostRequirements !== null && node.hostRequirements !== undefined) {
        node.hostRequirements = null
        normalized += 1
      } else if (node.hostRequirements === undefined) {
        node.hostRequirements = null
      }
      continue
    }
    delete node.wasmFeasibility
    const verdict = byId.get(node.id)
    if (!verdict) {
      unaudited.push(node.id)
      node.hostRequirements = null
      continue
    }
    node.hostRequirements = [...verdict.hostRequirements]

    // Proven names come from the artifact; a human-decided name survives a regeneration only because its
    // `program: <name> …` evidence line is kept, which is also what the audit arm demands of it.
    const proven = verdict.processes ?? []
    const unresolved = verdict.unresolvedProcessCalls ?? []
    const handEvidence = node.evidence.filter((line) => line.startsWith("program: "))
    const provenNames = new Set(proven.map((item) => item.program))
    const handNames = handEvidence
      .map((line) => line.slice("program: ".length).split(" ")[0] ?? "")
      .filter((name) => name.length > 0 && !provenNames.has(name))
    const programs = [...new Set([...provenNames, ...handNames])].sort()
    if (programs.length > 0) {
      // A human's earlier decision about the danger gate survives a regeneration; a new name gets the shell rule.
      const decided = new Map((node.programs ?? []).map((grant) => [grant.name, grant.confirmBeforeRun]))
      node.programs = programs.map((name) => ({ name, confirmBeforeRun: decided.get(name) ?? confirmBeforeRunFor(name) }))
    } else {
      delete node.programs
    }
    if (unresolved.length > 0) {
      node.pendingProcessGrants = unresolved.map((item) => `${item.argument} at ${item.file}:${item.line}`)
    } else {
      delete node.pendingProcessGrants
    }

    const evidence = [
      `artifacts: ${artifactRelative}`,
      ...verdict.reasons.map((reason) => `hostRequirements: ${reason}`),
      ...verdict.requirementEvidence.slice(0, 3).map((item) => `${item.file}:${item.line} ${item.requirement} ${item.marker}`),
      ...proven.map((item) => `program: ${item.program} ${item.via} at ${item.file}:${item.line}`),
      ...handEvidence.filter((line) => !provenNames.has(line.slice("program: ".length).split(" ")[0] ?? "")),
    ]
    node.evidence = [...new Set(evidence)]
    filled.push(node.id)
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const missing = unaudited.length ? `; NO ARTIFACT ENTRY for ${unaudited.join(", ")} (left at null)` : ""
  const cleared = normalized ? `; cleared ${normalized} non-retained verdict(s) to null` : ""
  return `Applied ${filled.length} host-requirement tier list(s) from ${artifactRelative}${cleared}${missing}`
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
}

async function nodeDirectories(): Promise<string[]> {
  const entries = await readdir(nodesRoot, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name).sort()
}

/** A flag with an optional value: `--apply-host-requirements` alone uses the analyzer's own output path. */
function optionalFlagPath(flag: string, defaultValue: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index < 0) return undefined
  const next = process.argv[index + 1]
  return next === undefined || next.startsWith("-") ? defaultValue : resolve(next)
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict")
  const writeSkeleton = process.argv.includes("--write")
  const applyPath = optionalFlagPath("--apply-host-requirements", defaultArtifactPath)
  const surfaceArgIndex = process.argv.indexOf("--surface")
  const surfaceArg = surfaceArgIndex >= 0 ? process.argv[surfaceArgIndex + 1] : undefined

  // The renamed flag must not age out into a silently accepted alias, or the stale commands in
  // docs/adr/0067:93, docs/migration/dissolvef-native-port.md:172 and packages/tauri-migrate/README.md:79
  // keep pointing at `artifacts/node-wasm-feasibility.json` forever. Those docs still need their own fix.
  if (process.argv.includes("--apply-feasibility")) {
    throw new Error("--apply-feasibility was renamed by ADR-0073 to --apply-host-requirements [artifacts/node-host-requirements.json].")
  }

  if (applyPath) console.log(await applyHostRequirements(applyPath))
  const [manifest, dirs, disabled] = await Promise.all([readManifest(), nodeDirectories(), getDisabledNodeIds({ cwd: repoRoot, env: process.env })])
  const records = new Map(manifest.nodes.map((node) => [node.id, node]))
  const result = auditManifestRecords({ manifest, dirs, disabled, strict })
  const errors = result.errors
  const warnings = result.warnings

  if (writeSkeleton) {
    for (const id of dirs) {
      if (records.has(id)) continue
      const record: NodeRecord = { id, disposition: "retain-rewrite", hostRequirements: null, evidence: [`packages/nodes/${id}/src/index.ts`] }
      manifest.nodes.push(record)
      records.set(id, record)
    }
    manifest.schemaVersion = MANIFEST_SCHEMA_VERSION
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
      const raw = surfaces.get(node.id) ?? []
      const kept = new Set(node.keptReferences ?? [])
      for (const path of kept) {
        if (!dirs.includes(node.id) && !existsSync(join(repoRoot, path))) {
          errors.push(`${node.id}: keptReferences entry no longer exists and should be deleted from the manifest: ${path}`)
        }
      }
      const findings = raw.filter((finding) => !kept.has(finding.path))
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

  // Positive control lives in auditManifestRecords (empty scan / empty decision set / empty retained set),
  // so the gate fails there instead of printing a passing line here.

  for (const warning of warnings) console.warn(`WARN  ${warning}`)

  if (errors.length) {
    for (const error of errors) console.error(`FAIL  ${error}`)
    throw new Error(`audit:target-node-manifest found ${errors.length} problem(s).`)
  }

  const tiers = TIERS.filter((tier) => result.tierCounts[tier] > 0).map((tier) => `${tier} ${result.tierCounts[tier]}`).join(", ")
  console.log(
    `OK target-node manifest: ${result.recordCount} records, ${result.dirCount} node directories, ${result.retainedCount} retained, ` +
      `disabled = [${disabled.join(", ")}], retained tiers = ${tiers || "none"}, ` +
      `${result.unauditedRetained.length} retained node(s) without a measured verdict${strict ? "" : " (non-strict)"}.`,
  )
}

if (import.meta.main) {
  await main()
}
