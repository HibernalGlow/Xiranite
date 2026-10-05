import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { HOST_REQUIREMENTS } from "../packages/tauri-migrate/src/node-feasibility.ts"

import {
  auditManifestRecords,
  MANIFEST_SCHEMA_VERSION,
  TIERS,
  type Manifest,
  type ManifestAuditInput,
  type NodeRecord,
} from "./audit-target-node-manifest.ts"
import { resolveCeiling } from "./lib/node-ceiling.ts"

/**
 * Positive controls for ADR-0073's `wasmFeasibility` -> `hostRequirements` rename. The gate reads its tier
 * vocabulary from the analyzer, so these fixtures are what proves the gate still turns red on the shapes the
 * rename must not tolerate: an unknown tier, an empty array, a retained node with no measured verdict, a
 * verdict on a node that owes none, and the pre-rename spellings. Injecting into the real manifest would
 * touch another task's work, so the malformed records live here instead.
 */

/** `packages/nodes` directories, kept in step with the fixtures so the fs rules stay silent: "gone" has none. */
const DIRS = ["alpha", "bravo", "held"]
const DISABLED = ["held"]

function record(overrides: Partial<NodeRecord> & { id: string }): NodeRecord {
  return {
    disposition: "retain-rewrite",
    hostRequirements: ["file-io"],
    evidence: ["packages/nodes/alpha/src/core.ts:1 node:fs/promises"],
    ...overrides,
  }
}

function cleanNodes(): NodeRecord[] {
  return [
    record({
      id: "alpha",
      maxLiveBytes: 16_777_216,
      evidence: [
        "packages/nodes/alpha/src/core.ts:1 node:fs/promises",
        "maxLiveBytes: 16 MiB operator ceiling for the file-io run",
      ],
    }),
    record({
      id: "bravo",
      hostRequirements: ["pure-logic"],
      maxLiveBytes: 8_388_608,
      evidence: ["packages/nodes/bravo/src/core.ts:1 zod", "maxLiveBytes: 8 MiB operator ceiling for the pure-logic run"],
    }),
    record({ id: "gone", disposition: "removed", hostRequirements: null, evidence: ["commit ae6b34d3 on branch xiranite-rust-rewrite"] }),
    record({ id: "held", disposition: "hold-unmigrated", hostRequirements: null, evidence: ["xiranite.build.toml:4"] }),
  ]
}

function audit(
  nodes: NodeRecord[],
  options: { strict?: boolean; schemaVersion?: number } = {},
) {
  const manifest: Manifest = {
    schemaVersion: options.schemaVersion ?? MANIFEST_SCHEMA_VERSION,
    decidedBy: ["docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md"],
    policy: "fixture",
    nodes,
  }
  const input: ManifestAuditInput = { manifest, dirs: DIRS, disabled: DISABLED, strict: options.strict === true }
  return auditManifestRecords(input)
}

/** Replace `alpha`, the retained record, with a given `hostRequirements` shape. */
function retainedWith(hostRequirements: unknown, extra: Partial<NodeRecord> = {}) {
  const nodes = cleanNodes()
  nodes[0] = { ...nodes[0]!, ...extra, hostRequirements: hostRequirements as NodeRecord["hostRequirements"] }
  return audit(nodes)
}

test("a manifest in the ADR-0073 shape passes, even under --strict", () => {
  const result = audit(cleanNodes(), { strict: true })
  expect(result.errors).toEqual([])
  expect(result.warnings).toEqual([])
  expect(result.unauditedRetained).toEqual([])
  expect(result.recordCount).toBe(4)
  expect(result.dirCount).toBe(3)
  expect(result.retainedCount).toBe(2)
  expect(result.tierCounts["file-io"]).toBe(1)
  expect(result.tierCounts["pure-logic"]).toBe(1)
})

test("the gate's tier vocabulary is the analyzer's own, and the ADR-0073 tier set", () => {
  expect(TIERS).toBe(HOST_REQUIREMENTS)
  expect([...TIERS].sort()).toEqual([
    "external-process",
    "file-io",
    "network",
    "no-host-free-answer",
    "os-native",
    "pure-logic",
    "recursive-enumeration",
  ])
})

