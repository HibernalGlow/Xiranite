import { expect, test } from "bun:test"

import { HOST_REQUIREMENTS } from "../packages/tauri-migrate/src/node-feasibility.ts"

import {
  auditManifestRecords,
  MANIFEST_SCHEMA_VERSION,
  TIERS,
  type Manifest,
  type ManifestAuditInput,
  type NodeRecord,
} from "./audit-target-node-manifest.ts"

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
    record({ id: "alpha" }),
    record({ id: "bravo", hostRequirements: ["pure-logic"], evidence: ["packages/nodes/bravo/src/core.ts:1 zod"] }),
    record({ id: "gone", disposition: "removed", hostRequirements: null, evidence: ["commit ae6b34d3 on branch xiranite-rust-rewrite"] }),
    record({ id: "held", disposition: "hold-unmigrated", hostRequirements: null, evidence: ["xiranite.build.toml:4"] }),
  ]
}

function audit(nodes: NodeRecord[], options: { strict?: boolean; schemaVersion?: number } = {}) {
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
