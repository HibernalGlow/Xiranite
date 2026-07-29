import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createLibsqlNodeRunHistoryRepository } from "@xiranite/repository/libsql"
import { describe, expect, test } from "vitest"

import { createBackendOperationalPersistence } from "./backendPersistence.js"

describe("backend operational persistence", () => {
  test("reopens run history and file undo journals from the shared database", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "xiranite-operational-persistence-"))
    let first: Awaited<ReturnType<typeof createBackendOperationalPersistence>> | undefined
    let second: Awaited<ReturnType<typeof createBackendOperationalPersistence>> | undefined
    try {
      first = await createBackendOperationalPersistence({ dataDir })
      expect(first.persistent).toBe(true)
      await first.historyRepository!.createRuntimeHistory({
        id: "direct-host-history",
        kind: "node",
        operation: "node.run",
        status: "success",
        message: "Completed in a node application host.",
        nodeId: "neoview",
        startedAt: 100,
        finishedAt: 120,
        durationMs: 20,
      })
      await first.fileDeletionRepository.saveFileUndoTransaction({
        id: "direct-host-undo",
        createdAt: 120,
        entries: [],
      }, 20, { nodeId: "neoview" })
      const firstClient = (first.historyRepository as { client: { closed: boolean } }).client
      first.close()
      expect(firstClient.closed).toBe(true)
      first = undefined

      second = await createBackendOperationalPersistence({ dataDir })
      await expect(second.historyRepository!.listRuntimeHistory({ nodeId: "neoview" })).resolves.toMatchObject({
        items: [{ id: "direct-host-history", operation: "node.run", status: "success" }],
      })
      await expect(second.fileDeletionRepository.loadFileUndoTransactions(20, { nodeId: "neoview" })).resolves.toEqual([{
        id: "direct-host-undo",
        createdAt: 120,
        entries: [],
      }])
      const secondClient = (second.historyRepository as { client: { closed: boolean } }).client
      second.close()
      expect(secondClient.closed).toBe(true)
      second = undefined
    } finally {
      first?.close()
      second?.close()
      await removeWithWindowsRetry(dataDir)
    }
  })

  test("keeps an injected history repository separate from the default operational database", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-operational-persistence-injected-"))
    const dataDir = join(root, "data")
    const injectedHistory = await createLibsqlNodeRunHistoryRepository({
      url: pathToFileURL(join(root, "external-history.db")).href,
    })
    let first: Awaited<ReturnType<typeof createBackendOperationalPersistence>> | undefined
    let second: Awaited<ReturnType<typeof createBackendOperationalPersistence>> | undefined
    try {
      first = await createBackendOperationalPersistence({ dataDir, historyRepository: injectedHistory })
      expect((first.fileDeletionRepository as { client?: unknown }).client).not.toBe(injectedHistory.client)
      await first.fileDeletionRepository.createFileDeletionRecords([{
        id: "default-database-delete",
        nodeId: "neoview",
        sourcePath: "D:\\books\\default-database-delete.cbz",
        deletionKind: "delete",
        deletedAt: 120,
        state: "permanent",
        restoreAvailable: false,
      }])
      first.close()
      first = undefined

      second = await createBackendOperationalPersistence({ dataDir })
      await expect(second.fileDeletionRepository.getFileDeletion("default-database-delete")).resolves.toMatchObject({
        sourcePath: "D:\\books\\default-database-delete.cbz",
        state: "permanent",
      })
    } finally {
      first?.close()
      second?.close()
      injectedHistory.client.close()
      await removeWithWindowsRetry(root)
    }
  })
})

async function removeWithWindowsRetry(targetPath: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EBUSY" && attempt === 39) return
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    }
  }
}