test("an unknown tier turns the gate red", () => {
  expect(retainedWith(["not-a-tier"]).errors.join("\n")).toContain('unknown hostRequirements tier "not-a-tier"')
})

test("a retired wasmFeasibility verdict string is not a tier", () => {
  for (const retired of ["wasm-plugin", "wasm-with-host-io", "rust-host", "blocked-native", "manual-review"]) {
    expect(retainedWith([retired]).errors.join("\n")).toContain(`unknown hostRequirements tier ${JSON.stringify(retired)}`)
  }
})

test("a pending-audit sentinel inside the array is rejected: no artifact can emit it", () => {
  const alone = retainedWith(["pending-audit"])
  expect(alone.errors.join("\n")).toContain('hostRequirements carries the pre-rename "pending-audit" sentinel')
  // It must not read as a verdict either, so the retained node is still counted as unaudited.
  expect(alone.unauditedRetained).toEqual(["alpha"])

  const mixed = retainedWith(["pending-audit", "file-io"])
  expect(mixed.errors.join("\n")).toContain('hostRequirements carries the pre-rename "pending-audit" sentinel')
  expect(mixed.tierCounts["file-io"]).toBe(0)
})

test("an empty array is a failure in every mode, never a silent pure-logic read", () => {
  for (const strict of [false, true]) {
    const result = audit(
      cleanNodes().map((node, index) => (index === 0 ? { ...node, hostRequirements: [] } : node)),
      { strict },
    )
    expect(result.errors.join("\n")).toContain("hostRequirements is an empty array")
    // The only pure-logic counted is bravo's real verdict, so the empty array read as nothing at all.
    expect(result.tierCounts["pure-logic"]).toBe(1)
  }
})

test("a retained node with no measured verdict warns, and fails under --strict", () => {
  const absent = retainedWith(undefined)
  expect(absent.errors).toEqual([])
  expect(absent.unauditedRetained).toEqual(["alpha"])
  expect(absent.warnings.join("\n")).toContain("retained but hostRequirements carries no measured verdict")

  const absentStrict = audit(cleanNodes().map((node, index) => (index === 0 ? { ...node, hostRequirements: undefined } : node)), { strict: true })
  expect(absentStrict.errors.join("\n")).toContain("alpha: retained but hostRequirements carries no measured verdict")

  const literalNullStrict = audit(cleanNodes().map((node, index) => (index === 0 ? { ...node, hostRequirements: null } : node)), { strict: true })
  expect(literalNullStrict.errors.join("\n")).toContain("alpha: retained but hostRequirements carries no measured verdict")
})

test("a node that owes no native crate must not carry a verdict", () => {
  const removed = audit(cleanNodes().map((node) => (node.id === "gone" ? { ...node, hostRequirements: ["file-io"] } : node)))
  expect(removed.errors.join("\n")).toContain('disposition removed must carry "hostRequirements": null')

  const dropped = audit([...cleanNodes(), record({ id: "dropped", disposition: "drop-to-standalone", standalone: "some-project", hostRequirements: ["file-io"] })])
  expect(dropped.errors.join("\n")).toContain('disposition drop-to-standalone must carry "hostRequirements": null')

  const held = audit(cleanNodes().map((node) => (node.id === "held" ? { ...node, hostRequirements: ["file-io"] } : node)))
  expect(held.errors.join("\n")).toContain('hold-unmigrated must carry "hostRequirements": null')
})

test("pure-logic must stand alone", () => {
  expect(retainedWith(["pure-logic", "file-io"]).errors.join("\n")).toContain("pure-logic must stand alone")
})

test("tiers must keep the analyzer's report order, which the artifact already uses", () => {
  const unordered = retainedWith(["file-io", "recursive-enumeration"])
  expect(unordered.errors.join("\n")).toContain("must use the analyzer's report order")
  expect(unordered.errors.join("\n")).not.toContain("unknown hostRequirements tier")

  const ordered = retainedWith(["recursive-enumeration", "file-io"])
  expect(ordered.errors).toEqual([])
})

