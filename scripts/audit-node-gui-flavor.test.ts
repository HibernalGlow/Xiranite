import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { beforeAll, describe, expect, test } from "bun:test"

import { auditNodeGuiFlavor, flavorGrowth, type NodeFlavorCounts } from "./audit-node-gui-flavor"

interface Fixture {
  nodesRoot: string
  srcRoot: string
  baselinePath: string
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, text, "utf8")
}

/**
 * A tree that holds one clean node, one coupling node, one seam node, one sibling-leaking node and one node
 * with no entry at all. Every category the gate claims to see has a file here that provokes it: a gauge that
 * never sees a violation is not a gauge (ADR-0073's gate rule).
 */
async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-gui-flavor-"))
  const srcRoot = join(root, "src")
  const nodesRoot = join(srcRoot, "nodes")
  const baselinePath = join(root, "baseline.json")

  await write(join(nodesRoot, "clean", "entry.ts"), 'import { Component } from "./Component"\nexport default { Component }\n')
  await write(join(nodesRoot, "clean", "Component.tsx"), 'import { api } from "@/nodes/shared/api"\nexport const Component = () => api\n')
  await write(join(nodesRoot, "shared", "api.ts"), 'import { createXiraniteNodeClient } from "@xiranite/api/client"\nexport const api = createXiraniteNodeClient\n')

  await write(join(nodesRoot, "shellstate", "entry.ts"), 'import { Component } from "./Component"\nexport default { Component }\n')
  await write(join(nodesRoot, "shellstate", "Component.tsx"), 'import { useWorkspace } from "@/store/workspaceStore"\nexport const Component = useWorkspace\n')
  await write(join(srcRoot, "store", "workspaceStore.ts"), "export const useWorkspace = () => null\n")

  await write(join(nodesRoot, "seamy", "entry.ts"), 'import { run } from "@/backend/nodeRpcClient"\nexport default { run }\n')
  await write(join(srcRoot, "backend", "nodeRpcClient.ts"), "export const run = () => null\n")

  await write(join(nodesRoot, "leaky", "entry.ts"), 'import { Other } from "@/nodes/clean/Component"\nexport default { Other }\n')
  await write(join(nodesRoot, "pkgleaky", "entry.ts"), 'import { core } from "@xiranite/node-clean"\nexport default { core }\n')
  await write(join(nodesRoot, "noentry", "note.md"), "no entry.ts here\n")

  await write(join(nodesRoot, "governed", "entry.ts"), 'import { self } from "@xiranite/node-governed"\nexport default { self }\n')

  // A type-only import is erased: ADR-0074 exempts it, so neither the sibling nor the seam rule may fire on it.
  await write(join(nodesRoot, "typeonly", "entry.ts"), 'import type { Other } from "@/nodes/clean/Component"\nimport type { Action } from "@/backend/runtime/runtime"\nexport default { Other: null }\n')
  // A multi-line clause is the shape this repo actually writes; the old line regex could not see it at all.
  await write(join(nodesRoot, "multiline", "entry.ts"), 'import {\n  Other,\n} from "@/nodes/clean/Component"\nexport default { Other }\n')

  return { nodesRoot, srcRoot, baselinePath }
}

async function run(fixture: Fixture, baseline?: Record<string, NodeFlavorCounts>) {
  await write(fixture.baselinePath, JSON.stringify({ schemaVersion: 1, nodes: baseline ?? {} }, null, 2))
  return auditNodeGuiFlavor({ ...fixture })
}

/**
 * The live tree is scanned once and shared: walking 30 entry closures takes seconds, and two tests doing it
 * separately would only make the suite slow enough to hit the per-test timeout.
 */
let livePromise: Promise<Awaited<ReturnType<typeof auditNodeGuiFlavor>>> | null = null
function liveReport(): Promise<Awaited<ReturnType<typeof auditNodeGuiFlavor>>> {
  livePromise ??= auditNodeGuiFlavor({
    nodesRoot: join(process.cwd(), "src/nodes"),
    srcRoot: join(process.cwd(), "src"),
    baselinePath: join(process.cwd(), "docs/node-gui-flavor-baseline.json"),
  })
  return livePromise
}

