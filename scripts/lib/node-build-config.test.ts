import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { getDisabledNodeIds } from "./node-build-config.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("node build config", () => {
  test("loads and normalizes disabled node IDs", async () => {
    const root = await createRoot('[nodes]\ndisabled = [" lata ", "scoolp", "lata"]\n')

    await expect(getDisabledNodeIds({ cwd: root, env: {} })).resolves.toEqual(["lata", "scoolp"])
  })

  test("allows explicit builds to include disabled nodes", async () => {
    const root = await createRoot('[nodes]\ndisabled = ["lata"]\n')

    await expect(getDisabledNodeIds({
      cwd: root,
      env: { XIRANITE_INCLUDE_DISABLED_NODES: "1" },
    })).resolves.toEqual([])
  })

  test("returns an empty list when a staged workspace has no build config", async () => {
    const root = await createRoot()

    await expect(getDisabledNodeIds({ cwd: root, env: {} })).resolves.toEqual([])
  })

  test("rejects malformed disabled node lists", async () => {
    const root = await createRoot('[nodes]\ndisabled = "lata"\n')

    await expect(getDisabledNodeIds({ cwd: root, env: {} }))
      .rejects.toThrow("nodes.disabled must be an array of non-empty node IDs")
  })
})

async function createRoot(content?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-node-build-config-"))
  roots.push(root)
  if (content !== undefined) await writeFile(join(root, "xiranite.build.toml"), content, "utf8")
  return root
}
