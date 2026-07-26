import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { startBackend } from "./index.js"

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await removeWithWindowsRetry(root)
})

describe("backend file operation API", () => {
  it.runIf(process.platform === "win32")("persists, exports and restores a CZ trash-rs deletion by id", async () => {
    const root = await temporaryRoot()
    const dataDir = join(root, "data")
    const sourcePath = join(root, "CZ deletion, readable.txt")
    await writeFile(sourcePath, "restore me", "utf8")
    const logWriter = { append: vi.fn(async () => undefined), close: vi.fn(async () => undefined) }
    let backend = await startBackend({ token: "trash-test", dataDir, logWriter })
    let deletionId: string | undefined
    try {
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
      expect(backend.fileOperations.scoped({ nodeId: "czkawka", componentId: "component-cz", workspaceId: "workspace-cz" }).undoState())
        .toMatchObject({ available: true, count: 1 })

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
      expect(backend.fileOperations.scoped({ nodeId: "czkawka", componentId: "component-cz", workspaceId: "workspace-cz" }).undoState())
        .toMatchObject({ available: false, count: 0 })

      await backend.close()
      backend = await startBackend({ token: "trash-test", dataDir, logWriter })
      const persisted = await fetch(`${backend.url}/file-deletions?state=restored&token=${backend.token}`)
      expect(await persisted.json()).toMatchObject({ items: [{ id: deletionId, sourcePath, state: "restored" }] })
    } finally {
      if (deletionId && await access(sourcePath).then(() => false, () => true)) {
        await backend.fileOperations.restore(deletionId).catch(() => undefined)
      }
      await backend.close()
    }
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-backend-file-operation-"))
  roots.push(root)
  return root
}

async function removeWithWindowsRetry(path: string): Promise<void> {
  if (typeof Bun !== "undefined") Bun.gc(true)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error
      if (attempt === 99) return
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    }
  }
}
