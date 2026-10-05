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
const emptyPathReport = {
  machineImports: 0,
  filesWithMachineImports: 0,
  pathImports: 0,
  pathFiles: 0,
  nodesWithHiddenMachine: 0,
  hiddenMachineEdges: 0,
  hiddenByPackage: {},
} as PlatformAuditReport

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

  it("counts a builtin reached THROUGH a workspace package, and only along the entry's own graph", async () => {
    // The column exists because the two direct columns can both read clean while the bundle still drags a
    // builtin in through a shared package. Two ways to get this wrong: miss the hop, and the migration claim
    // overstates itself; count a file the entry never imports, and the ceiling pins noise instead of demand.
    const f = await fixture(
      {
        // `exports` names compiled output, the way every workspace package in this repo does.
        "packages/shared/package.json":
          '{ "name": "@xiranite/shared", "exports": { ".": { "default": "./dist/index.js" }, "./platform": { "default": "./dist/platform.js" } } }\n',
        "packages/shared/src/platform.ts": 'import { readFile } from "node:fs/promises"\n\nexport const read = readFile\n',
        // Only reachable from a file the entry never imports: it must not add an edge.
        "packages/shared/src/unused.ts": 'import { homedir } from "node:os"\n\nexport const home = homedir\n',
        "packages/nodes/alpha/src/platform.ts":
          'import { hostCapabilities } from "@xiranite/host-capabilities"\nimport { read } from "@xiranite/shared/platform"\n\nexport const a = [hostCapabilities, read]\n',
        "packages/nodes/beta/src/platform.ts":
          'import { hostCapabilities } from "@xiranite/host-capabilities"\n\nexport const b = hostCapabilities\n',
        "packages/nodes/gamma/src/platform.ts": 'import { read } from "@xiranite/shared"\n\nexport const c = read\n',
      },
      [
        { id: "alpha", disposition: "retain-rewrite" },
        { id: "beta", disposition: "retain-rewrite" },
        { id: "gamma", disposition: "retain-rewrite" },
      ],
    )
    try {
      const report = await auditPlatformFiles(f.root)
      const byId = new Map(report.records.map((record) => [record.id, record]))
      // POSITIVE CONTROL for the hop itself: alpha's direct columns are empty and it does import the surface,
      // so only this column can tell that its bundle still reaches node:fs/promises.
      expect(byId.get("alpha")?.machineImports).toEqual([])
      expect(byId.get("alpha")?.usesCapabilities).toBe(true)
      expect(byId.get("alpha")?.hiddenMachine.map((edge) => `${edge.package}|${edge.specifier}`)).toEqual([
        "@xiranite/shared|node:fs/promises",
      ])
      expect(byId.get("alpha")?.hiddenMachine[0]?.via).toBe("packages/shared/src/platform.ts")
      expect(byId.get("alpha")?.hiddenMachine.some((edge) => edge.specifier === "node:os")).toBe(false)
      // The surface's own Node transport is not a reach: inside a bundle `node.ts` is replaced by `realm.ts`
      // through REALM_PACKAGE_ALIASES, so counting it would report every migrated node as unmigrated.
      expect(byId.get("beta")?.hiddenMachine).toEqual([])
      // `.` resolves to a dist file with no source sibling: an unbuilt artifact is not evidence of a reach.
      expect(byId.get("gamma")?.hiddenMachine).toEqual([])
      expect(report.nodesWithHiddenMachine).toBe(1)
      expect(report.hiddenMachineEdges).toBe(1)
      // The per-package roll-up is the work list the deletion leg reads, so it has to name the package and
      // count distinct builtins, not edges.
      expect(report.hiddenByPackage).toEqual({ "@xiranite/shared": 1 })
    } finally {
      await f.cleanup()
    }
  })

  it("follows the bundle build's alias table instead of charging a node for code the realm never loads", async () => {
    // `HOST_SERVED_PACKAGES` replaces a whole specifier with a host-service module at bundle time. A node
    // importing `@xiranite/config/node` therefore loads `config-service.ts`, never `config/src/node.ts` — and
    // before this rule the column charged it for that file's `node:fs/promises`, which made the ceiling look
    // unreachably high and pointed the deletion leg at a consumer that does not exist.
    const f = await fixture(
      {
        "packages/config/package.json": JSON.stringify({
          name: "@xiranite/config",
          exports: { ".": "./src/index.ts", "./node": "./src/node.ts" },
        }),
        "packages/config/src/index.ts":
          'import { readFile } from "node:fs/promises"\n\nexport const read = readFile\n',
        "packages/config/src/node.ts":
          'import { readdir } from "node:fs/promises"\n\nexport const list = readdir\n',
        "packages/czkawka/package.json": JSON.stringify({
          name: "@xiranite/czkawka-native",
          exports: { ".": "./src/index.ts" },
        }),
        "packages/czkawka/src/index.ts": 'import { stat } from "node:fs"\n\nexport const s = stat\n',
        // The substitute for `@xiranite/czkawka-native` reaching for a builtin on purpose: the walk has to
        // follow the service module, not skip the edge, or a leak in the replacement reads as migrated.
        "packages/quickjs-shims/src/config-service.ts":
          'import { hostCapabilities } from "@xiranite/host-capabilities"\n\nexport const cfg = hostCapabilities.service\n',
        "packages/quickjs-shims/src/czkawka-service.ts":
          'import { openSync } from "node:fs"\n\nexport const o = openSync\n',
        "packages/nodes/alpha/src/platform.ts":
          'import { hostCapabilities } from "@xiranite/host-capabilities"\nimport { list } from "@xiranite/config/node"\n\nexport const a = [hostCapabilities, list]\n',
        "packages/nodes/beta/src/platform.ts":
          'import { hostCapabilities } from "@xiranite/host-capabilities"\nimport { read } from "@xiranite/config"\n\nexport const b = [hostCapabilities, read]\n',
        "packages/nodes/gamma/src/platform.ts":
          'import { hostCapabilities } from "@xiranite/host-capabilities"\nimport { s } from "@xiranite/czkawka-native"\n\nexport const g = [hostCapabilities, s]\n',
      },
      [
        { id: "alpha", disposition: "retain-rewrite" },
        { id: "beta", disposition: "retain-rewrite" },
        { id: "gamma", disposition: "retain-rewrite" },
      ],
    )
    try {
      const byId = new Map((await auditPlatformFiles(f.root)).records.map((record) => [record.id, record]))
      expect(byId.get("alpha")?.hiddenMachine).toEqual([])
      // POSITIVE CONTROL both ways: an unserved specifier from the same package still charges the node, so
      // "alpha is empty" cannot come from the walk being blind.
      expect(byId.get("beta")?.hiddenMachine.map((edge) => `${edge.package}|${edge.specifier}`)).toEqual([
        "@xiranite/config|node:fs/promises",
      ])
      expect(byId.get("beta")?.hiddenMachine[0]?.via).toBe("packages/config/src/index.ts")
      // And the substitute is walked rather than skipped: a service module that imports a builtin comes back
      // onto the list under the specifier the node wrote.
      expect(byId.get("gamma")?.hiddenMachine.map((edge) => `${edge.package}|${edge.via}`)).toEqual([
        "@xiranite/czkawka-native|packages/quickjs-shims/src/czkawka-service.ts",
      ])
      expect(byId.get("gamma")?.hiddenMachine[0]?.specifier).toBe("node:fs")
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
    // The through-a-package ceiling has to bite on its own: a node that starts reaching a builtin through a
    // shared package changes neither direct column, so a gate without this row would call it progress.
    const hidden = { ...report, nodesWithHiddenMachine: 4, hiddenMachineEdges: 10 }
    expect(
      compareWithBaseline(hidden, { machineImports: 4, filesWithMachineImports: 2, hiddenFiles: 3, hiddenEdges: 9 }).length,
    ).toBe(2)
    expect(
      compareWithBaseline(
        { ...hidden, nodesWithHiddenMachine: 2, hiddenMachineEdges: 3 },
        { machineImports: 4, filesWithMachineImports: 2, hiddenFiles: 3, hiddenEdges: 9 },
      ),
    ).toEqual([])
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

  it("POSITIVE CONTROL: the per-package work list bites on a rise and on an unlisted package", () => {
    const shipped = JSON.parse(readFileSync(new URL("../docs/platform-capabilities-baseline.json", import.meta.url), "utf8")) as {
      hiddenByPackage: Record<string, number>
    }
    // These three numbers are the whole remaining scope of the migration: no node still asks a builtin of
    // itself, so a key the baseline does not carry is a new undeclared machine dependency rather than
    // progress, and a package reaching zero is what frees the builtin shim that package was the last to use.
    // `@xiranite/czkawka-native` left this list without any code moving: the realm graph never loads its JS
    // entry (`HOST_SERVED_PACKAGES` swaps in the service module), and the meter now follows that alias. Its
    // own alias row therefore stays — that one is what answers the node, not what the node leaks.
    expect(Object.keys(shipped.hiddenByPackage).sort()).toEqual([
      "@xiranite/config",
      "@xiranite/file-operations",
      "@xiranite/logging",
    ])
    const atCeiling = { ...emptyPathReport, hiddenByPackage: shipped.hiddenByPackage }
    expect(compareWithBaseline(atCeiling, shipped)).toEqual([])
    const grew = compareWithBaseline(
      { ...atCeiling, hiddenByPackage: { ...shipped.hiddenByPackage, "@xiranite/logging": 3 } },
      shipped,
    )
    expect(grew.length).toBe(1)
    expect(grew[0]).toContain("@xiranite/logging reaches 3 machine builtins")
    const fifth = compareWithBaseline(
      { ...atCeiling, hiddenByPackage: { ...shipped.hiddenByPackage, "@xiranite/whatever": 1 } },
      shipped,
    )
    expect(fifth.length).toBe(1)
    expect(fifth[0]).toContain("the baseline does not carry")
    // Emptying one package is the progress this ceiling wants (that builtin shim is then free to go), so it
    // must pass. Derived from the shipped map rather than written out, because this file must not hardcode
    // numbers that the migration is expected to move: an earlier version pinned `file-operations: 2` here and
    // went red the moment that package's edge was actually migrated.
    const { "@xiranite/logging": _loggingIsDone, ...smallerWorkList } = shipped.hiddenByPackage
    const onePackageDone = compareWithBaseline({ ...atCeiling, hiddenByPackage: smallerWorkList }, shipped)
    expect(onePackageDone).toEqual([])
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