test("a duplicated tier is a finding, not a count of two", () => {
  const result = retainedWith(["file-io", "file-io"])
  expect(result.errors.join("\n")).toContain("lists a tier twice")
  expect(result.tierCounts["file-io"]).toBe(1)
})

test("an empty scan or an empty decision set cannot read as a passing gate", () => {
  const emptyDirs = auditManifestRecords({
    manifest: { schemaVersion: MANIFEST_SCHEMA_VERSION, decidedBy: [], policy: "fixture", nodes: cleanNodes() },
    dirs: [],
    disabled: DISABLED,
    strict: false,
  })
  expect(emptyDirs.errors.join("\n")).toContain("an empty scan must not read as a passing gate")

  const emptyManifest = auditManifestRecords({
    manifest: { schemaVersion: MANIFEST_SCHEMA_VERSION, decidedBy: [], policy: "fixture", nodes: [] },
    dirs: DIRS,
    disabled: [],
    strict: false,
  })
  expect(emptyManifest.errors.join("\n")).toContain("an empty decision set must not read as a passing gate")

  const nobodyRetained = auditManifestRecords({
    manifest: { schemaVersion: MANIFEST_SCHEMA_VERSION, decidedBy: [], policy: "fixture", nodes: cleanNodes().map((node) => ({ ...node, disposition: "removed" as const })) },
    dirs: DIRS,
    disabled: [],
    strict: false,
  })
  expect(nobodyRetained.errors.join("\n")).toContain("an empty retained set must not read as a passing gate")
})

test("a schemaVersion 1 file, the wasmFeasibility shape, is a finding rather than a pass", () => {
  expect(MANIFEST_SCHEMA_VERSION).toBe(2)
  expect(audit(cleanNodes()).errors).toEqual([])
  expect(audit(cleanNodes(), { schemaVersion: 1 }).errors.join("\n")).toContain("schemaVersion is 1, expected 2")
})

test("the pre-rename wasmFeasibility key cannot ride along next to the new field", () => {
  const result = audit(cleanNodes().map((node, index) => (index === 0 ? { ...node, wasmFeasibility: "wasm-with-host-io" } : node)))
  expect(result.errors.join("\n")).toContain("still carries the retired wasmFeasibility field")
})

test("a verdict that is not an array at all is a finding", () => {
  expect(retainedWith("file-io").errors.join("\n")).toContain("must be an array of tiers or null")
})

test("external-process without a named program or a pending grant is a finding", () => {
  const silent = retainedWith(["external-process", "file-io"])
  expect(silent.errors.join("\n")).toContain("names no program and no pending grant")
  // Positive control: the same record that only *discloses* a run-time-computed name is clean, so the finding is
  // the silence and not the tier.
  const disclosed = retainedWith(["external-process", "file-io"], {
    pendingProcessGrants: ["command at packages/nodes/alpha/src/platform.ts:132"],
  })
  expect(disclosed.errors.join("\n")).not.toContain("names no program")
  const granted = retainedWith(["external-process", "file-io"], {
    programs: [{ name: "7z.exe", confirmBeforeRun: false }],
    evidence: [
      "packages/nodes/alpha/src/core.ts:1 node:fs/promises",
      "program: 7z.exe literal at packages/nodes/alpha/src/platform.ts:132",
      "maxLiveBytes: 16 MiB operator ceiling for the file-io run",
    ],
  })
  expect(granted.errors).toEqual([])
})

test("an allowlist entry nobody proved is refused, and grants without the tier are refused", () => {
  const unproven = retainedWith(["external-process", "file-io"], { programs: [{ name: "notepad.exe", confirmBeforeRun: false }] })
  expect(unproven.errors.join("\n")).toContain('programs lists "notepad.exe" with no "program: notepad.exe')
  const tierless = retainedWith(["file-io"], {
    programs: [{ name: "tar", confirmBeforeRun: false }],
    evidence: ["packages/nodes/alpha/src/core.ts:1 node:fs/promises", "program: tar literal at packages/nodes/alpha/src/platform.ts:9"],
  })
  expect(tierless.errors.join("\n")).toContain("no external-process tier")
})

