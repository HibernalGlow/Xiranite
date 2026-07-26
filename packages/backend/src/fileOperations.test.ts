import { access, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { FileDeletionRecord } from "@xiranite/file-operations"
import { createMemoryFileDeletionRepository } from "@xiranite/repository"
import { describe, expect, it, vi } from "vitest"

import { startIsolatedTestBackend } from "../../../scripts/test-backend.js"
import { BackendFileOperationManager, LazyScopedFileOperations } from "./fileOperations.js"

describe("backend file operation API", () => {
  it("restores through the scope stored on the deletion record", async () => {
    const repository = createMemoryFileDeletionRepository()
    const record: FileDeletionRecord = {
      id: "scoped-restore",
      nodeId: "czkawka",
      componentId: "component-cz",
      workspaceId: "workspace-cz",
      sourcePath: "D:\\archive\\scoped-restore.cbz",
      deletionKind: "trash",
      deletedAt: 1_700_000_000_000,
      state: "trashed",
      restoreAvailable: true,
    }
    await repository.createFileDeletionRecords([record])
    const manager = new BackendFileOperationManager(repository)
    const scopedService = new LazyScopedFileOperations(repository, {
      nodeId: "czkawka",
      componentId: "component-cz",
      workspaceId: "workspace-cz",
    })
    const restored = { record: { ...record, state: "restored" as const, restoreAvailable: false }, historyPersisted: true }
    const restoreDeletion = vi.spyOn(scopedService, "restoreDeletion").mockResolvedValue(restored)
    const scoped = vi.spyOn(manager, "scoped").mockReturnValue(scopedService)

    await expect(manager.restore(record.id)).resolves.toEqual(restored)

    expect(scoped).toHaveBeenCalledWith({
      nodeId: "czkawka",
      componentId: "component-cz",
      workspaceId: "workspace-cz",
    })
    expect(restoreDeletion).toHaveBeenCalledWith(record.id, undefined)
  })

  it.runIf(process.platform === "win32")("persists, exports and restores a CZ trash-rs deletion by id", async () => {
    const logWriter = { append: vi.fn(async () => undefined), close: vi.fn(async () => undefined) }
    const isolated = await startIsolatedTestBackend({ token: "trash-test", logWriter })
    const { backend, dataDir } = isolated
    const sourcePath = join(dataDir, "CZ deletion, readable.txt")
    await writeFile(sourcePath, "restore me", "utf8")
    let deletionId: string | undefined
    try {
      const invalidLimit = await fetch(`${backend.url}/file-deletions?limit=0&token=${backend.token}`)
      expect(invalidLimit.status).toBe(400)

      const deleted = await fetch(`${backend.url}/file-operations?token=${backend.token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: { nodeId: "czkawka", componentId: "component-cz", workspaceId: "workspace-cz" },
          operations: [{ kind: "trash", sourcePath }],
        }),
      })
      const deletedText = await deleted.text()
      expect(deleted.status, deletedText).toBe(200)
      const deletion = JSON.parse(deletedText) as { results: Array<{ deletionId?: string; status: string }> }
      deletionId = deletion.results[0]?.deletionId
      expect(deletion.results[0]).toMatchObject({ status: "succeeded", deletionId: expect.any(String) })
      await expect(access(sourcePath)).rejects.toMatchObject({ code: "ENOENT" })

      const listed = await fetch(`${backend.url}/file-deletions?nodeId=czkawka&restoreAvailable=true&token=${backend.token}`)
      expect(await listed.json()).toMatchObject({
        items: [{
          id: deletionId,
          nodeId: "czkawka",
          componentId: "component-cz",
          workspaceId: "workspace-cz",
          sourcePath,
          state: "trashed",
          restoreAvailable: true,
          receipt: { providerData: { kind: "trash-rs", item: { id: expect.any(String) } } },
        }],
      })

      const exported = await fetch(`${backend.url}/file-deletions/export?format=markdown&nodeId=czkawka&token=${backend.token}`)
      expect(exported.status).toBe(200)
      expect(exported.headers.get("content-disposition")).toContain(".md")
      expect(await exported.text()).toContain(sourcePath)

      const restored = await fetch(`${backend.url}/file-deletions/${encodeURIComponent(deletionId!)}/restore?token=${backend.token}`, { method: "POST" })
      const restoredText = await restored.text()
      expect(restored.status, restoredText).toBe(200)
      expect(JSON.parse(restoredText)).toMatchObject({ record: { id: deletionId, state: "restored", restoreAvailable: false }, historyPersisted: true })
      expect(await readFile(sourcePath, "utf8")).toBe("restore me")

      const persisted = await fetch(`${backend.url}/file-deletions?state=restored&token=${backend.token}`)
      expect(await persisted.json()).toMatchObject({ items: [{ id: deletionId, sourcePath, state: "restored" }] })
    } finally {
      if (deletionId && await access(sourcePath).then(() => false, () => true)) {
        await fetch(`${backend.url}/file-deletions/${encodeURIComponent(deletionId)}/restore?token=${backend.token}`, { method: "POST" }).catch(() => undefined)
      }
      await isolated.close()
    }
  }, 15_000)
})
