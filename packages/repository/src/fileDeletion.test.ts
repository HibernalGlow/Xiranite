import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createClient, type Client } from "@libsql/client"
import type { FileDeletionRecord, FileUndoJournalRecord } from "@xiranite/file-operations"
import { describe, expect, it } from "vitest"

import { createLibsqlFileDeletionRepository, type LibsqlFileDeletionRepository } from "./fileDeletion.js"

const RUN_ROOT = join(process.cwd(), "artifacts", "test-runs", "repository-file-deletions")

describe("createLibsqlFileDeletionRepository", () => {
  it("persists, filters and paginates complete deletion records", async () => {
    await withRepository(async (repository) => {
      await repository.createFileDeletionRecords([
        deletion({ id: "a", nodeId: "neoview", deletedAt: 100 }),
        deletion({ id: "b", nodeId: "czkawka", deletedAt: 300, state: "permanent", deletionKind: "delete", restoreAvailable: false, receipt: undefined }),
        deletion({ id: "c", nodeId: "neoview", deletedAt: 200 }),
      ])

      const first = await repository.listFileDeletions({ limit: 2 })
      expect(first.items.map((item) => item.id)).toEqual(["b", "c"])
      expect(first.nextCursor).toBe("c")
      await expect(repository.listFileDeletions({ limit: 2, cursor: first.nextCursor! }))
        .resolves.toMatchObject({ items: [{ id: "a" }], nextCursor: null })
      await expect(repository.listFileDeletions({ nodeId: "neoview" }))
        .resolves.toMatchObject({ items: [{ id: "c" }, { id: "a" }] })
      await expect(repository.listFileDeletions({ state: "permanent", from: 250, to: 350 }))
        .resolves.toMatchObject({ items: [{ id: "b" }] })
      await expect(repository.getFileDeletion("c")).resolves.toMatchObject({
        id: "c",
        sourcePath: "D:\\Books\\c.cbz",
        receipt: { providerData: { kind: "trash-rs", item: { id: "$R-c" } } },
      })
    })
  })

  it("updates restore state and persists bounded undo transactions", async () => {
    await withRepository(async (repository) => {
      const record = deletion({ id: "restore" })
      await repository.createFileDeletionRecords([record])
      await expect(repository.updateFileDeletion({ ...record, state: "restored", restoreAvailable: false, restoredAt: 400 }))
        .resolves.toMatchObject({ state: "restored", restoredAt: 400 })

      await repository.saveFileUndoTransaction(transaction("one", 100), 1)
      await repository.saveFileUndoTransaction(transaction("two", 200), 1)
      await expect(repository.loadFileUndoTransactions(10)).resolves.toMatchObject([{ id: "two" }])
      await expect(repository.removeFileUndoTransaction("two")).resolves.toBe(true)
      await expect(repository.removeFileUndoTransaction("missing")).resolves.toBe(false)
    })
  })

  it("isolates persisted undo transactions by node and workspace scope", async () => {
    await withRepository(async (repository) => {
      const neoScope = { nodeId: "neoview", componentId: "reader", workspaceId: "library" }
      const czScope = { nodeId: "czkawka", componentId: "duplicates", workspaceId: "maintenance" }
      await repository.saveFileUndoTransaction(transaction("neo-old", 100), 1, neoScope)
      await repository.saveFileUndoTransaction(transaction("cz", 200), 1, czScope)
      await repository.saveFileUndoTransaction(transaction("neo-new", 300), 1, neoScope)

      await expect(repository.loadFileUndoTransactions(10, neoScope)).resolves.toMatchObject([{ id: "neo-new" }])
      await expect(repository.loadFileUndoTransactions(10, czScope)).resolves.toMatchObject([{ id: "cz" }])
    })
  })

  it("adds scope columns to an existing unscoped undo table", async () => {
    await withRepository(async (repository) => {
      const scope = { nodeId: "neoview", componentId: "reader", workspaceId: "library" }
      await repository.saveFileUndoTransaction(transaction("migrated", 100), 10, scope)
      await expect(repository.loadFileUndoTransactions(10, scope)).resolves.toMatchObject([{ id: "migrated" }])
    }, async (client) => {
      await client.execute(`CREATE TABLE file_undo_transactions (
        id TEXT PRIMARY KEY NOT NULL,
        created_at INTEGER NOT NULL,
        entries TEXT NOT NULL
      )`)
    })
  })

  it("rejects corrupt persisted receipts before they can reach native restore", async () => {
    await withRepository(async (repository) => {
      const record = deletion({ id: "corrupt" })
      await repository.createFileDeletionRecords([record])
      await repository.client.execute({
        sql: "UPDATE file_deletions SET receipt = ? WHERE id = ?",
        args: [JSON.stringify({ providerData: { kind: "unknown" } }), record.id],
      })

      await expect(repository.getFileDeletion(record.id)).rejects.toThrow()
    })
  })
})

async function withRepository(
  run: (repository: LibsqlFileDeletionRepository) => Promise<void>,
  prepare?: (client: Client) => Promise<void>,
): Promise<void> {
  await mkdir(RUN_ROOT, { recursive: true })
  const dir = await mkdtemp(join(RUN_ROOT, "xiranite-file-deletion-"))
  const url = pathToFileURL(join(dir, "xiranite.db")).href
  if (prepare) {
    const client = createClient({ url })
    try {
      await prepare(client)
    } finally {
      client.close()
    }
  }
  const repository = await createLibsqlFileDeletionRepository({ url })
  try {
    await run(repository)
  } finally {
    repository.client.close()
    await removeWithWindowsRetry(dir)
  }
}

function deletion(overrides: Partial<FileDeletionRecord> = {}): FileDeletionRecord {
  const id = overrides.id ?? "delete-1"
  const sourcePath = overrides.sourcePath ?? `D:\\Books\\${id}.cbz`
  return {
    id,
    transactionId: overrides.transactionId,
    transactionIndex: overrides.transactionIndex,
    nodeId: overrides.nodeId ?? "neoview",
    componentId: overrides.componentId ?? "component-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    sourcePath,
    deletionKind: overrides.deletionKind ?? "trash",
    pathKind: overrides.pathKind ?? "file",
    size: overrides.size ?? 42,
    deletedAt: overrides.deletedAt ?? 100,
    state: overrides.state ?? "trashed",
    restoreAvailable: overrides.restoreAvailable ?? true,
    receipt: "receipt" in overrides ? overrides.receipt : {
      original: { kind: "trash", sourcePath },
      inverse: { kind: "trash", sourcePath },
      guard: { path: sourcePath, kind: "file", size: 42, mtimeMs: 1, ctimeMs: 2, device: 3, inode: 4 },
      providerData: {
        kind: "trash-rs",
        item: { id: `$R-${id}`, name: `${id}.cbz`, originalParent: "D:\\Books", timeDeleted: 123 },
      },
    },
    restoredAt: overrides.restoredAt,
    lastRestoreAttemptAt: overrides.lastRestoreAttemptAt,
    lastError: overrides.lastError,
  }
}

function transaction(id: string, createdAt: number): FileUndoJournalRecord {
  return {
    id,
    createdAt,
    entries: [{ index: 0, deletionId: "delete-1", receipt: deletion().receipt! }],
  }
}

async function removeWithWindowsRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EBUSY" && attempt === 9) return
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
    }
  }
}
