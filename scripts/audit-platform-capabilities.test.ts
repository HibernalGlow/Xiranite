/**
 * Pins for `audit:platform-capabilities`, including the case that must turn it red.
 *
 * The meter has three things that can silently read as zero: a line-scanning rule that misses a multi-line
 * import clause, a node filter that quietly includes nothing, and a baseline comparison that never fails.
 * Each gets its own case against a fixture tree, per `scripts/audit-node-ui-independence.test.ts`.
 */
import { readFileSync } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import { auditPlatformFiles, compareWithBaseline, type PlatformAuditReport } from "./audit-platform-capabilities.ts"

interface Fixture {
  root: string
  cleanup: () => Promise<void>
}

/** A report shaped like a fully migrated tree, used to test the shipped ceiling against a real pass. */
const emptyPathReport = { machineImports: 0, filesWithMachineImports: 0, pathImports: 0, pathFiles: 0 } as PlatformAuditReport

async function fixture(files: Record<string, string>, manifest: unknown[]): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "platform-audit-"))
  await mkdir(join(root, "docs"), { recursive: true })
  await writeFile(join(root, "docs", "xiranite-target-node-manifest.json"), JSON.stringify({ nodes: manifest }))
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true })
    await writeFile(target, source)
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

describe("audit:platform-capabilities", () => {
  it("sees a machine import written across an import clause, and ignores node:path", async () => {
    const f = await fixture(
      {
        "packages/nodes/alpha/src/platform.ts":
          'import {\n  readFile,\n  writeFile,\n} from "node:fs/promises"\n\nexport const a = [readFile, writeFile]\n',
        "packages/nodes/beta/src/platform.ts":
          'import { hostCapabilities } from "@xiranite/host-capabilities"\nimport { join } from "node:path"\n\nexport const b = [hostCapabilities, join]\n',
        "packages/nodes/gamma/src/platform.ts": 'import { rm } from "node:fs/promises"\n\nexport const g = rm\n',
      },
      [
        { id: "alpha", disposition: "retain-rewrite" },
        { id: "beta", disposition: "retain-rewrite" },
        { id: "gamma", disposition: "removed" },
      ],
    )
    try {
      const report = await auditPlatformFiles(f.root)
      expect(report.retainedNodes).toBe(2)
      expect(report.platformFiles).toBe(2)
      // POSITIVE CONTROL: the multi-line clause counts. A row-scanning rule reports 0 here and looks clean.
      expect(report.machineImports).toBe(1)
      // The path ceiling counts apart from the machine one, and the fixture proves they are not the same
      // edges: only `beta` imports `node:path` (it also uses the surface), `alpha`'s edge is `node:fs/promises`,
      // and `gamma`'s is excluded by disposition.
      expect(report.pathImports).toBe(1)
      expect(report.pathFiles).toBe(1)
      expect(report.records.find((record) => record.id === "beta")?.pathImports.map((entry) => entry.specifier)).toEqual(["node:path"])
      expect(report.records.find((record) => record.id === "alpha")?.pathImports).toEqual([])
      expect(report.records.find((record) => record.id === "alpha")?.machineImports[0]?.specifier).toBe(
        "node:fs/promises",
      )
      expect(report.records.find((record) => record.id === "beta")).toMatchObject({
        machineImports: [],
        usesCapabilities: true,
      })
      // A removed node's violation must not inflate the number either — that would hide real progress.
      // The fixture also proves the filter is keyed on the manifest's literal: "retained" reads zero.
      expect(report.records.find((record) => record.id === "gamma")).toBeUndefined()
    } finally {
      await f.cleanup()
    }
  })

  it("POSITIVE CONTROL: a rise over either ceiling fails, and a fall does not", () => {
    const report = { machineImports: 4, filesWithMachineImports: 2, pathImports: 23, pathFiles: 23 } as PlatformAuditReport
    expect(compareWithBaseline(report, { machineImports: 4, filesWithMachineImports: 2, pathImports: 23, pathFiles: 23 })).toEqual([])
    const worse = compareWithBaseline({ ...report, machineImports: 5 }, { machineImports: 4, filesWithMachineImports: 2 })
    expect(worse.length).toBe(1)
    expect(worse[0]).toContain("rose to 5")
    expect(compareWithBaseline({ ...report, machineImports: 1, filesWithMachineImports: 1 }, { machineImports: 4, filesWithMachineImports: 2 })).toEqual([])
    // The path ceiling has to bite on its own: the `node:path` pass is a separate decision from the machine
    // gaps, so a report that only regressed path must still be refused.
    const pathWorse = compareWithBaseline({ ...report, pathImports: 24, pathFiles: 24 }, { machineImports: 4, filesWithMachineImports: 2, pathImports: 23, pathFiles: 23 })
    expect(pathWorse.length).toBe(2)
    expect(pathWorse.join(" ")).toContain("node:path imported directly by a node platform.ts rose to 24")
  })

  it("POSITIVE CONTROL: the shipped path ceiling is 0, so one node:path import is already red", () => {
    // A ceiling of 0 is the shape most likely to be misread as "no ceiling", so this reads the file the gate
    // reads instead of a fixture number: today's live tree answers 0, and the very first re-introduced
    // `node:path` import has to be refused by that same object.
    const shipped = JSON.parse(readFileSync(new URL("../docs/platform-capabilities-baseline.json", import.meta.url), "utf8")) as {
      machineImports: number
      filesWithMachineImports: number
      pathImports: number
      pathFiles: number
    }
    expect(shipped.pathImports).toBe(0)
    expect(shipped.pathFiles).toBe(0)
    const clean = { ...emptyPathReport, machineImports: shipped.machineImports, filesWithMachineImports: shipped.filesWithMachineImports }
    expect(compareWithBaseline(clean, shipped)).toEqual([])
    const oneBack = compareWithBaseline({ ...clean, pathImports: 1, pathFiles: 1 }, shipped)
    expect(oneBack.length).toBe(2)
    expect(oneBack.join(" ")).toContain("rose to 1 (baseline 0)")
  })

  it("POSITIVE CONTROL: an empty node set is reported as empty, not as green-by-nothing", async () => {
    const f = await fixture({}, [{ id: "alpha", disposition: "retain-rewrite" }])
    try {
      const report = await auditPlatformFiles(f.root)
      // The retained count is the denominator; 0 platform files with a non-zero retained set is the shape
      // that would make every other assertion vacuous, so it is checked where it is produced.
      expect(report.retainedNodes).toBe(1)
      expect(report.platformFiles).toBe(0)
    } finally {
      await f.cleanup()
    }
  })
})
