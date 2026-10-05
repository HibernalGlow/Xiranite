/**
 * Pins for the two rules `audit:node-registry` gained when the scripted table became a registration path.
 *
 * The gate used to answer "is this retained node registered?" with "does `crates/nodes/<id>/` exist?",
 * which is the architecture ADR-0074 §1 retired: a node's one implementation is its TypeScript bundle, and
 * per-node Rust crates were zeroed by user decision on 2026-10-05. A gate pointed at work nobody may do is
 * worse than no gate — it reads as 26 pending ports while the real number was 12 unserved nodes.
 *
 * Every rule here gets the case that must turn it red, per `scripts/audit-quickjs-host-ops.test.ts`:
 *
 * 1. a node served only by the scripted table must NOT count as unserved — the assertion is written against
 *    an id computed from the tree, so it cannot silently become vacuous;
 * 2. a node served by BOTH paths must be reported as a failure (that is ADR-0074 §1's one-implementation
 *    rule, and it is currently true for real nodes in this repo, so the rule has live evidence);
 * 3. both scans must be non-empty, because an empty read of `registration.rs` would otherwise pass (1) by
 *    finding no scripted ids and (2) by finding no overlap.
 *
 * Run with: bun test scripts/audit-node-registry.test.ts   — reads the tree, no cargo.
 *
 * Why `bun:test` rather than Vitest: the root `vite.config.ts` collects test files under `src` only, so a
 * Vitest file in this `scripts` directory is never gathered (measured: `No test files found`). The sibling
 * gate tests in this directory already run this way — `package.json`'s `test:quickjs-host-ops` is
 * `bun test scripts/audit-quickjs-host-ops.test.ts` — and the assertions below are plain matcher calls with
 * no Bun semantics beyond the runner, so this adds no Bun coupling to product code (ADR-0075).
 */

import { readFile } from "node:fs/promises"
import { describe, expect, it } from "bun:test"

import { auditNodeRegistry } from "./audit-node-registry.ts"

const repoRoot = new URL("..", import.meta.url).pathname

async function scriptedIds(): Promise<{ served: string[]; embedded: string[] }> {
  const table = await readFile(joinRepo("crates/xiranite-scripted-nodes/src/registration.rs"), "utf8")
  const served = /pub const SCRIPTED_NODE_IDS: &\[[^\]]*\]\s*=\s*&?\[([^\]]*)\]/.exec(table)?.[1] ?? ""
  const index = JSON.parse(await readFile(joinRepo("crates/xiranite-quickjs-executor/bundles/index.json"), "utf8")) as {
    nodes: Array<{ id: string }>
  }
  return { served: [...served.matchAll(/"([^"]+)"/g)].map((match) => match[1]), embedded: index.nodes.map((node) => node.id) }
}

function joinRepo(relative: string): string {
  return `${repoRoot.replace(/\/$/, "")}/${relative}`
}

describe("audit:node-registry served-by-either-path rules", () => {
  it("treats a scripted-only registration as served, not as a pending port", async () => {
    const [report, scripted] = await Promise.all([auditNodeRegistry(), scriptedIds()])
    expect(scripted.served.length).toBeGreaterThan(0)

    // The ids the Rust side registers are exactly the crates that both are members and call register_node!.
    const nativeServed = new Set(
      report.crates.filter((crate) => crate.isMember && crate.registeredVia !== null).map((crate) => crate.id),
    )
    const scriptedOnly = scripted.served.filter((id) => !nativeServed.has(id) && report.retainedIds.includes(id))
    expect(scriptedOnly.length).toBeGreaterThan(0)

    const unserved = report.pending.map((item) => item.split(":")[0])
    for (const id of scriptedOnly) {
      expect(unserved, `scripted node ${id} must not read as unserved`).not.toContain(id)
    }
  })

  it("reports a node served by both implementations as a failure", async () => {
    const [report, scripted] = await Promise.all([auditNodeRegistry(), scriptedIds()])
    const nativeServed = report.crates
      .filter((crate) => crate.isMember && crate.registeredVia !== null)
      .map((crate) => crate.id)
    const overlap = nativeServed.filter((id) => scripted.served.includes(id))
    expect(overlap.length, "this control needs at least one node served twice in the live tree").toBeGreaterThan(0)

    const flagged = report.errors.filter((item) => item.includes("BOTH"))
    expect(flagged.length).toEqual(overlap.length)
    for (const id of overlap) {
      expect(flagged.some((item) => item.startsWith(`${id}:`)), `expected a BOTH failure for ${id}`).toBe(true)
    }
  })

  it("counts unserved retained nodes against the real gap, not against retired Rust ports", async () => {
    const [report, scripted] = await Promise.all([auditNodeRegistry(), scriptedIds()])
    expect(report.retainedIds.length).toBeGreaterThan(0)

    const nativeServed = new Set(
      report.crates.filter((crate) => crate.isMember && crate.registeredVia !== null).map((crate) => crate.id),
    )
    const expected = report.retainedIds.filter(
      (id) => !nativeServed.has(id) && !scripted.served.includes(id),
    )
    expect(report.pending).toHaveLength(expected.length)
    // The retired wording must not come back: nothing may be reported as needing a Rust port.
    for (const item of report.pending) {
      expect(item).not.toContain("step 3 has not ported it")
    }
  })
})