describe("audit:node-gui-flavor", () => {
  let report: Awaited<ReturnType<typeof auditNodeGuiFlavor>>

  beforeAll(async () => {
    report = await run(await fixture())
  })

  test("sees a shell import reached from the entry (positive control)", async () => {
    const fixed = await run(await fixture(), { shellstate: { coupling: 0, seam: 0, sibling: 0 } })
    expect(fixed.counts.get("shellstate")?.coupling).toBe(1)
    expect(flavorGrowth(fixed).map((item) => item.node)).toContain("shellstate")
  })

  test("seams are their own category", async () => {
    expect(report.counts.get("seamy")?.seam).toBe(1)
  })

  test("a sibling directory reached through @/nodes is a leak", async () => {
    expect(report.counts.get("leaky")?.sibling).toBe(1)
  })

  test("a sibling node package reached by name is a leak", async () => {
    expect(report.counts.get("pkgleaky")?.sibling).toBe(1)
  })

  test("a node reaching its own package is the flavor's intended shape, not a leak", async () => {
    expect(report.counts.get("governed")).toEqual({ coupling: 0, seam: 0, sibling: 0 })
  })

  test("src/nodes/shared is the exempt edge", async () => {
    expect(report.counts.get("clean")).toEqual({ coupling: 0, seam: 0, sibling: 0 })
  })

  test("a type-only import is erased and raises neither sibling nor seam debt", async () => {
    const counts = report.counts.get("typeonly")
    expect(counts).toEqual({ coupling: 0, seam: 0, sibling: 0 })
  })

  test("a multi-line import clause is a real edge the line regex used to miss", async () => {
    expect(report.counts.get("multiline")?.sibling).toBe(1)
  })

  test("an entry is required, and its absence is named", async () => {
    expect(report.missingEntry).toEqual(["noentry"])
  })

  test("refuses to read an empty scan as clean", async () => {
    const missing = await mkdtemp(join(tmpdir(), "xiranite-gui-flavor-empty-"))
    const empty = await auditNodeGuiFlavor({
      nodesRoot: join(missing, "nope"),
      srcRoot: missing,
      baselinePath: join(missing, "baseline.json"),
    })
    expect(empty.nodes.length).toBe(0)
  })

  test("writing a baseline is a success, not its own growth report", async () => {
    // `migrate:node-gui-flavor-baseline` must exit 0 after it writes: comparing the freshly written
    // numbers against the pre-write baseline would call every debt node a regression on its own run.
    const fresh = await fixture()
    await write(fresh.baselinePath, JSON.stringify({ schemaVersion: 1, nodes: {} }))
    const generated = await auditNodeGuiFlavor({ ...fresh, generateBaseline: true })
    expect(flavorGrowth(generated)).toEqual([])
    expect(generated.baseline["shellstate"]?.coupling).toBe(1)

    const reread = await auditNodeGuiFlavor({ ...fresh })
    expect(flavorGrowth(reread)).toEqual([])
  })

  test("the live tree keeps every node UI directory honest about having an entry", async () => {
    const real = await liveReport()
    expect(real.nodes.length).toBeGreaterThan(0)
    expect(real.missingEntry).toEqual([])
  }, 30_000)

  test("the zero-totals assertion is not vacuous: the same sum is non-zero on the fixture tree", () => {
    const sum = { coupling: 0, seam: 0, sibling: 0 }
    for (const counts of report.counts.values()) {
      sum.coupling += counts.coupling
      sum.seam += counts.seam
      sum.sibling += counts.sibling
    }
    expect(sum.coupling + sum.seam + sum.sibling).toBeGreaterThan(0)
  })

  /**   * The door itself, asserted: no node's flavor closure may reach the shell, the transport, or another node.
   * This is the invariant that makes "per-node GUI is a build target, not a future rewrite" true, so it is
   * pinned here rather than left to the committed baseline — a baseline of zeros only blocks *growth*, while
   * this fails if any of the three kinds ever returns to a non-zero live count.
   */
  test("no node's flavor closure may reach the shell, the transport, or a sibling node", async () => {
    const real = await liveReport()
    const totals = { coupling: 0, seam: 0, sibling: 0 }
    for (const counts of real.counts.values()) {
      totals.coupling += counts.coupling
      totals.seam += counts.seam
      totals.sibling += counts.sibling
    }
    expect(totals).toEqual({ coupling: 0, seam: 0, sibling: 0 })
    expect(real.violations).toEqual([])
  }, 30_000)
})
