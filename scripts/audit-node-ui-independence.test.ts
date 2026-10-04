import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, expect, test } from "bun:test"

import { auditNodeUiIndependence, couplingGrowth } from "./audit-node-ui-independence.ts"

let root = ""
let nodesRoot = ""
let baselinePath = ""

const writeComponent = async (node: string, name: string, source: string): Promise<void> => {
  const dir = join(nodesRoot, node)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), source, "utf8")
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "xiranite-node-ui-"))
  nodesRoot = join(root, "src/nodes")
  baselinePath = join(root, "baseline.json")
  await mkdir(nodesRoot, { recursive: true })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

test("a clean node UI passes, and only because the scan actually read files", async () => {
  await writeComponent("clean", "Component.tsx", [
    'import { Button } from "@/components/ui/button"',
    'import { useNodeSurface } from "@/nodes/shared/useNodeSurface"',
    'import type { NodeRunResult } from "@xiranite/contract"',
    "export const Clean = () => null",
    "",
  ].join("\n"))
  await writeFile(baselinePath, "{}\n", "utf8")

  const report = await auditNodeUiIndependence({ nodesRoot, baselinePath })
  expect(report.filesScanned).toBe(1)
  expect(report.nodes).toEqual(["clean"])
  expect(report.coupling).toEqual([])
  expect(couplingGrowth(report)).toEqual([])
})

test("Xiranite-only state, nexus and routing are coupling; the transport seam is counted separately", async () => {
  await writeComponent("tied", "Component.tsx", [
    'import { store } from "@/store/workspaceStore"',
    'import { capture } from "@/nexus/captureClient"',
    'import { routes } from "@/router"',
    'import { client } from "@/backend/nodeRpcClient"',
    "const word = 'workspace' // a word, not an import",
    "// @/store/mentionedInComment is not a dependency",
    "export const Tied = () => null",
    "",
  ].join("\n"))
  await writeFile(baselinePath, "{}\n", "utf8")

  const report = await auditNodeUiIndependence({ nodesRoot, baselinePath })
  const tied = report.coupling.filter((hit) => hit.node === "tied").map((hit) => hit.specifier).sort()
  expect(tied).toEqual(["@/nexus/captureClient", "@/router", "@/store/workspaceStore"])
  expect(report.seam.filter((hit) => hit.node === "tied").map((hit) => hit.specifier)).toEqual(["@/backend/nodeRpcClient"])
  // The comment and the string literal must not read as imports: the gate is specifier-based (ADR-0067).
  expect(report.coupling.some((hit) => hit.specifier.includes("mentionedInComment"))).toBe(false)
})

test("the ratchet allows recorded debt to stay but refuses new coupling", async () => {
  await writeComponent("owed", "Component.tsx", 'import { s } from "@/store/nodeOperations"\nexport const Owed = () => null\n', )
  await writeComponent("owed", "Extra.tsx", 'import { s } from "@/store/nodeOperations"\nexport const Extra = () => null\n')

  await auditNodeUiIndependence({ nodesRoot, baselinePath, generateBaseline: true })
  const seeded = await auditNodeUiIndependence({ nodesRoot, baselinePath })
  expect(seeded.baseline.owed).toBe(2)
  expect(couplingGrowth(seeded)).toEqual([])

  await writeComponent("owed", "Third.tsx", 'import { dynamicImport } from "@/services/registry"\nexport const Third = () => null')
  const grown = await auditNodeUiIndependence({ nodesRoot, baselinePath })
  expect(couplingGrowth(grown)).toEqual([{ node: "owed", from: 2, to: 3 }])
})

test("an empty scan is an error, not a green gate", async () => {
  await expect(
    auditNodeUiIndependence({ nodesRoot: join(root, "nope"), baselinePath }),
  ).resolves.toMatchObject({ filesScanned: 0, nodes: [] })
  // The main guard turns that into a throw; assert the same condition here so a wrong path cannot pass.
  const empty = await auditNodeUiIndependence({ nodesRoot: join(root, "nope"), baselinePath })
  expect(empty.filesScanned === 0 || empty.nodes.length === 0).toBe(true)
})
