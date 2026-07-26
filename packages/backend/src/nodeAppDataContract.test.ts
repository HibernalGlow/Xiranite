import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { startBackend } from "./index.js"
import { readNodeAppDataContract, recordNodeAppDataContract } from "./nodeAppDataContract.js"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })))
})

describe("node application data contract", () => {
  it("records versions monotonically through the shared atomic JSON protocol", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-contract-"))
    temporaryRoots.push(root)
    const marker = join(root, "data-contract.json")

    await expect(readNodeAppDataContract(marker)).resolves.toMatchObject({ schemaVersion: 1, version: 1 })
    await expect(recordNodeAppDataContract(2, marker)).resolves.toMatchObject({ version: 2 })
    await expect(recordNodeAppDataContract(1, marker)).resolves.toMatchObject({ version: 2 })
  })

  it("does not repair a malformed shared contract marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-node-app-contract-"))
    temporaryRoots.push(root)
    const marker = join(root, "data-contract.json")
    await writeFile(marker, "not-json", "utf8")

    await expect(recordNodeAppDataContract(2, marker)).rejects.toThrow("Unexpected token")
  })

  it("records the main desktop backend contract only when the host opts in", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-main-contract-"))
    temporaryRoots.push(root)
    const originalLocalAppData = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = root
    const logWriter = { append: async () => undefined, close: async () => undefined }
    try {
      const backend = await startBackend({
        token: "contract-test",
        configPath: join(root, "xiranite.config.toml"),
        dataDir: root,
        repository: createMemoryWorkspaceRepository(),
        dataContractVersion: 2,
        logWriter,
      })
      try {
        const marker = join(root, "Xiranite", "node-apps", "data-contract.json")
        await expect(readNodeAppDataContract(marker)).resolves.toMatchObject({ version: 2 })
        await expect(readFile(marker, "utf8")).resolves.toContain('"version": 2')
      } finally {
        await backend.close()
      }
    } finally {
      if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA
      else process.env.LOCALAPPDATA = originalLocalAppData
    }
  })
})