test("a service grant needs the analyzer's evidence line, and the name has to be a registry key", () => {
  const unsourced = retainedWith(["file-io"], {
    services: ["czkawka"],
    evidence: ["packages/nodes/alpha/src/core.ts:1 node:fs/promises"],
  })
  expect(unsourced.errors.join("\n")).toContain('services lists "czkawka" with no "service: czkawka')

  const sourced = retainedWith(["file-io"], {
    services: ["czkawka"],
    evidence: [
      "packages/nodes/alpha/src/core.ts:1 node:fs/promises",
      "maxLiveBytes: 16 MiB operator ceiling for the file-io run",
      "service: czkawka aliased @xiranite/czkawka-native -> shims/czkawka-service.ts at packages/nodes/alpha/src/platform.ts:2",
    ],
  })
  expect(sourced.errors).toEqual([])

  // Names here are keys the host's service table is dispatched on, so prose cannot ride in as a grant.
  const misspelled = retainedWith(["file-io"], {
    services: ["Czkawka Native"],
    evidence: ["packages/nodes/alpha/src/core.ts:1 node:fs/promises", "service: Czkawka Native whatever"],
  })
  expect(misspelled.errors.join("\n")).toContain("must be a bare service name")
})

test("a live-byte ceiling is either sourced or named as missing, never silently absent", () => {
  // The host refuses to schedule `max_live_bytes = 0`, so "no ceiling" is a registration blocker rather than an
  // unlimited run. The gate's job is to make the two legal shapes obvious (a sourced number, or a named absence)
  // and to refuse the third (a bare number nobody explains).
  const sourced = retainedWith(["file-io"], {
    maxLiveBytes: 8_388_608,
    evidence: [
      "packages/nodes/alpha/src/core.ts:1 node:fs/promises",
      "maxLiveBytes: operator decision for the 8 MiB single-buffer ceiling in xiranite-core",
    ],
  })
  expect(sourced.errors).toEqual([])
  expect(sourced.warnings.join("\n")).not.toContain("no live-byte ceiling in the manifest (alpha")

  const magic = retainedWith(["file-io"], {
    maxLiveBytes: 8_388_608,
    evidence: ["packages/nodes/alpha/src/core.ts:1 node:fs/promises"],
  })
  expect(magic.errors.join("\n")).toContain('no "maxLiveBytes: <source>" evidence line')

  // 0 is the spelling the registry means as "undeclared", so it must never be written as if it were a limit.
  const zero = retainedWith(["file-io"], {
    maxLiveBytes: 0,
    evidence: ["packages/nodes/alpha/src/core.ts:1 node:fs/promises", "maxLiveBytes: from the wasm manifest"],
  })
  expect(zero.errors.join("\n")).toContain("must be a positive whole byte count or null")

  const fraction = retainedWith(["file-io"], {
    maxLiveBytes: 1024.5,
    evidence: ["packages/nodes/alpha/src/core.ts:1 node:fs/promises", "maxLiveBytes: measured peak"],
  })
  expect(fraction.errors.join("\n")).toContain("must be a positive whole byte count or null")

  // Disclosure with a positive control on both sides: the same fixture reads as ceiling-less only once the
  // numbers are taken back out, and a node that owes no native crate is never a ceiling decision, so
  // `removed`/`hold-unmigrated` must not appear in the named list.
  const ceilingless = audit(cleanNodes().map((node) => node.disposition === "retain-rewrite"
    ? { ...node, maxLiveBytes: null, evidence: node.evidence.filter((line) => !line.startsWith("maxLiveBytes: ")) }
    : node))
  expect(ceilingless.warnings.join("\n")).toContain("have no live-byte ceiling in the manifest")
  expect(ceilingless.warnings.join("\n")).not.toMatch(/ceiling in the manifest \([^)]*\b(gone|held)\b/)
})

