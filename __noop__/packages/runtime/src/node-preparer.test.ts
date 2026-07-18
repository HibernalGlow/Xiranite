import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { prepareNodePackage, workspaceBuildOrder } from "./node-preparer.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("builds only the selected node and its transitive workspace dependencies", async () => {
  const root = await fixtureWorkspace()
  expect(await workspaceBuildOrder("@xiranite/node-target", root)).toEqual([
    "@xiranite/shared",
    "@xiranite/contract",
    "@xiranite/cli-runtime",
    "@xiranite/node-target",
  ])
})

test("deduplicates concurrent preparation for the same node", async () => {
  const root = await fixtureWorkspace()
  const built: string[] = []
  const previous = process.env.XIRANITE_LAZY_NODE_BUILD
  process.env.XIRANITE_LAZY_NODE_BUILD = "1"
  try {
    await Promise.all([
      prepareNodePackage("@xiranite/node-target", { repoRoot: root, buildPackage: async (name) => { built.push(name) } }),
      prepareNodePackage("@xiranite/node-target", { repoRoot: root, buildPackage: async (name) => { built.push(name) } }),
    ])
  } finally {
    if (previous === undefined) delete process.env.XIRANITE_LAZY_NODE_BUILD
    else process.env.XIRANITE_LAZY_NODE_BUILD = previous
  }
  expect(built).toEqual(["@xiranite/shared", "@xiranite/contract", "@xiranite/cli-runtime", "@xiranite/node-target"])
})

test("prepares a cold node dist without touching unrelated nodes", async () => {
  const root = await fixtureWorkspace("@xiranite/node-cold")
  const built: string[] = []
  const previous = process.env.XIRANITE_LAZY_NODE_BUILD
  process.env.XIRANITE_LAZY_NODE_BUILD = "1"
  try {
    await prepareNodePackage("@xiranite/node-cold", {
      repoRoot: root,
      buildPackage: async (name) => {
        built.push(name)
        if (name === "@xiranite/node-cold") {
          const dist = join(root, "packages/nodes/target/dist")
          await mkdir(dist, { recursive: true })
          await writeFile(join(dist, ".ready"), "")
        }
      },
    })
  } finally {
    if (previous === undefined) delete process.env.XIRANITE_LAZY_NODE_BUILD
    else process.env.XIRANITE_LAZY_NODE_BUILD = previous
  }
  expect(built).toEqual(["@xiranite/shared", "@xiranite/contract", "@xiranite/cli-runtime", "@xiranite/node-cold"])
  expect(await Bun.file(join(root, "packages/nodes/target/dist/.ready")).exists()).toBe(true)
  expect(await Bun.file(join(root, "packages/nodes/unrelated/dist/.ready")).exists()).toBe(false)
})

async function fixtureWorkspace(targetName = "@xiranite/node-target"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-node-preparer-"))
  roots.push(root)
  await writePackage(root, "packages/shared", "@xiranite/shared")
  await writePackage(root, "packages/contract", "@xiranite/contract", { "@xiranite/shared": "workspace:*" })
  await writePackage(root, "packages/cli-runtime", "@xiranite/cli-runtime", { "@xiranite/contract": "workspace:*" })
  await writePackage(root, "packages/nodes/target", targetName, { "@xiranite/cli-runtime": "workspace:*" })
  await writePackage(root, "packages/nodes/unrelated", "@xiranite/node-unrelated", { "@xiranite/shared": "workspace:*" })
  return root
}

async function writePackage(root: string, relative: string, name: string, dependencies: Record<string, string> = {}): Promise<void> {
  const directory = join(root, relative)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, "package.json"), JSON.stringify({ name, dependencies }))
}
