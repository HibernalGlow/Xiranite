/**
 * Falsification tests for `scripts/lib/node-flavor-frontend.ts` — the frontend half of a route A flavour.
 *
 * The property that decides whether a flavour is real is not "the generator accepts a filter" but "the
 * webview table the bundle is built from lists exactly the requested nodes, and the checked-in artifacts
 * come back byte-identical afterwards". Both directions are asserted here: a restore that silently no-ops
 * and a reader that matches nothing both look green under a one-sided check.
 *
 * Run with: bunx vitest run --config vitest.scripts.config.ts scripts/node-flavor-frontend.test.ts
 */
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  FRONTEND_GENERATED_ARTIFACTS,
  digestOf,
  flavorOutDir,
  frontendNodeIds,
  frontendSubsetEnv,
  frontendSubsetMismatch,
  readWebviewTable,
  regenerateFrontendTables,
  restoreFrontendArtifacts,
  snapshotFrontendArtifacts,
} from "./lib/node-flavor-frontend.ts"

const repoRoot = resolve(import.meta.dirname, "..")
/** A node that exists as a package but is not the largest one, so a subset table is visibly different. */
const probeNode = "sleept"

async function digestOfArtifact(relative: string): Promise<string> {
  return createHash("sha256").update(await readFile(join(repoRoot, relative))).digest("hex")
}

describe("the webview table reader", () => {
  it("counts the node loaders the full checked-in table really has", () => {
    const ids = frontendNodeIds(readWebviewTable(repoRoot))
    // Independent of the reader: count the same literal the generator emits, straight from the file text.
    const rawOccurrences = (readWebviewTable(repoRoot).match(/=> import\("@\/nodes\//g) ?? []).length
    expect(ids.length).toBe(rawOccurrences)
    expect(ids.length).toBeGreaterThan(10)
    expect(ids).toContain(probeNode)
  })

  it("returns nothing for a table with no loaders, so an empty subset cannot read as a full one", () => {
    expect(frontendNodeIds("export const PACKAGE_MODULES = [] satisfies NodeDef[]\n")).toEqual([])
    expect(frontendNodeIds("")).toEqual([])
  })

  it("reads a two-node fixture, proving the pattern is not matching the live file only", () => {
    const fixture = `export const packageModuleLoaders = {
  sleept: () => import("@/nodes/sleept/entry") as Promise<{ default: AppNodeEntry }>,
  logx: () => import("@/nodes/logx/entry") as Promise<{ default: AppNodeEntry }>,
} satisfies Record<string, unknown>\n`
    expect(frontendNodeIds(fixture)).toEqual(["sleept", "logx"])
  })
})

describe("the subset comparison", () => {
  it("accepts an exact match and rejects either direction of drift", () => {
    expect(frontendSubsetMismatch(["sleept"], ["sleept"])).toBeNull()
    expect(frontendSubsetMismatch(["sleept", "logx"], ["sleept"])?.present).toEqual(["sleept"])
    const extra = frontendSubsetMismatch(["sleept"], ["sleept", "logx"])
    expect(extra?.expected).toEqual(["sleept"])
    expect(extra?.present).toEqual(["logx", "sleept"])
  })

  it("states the env the generator is documented to read", () => {
    expect(frontendSubsetEnv(["sleept", "logx"])).toEqual({ XIRANITE_BUILD_ONLY_NODES: "sleept,logx" })
    // The pair matters: a filtered table without a redirected bundle would overwrite the shared dist/.
    expect(frontendSubsetEnv(["sleept"], "dist-flavors/sleept")).toEqual({
      XIRANITE_BUILD_ONLY_NODES: "sleept",
      XIRANITE_BUILD_OUT_DIR: "dist-flavors/sleept",
    })
    expect(flavorOutDir(["logx", "sleept", "sleept"])).toBe("dist-flavors/logx+sleept")
  })
})

describe("digests distinguish bytes", () => {
  it("flips on a single character", () => {
    expect(digestOf("registration table")).not.toBe(digestOf("registration table "))
  })
})

describe("a subset build gives every checked-in artifact back", () => {
  it("shrinks the webview table to the requested node, then restores all four byte-for-byte", async () => {
    // A copy this test owns, independent of the function under test. Proven necessary, not defensive
    // theatre: the falsification run for this file disabled `restoreFrontendArtifacts`' write, and three of
    // the four artifacts stayed in the subset state on disk afterwards. A test whose only undo path is the
    // mechanism it is trying to break cannot leave the tree clean when that mechanism is the broken part.
    const originals = new Map<string, Buffer>()
    for (const relative of FRONTEND_GENERATED_ARTIFACTS) {
      originals.set(relative, await readFile(join(repoRoot, relative)))
    }
    const before = await snapshotFrontendArtifacts(repoRoot)
    expect(before.map((entry) => entry.path).sort()).toEqual([...FRONTEND_GENERATED_ARTIFACTS].sort())
    const beforeByPath = new Map(before.map((entry) => [entry.path, entry.digest]))
    try {
      const table = regenerateFrontendTables(repoRoot, [probeNode])
      const ids = frontendNodeIds(table)
      expect(frontendSubsetMismatch([probeNode], ids)).toBeNull()

      // Positive control for the write itself: if the generator had not really rewritten anything, the
      // restore assertion below would pass without ever having proven it can dirty the tree.
      const dirty = await Promise.all(
        FRONTEND_GENERATED_ARTIFACTS.map(async (relative) => (await digestOfArtifact(relative)) !== beforeByPath.get(relative)),
      )
      expect(dirty.filter(Boolean).length).toBeGreaterThan(0)
    } finally {
      const mismatches = await restoreFrontendArtifacts(repoRoot, before)
      expect(mismatches).toEqual([])
      for (const [relative, bytes] of originals) {
        if ((await digestOfArtifact(relative)) !== digestOf(bytes)) await writeFile(join(repoRoot, relative), bytes)
      }
    }
    // And once more from outside the guard, so a restore that lied cannot hide.
    for (const relative of FRONTEND_GENERATED_ARTIFACTS) {
      expect(await digestOfArtifact(relative), relative).toBe(beforeByPath.get(relative))
    }
  }, 120_000)

  it("reports a mismatch rather than staying silent when an artifact cannot be restored", async () => {
    const snapshots = await snapshotFrontendArtifacts(repoRoot)
    const tampered = snapshots.map((entry) =>
      entry.path === FRONTEND_GENERATED_ARTIFACTS[0] ? { ...entry, digest: "0".repeat(64) } : entry,
    )
    const mismatches = await restoreFrontendArtifacts(repoRoot, tampered)
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]?.path).toBe(FRONTEND_GENERATED_ARTIFACTS[0])
    expect(mismatches[0]?.expected).toBe("000000000000")
    // The file on disk is still the original: only the recorded expectation was wrong.
    expect(await digestOfArtifact(FRONTEND_GENERATED_ARTIFACTS[0])).toBe(snapshots[0]?.digest)
  })
})