test("a declared run deadline is sourced like a ceiling, and an undeclared one is the ordinary answer", () => {
  // Unlike `maxLiveBytes`, an absent deadline is not a blocker: the executor keeps its own 120 s bound and that
  // is right for every node whose run length follows from its bytes. What the gate owns is the case where a node
  // *does* state one, because a number nobody explains is how a waiting node gets cut off mid-wait by a timeout
  // someone thought was a limit.
  const ceilingEvidence = [
    "packages/nodes/alpha/src/core.ts:1 node:fs/promises",
    "maxLiveBytes: 16 MiB operator ceiling for the file-io run",
  ]

  const sourced = retainedWith(["file-io"], {
    runDeadlineMs: 86_400_000,
    evidence: [...ceilingEvidence, "runDeadlineMs: 24 h, one hour above the 23 h this node's own input range allows"],
  })
  expect(sourced.errors).toEqual([])

  const magic = retainedWith(["file-io"], { runDeadlineMs: 86_400_000, evidence: ceilingEvidence })
  expect(magic.errors.join("\n")).toContain('no "runDeadlineMs: <source>" evidence line')

  const zero = retainedWith(["file-io"], {
    runDeadlineMs: 0,
    evidence: [...ceilingEvidence, "runDeadlineMs: a guess"],
  })
  expect(zero.errors.join("\n")).toContain("must be a positive whole millisecond count or null")

  const fraction = retainedWith(["file-io"], {
    runDeadlineMs: 1500.5,
    evidence: [...ceilingEvidence, "runDeadlineMs: a guess"],
  })
  expect(fraction.errors.join("\n")).toContain("must be a positive whole millisecond count or null")

  // The control that keeps the three above from being green-by-construction: the same fixture with no deadline at
  // all must pass, and must not be swept into any named-missing list.
  const undeclared = retainedWith(["file-io"], { evidence: ceilingEvidence })
  expect(undeclared.errors).toEqual([])
  expect(undeclared.warnings.join("\n")).not.toContain("runDeadlineMs")
})

test("the manifest column is the only ceiling source, and nothing is fallen through to", () => {
  // The wasm-era `plugins/<id>/manifest.toml` page count went with the Extism tree on 2026-10-05, so a node
  // with no `maxLiveBytes` must be refused rather than quietly inheriting a limit nobody set here.
  expect(resolveCeiling(8_388_608)).toEqual({ bytes: 8_388_608 })
  expect("bytes" in resolveCeiling(null)).toBe(false)
  expect("bytes" in resolveCeiling(undefined)).toBe(false)
})

test("no ceiling is a refusal that names the field to fill, never an unlimited run", () => {
  const refused = resolveCeiling(null)
  expect("bytes" in refused).toBe(false)
  expect(refused.refusal).toContain("refuses max_live_bytes = 0")
  // The refusal has to point at the one place that now answers this, or it is a dead end for whoever reads it.
  expect(refused.refusal).toContain("maxLiveBytes")
  expect(refused.refusal).toContain("docs/xiranite-target-node-manifest.json")
})

test("a malformed ceiling is refused instead of being fallen through or rounded", () => {
  // Ignoring a typo here would either drop the node's limit or register a run the host then refuses.
  for (const declared of [0, -1, 1024.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const outcome = resolveCeiling(declared)
    expect("refusal" in outcome, `${String(declared)} must be refused, got ${JSON.stringify(outcome)}`).toBe(true)
    expect(refusalText(outcome)).toContain("not a positive whole byte count")
  }
  expect(refusalText(resolveCeiling(0))).toContain("0")
})

/** The refusal text, failing loudly when the arm answered a number instead. */
function refusalText(outcome: { bytes: number } | { refusal: string }): string {
  if ("refusal" in outcome) return outcome.refusal
  throw new Error(`expected a refusal, got bytes ${outcome.bytes}`)
}

/**
 * Positive control on the wiring itself: `resolveCeiling`'s answer is what reaches the emitted `.budget()`.
 * This is a shape assertion over the generator's own source, so it catches the one regression that matters
 * (the chain going back to a `pages`-only expression) and nothing else — the behavioural proof stays above.
 */
test("the generator emits the resolved ceiling, not the raw page count", async () => {
  const source = await readFile(resolve(import.meta.dirname, "embed-node-bundles.ts"), "utf8")
  expect(source).toContain("chain.push(`.budget(${ceilingBytes}, 1)`)")
  expect(source).not.toContain(".budget(${pages * 65536}, 1)")
})
