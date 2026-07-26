import { describe, expect, it, vi } from "vitest"

import { FileOperationService } from "./FileOperationService.js"
import type {
  FileDeletionList,
  FileDeletionQuery,
  FileDeletionRecord,
  FileDeletionStore,
  FileMutationProvider,
  FileUndoJournalRecord,
  FileUndoJournalStore,
  FileUndoReceipt,
} from "./types.js"

describe("FileOperationService", () => {
  it("records the full path and ownership before sending a file to trash", async () => {
    const events: string[] = []
    const store = memoryStore(events)
    const provider: FileMutationProvider = {
      trashRestore: true,
      async execute(operation) {
        events.push(`execute:${"sourcePath" in operation ? operation.sourcePath : operation.kind}`)
        return receipt(operation)
      },
      async undo() {},
    }
    const service = serviceFor(provider, store)
    const sourcePath = absolute("books/demo.cbz")

    const result = await service.execute({ operations: [{ kind: "trash", sourcePath }] })

    expect(events[0]).toBe("create:pending")
    expect(events[1]).toBe(`execute:${sourcePath}`)
    expect(result).toMatchObject({ succeeded: 1, undoable: 1, deletionHistoryPersisted: true })
    expect(result.results[0]?.deletionId).toEqual(expect.any(String))
    expect((await store.listFileDeletions({})).items[0]).toMatchObject({
      nodeId: "neoview",
      componentId: "component-1",
      workspaceId: "workspace-1",
      sourcePath,
      deletionKind: "trash",
      state: "trashed",
      restoreAvailable: true,
      pathKind: "file",
      size: 7,
    })
  })

  it("fails closed without touching the filesystem when the deletion ledger cannot be written", async () => {
    const provider = { execute: vi.fn(async () => undefined) }
    const store = memoryStore()
    store.createFileDeletionRecords = vi.fn(async () => { throw new Error("database unavailable") })
    const service = serviceFor(provider, store)

    await expect(service.execute({ operations: [{ kind: "delete", sourcePath: absolute("blocked.txt") }] }))
      .rejects.toThrow("database unavailable")
    expect(provider.execute).not.toHaveBeenCalled()
  })

  it("records failed permanent deletions without making them restorable", async () => {
    const store = memoryStore()
    const provider: FileMutationProvider = {
      async execute() { throw Object.assign(new Error("access denied"), { code: "EACCES" }) },
    }
    const result = await serviceFor(provider, store).execute({
      operations: [{ kind: "delete", sourcePath: absolute("protected.txt") }],
    })

    expect(result).toMatchObject({ succeeded: 0, failed: 1, deletionHistoryPersisted: true })
    expect((await store.listFileDeletions({})).items[0]).toMatchObject({
      state: "delete-failed",
      restoreAvailable: false,
      lastError: "access denied",
    })
  })

  it("restores a selected deletion and removes it from the persisted undo transaction", async () => {
    const store = memoryStore()
    const journal = memoryJournal()
    const undo = vi.fn(async () => undefined)
    const provider: FileMutationProvider = {
      trashRestore: true,
      async execute(operation) { return receipt(operation) },
      undo,
    }
    const service = serviceFor(provider, store, journal)
    const executed = await service.execute({ operations: [{ kind: "trash", sourcePath: absolute("restore.cbz") }] })
    const deletionId = executed.results[0]!.deletionId!

    const restored = await service.restoreDeletion(deletionId)

    expect(undo).toHaveBeenCalledOnce()
    expect(restored).toMatchObject({ historyPersisted: true, record: { id: deletionId, state: "restored", restoreAvailable: false } })
    expect(service.undoState()).toMatchObject({ available: false, count: 0 })
    expect(journal.records).toHaveLength(0)
  })

  it("keeps a failed restore available for retry and records its error", async () => {
    const store = memoryStore()
    const provider: FileMutationProvider = {
      trashRestore: true,
      async execute(operation) { return receipt(operation) },
      async undo() { throw Object.assign(new Error("replacement exists"), { code: "ESTALE" }) },
    }
    const service = serviceFor(provider, store)
    const executed = await service.execute({ operations: [{ kind: "trash", sourcePath: absolute("stale.cbz") }] })
    const deletionId = executed.results[0]!.deletionId!

    await expect(service.restoreDeletion(deletionId)).rejects.toMatchObject({ code: "ESTALE", historyPersisted: true })
    expect(await store.getFileDeletion(deletionId)).toMatchObject({
      state: "restore-failed",
      restoreAvailable: true,
      lastError: "replacement exists",
    })
  })

  it("filters and exports deletion history through the shared store", async () => {
    const store = memoryStore()
    const provider: FileMutationProvider = { async execute() {} }
    const service = serviceFor(provider, store)
    await service.execute({ operations: [{ kind: "delete", sourcePath: absolute("gone.txt") }] })

    const listed = await service.listDeletions({ nodeId: "neoview", state: "permanent" })
    const exported = await service.exportDeletions("jsonl", { nodeId: "neoview" })

    expect(listed.items).toHaveLength(1)
    expect(exported).toMatchObject({ format: "jsonl", extension: "jsonl", recordCount: 1 })
    expect(JSON.parse(exported.content.trim())).toMatchObject({ nodeId: "neoview", sourcePath: absolute("gone.txt") })
  })

  it("rejects unsafe input before creating deletion records", async () => {
    const store = memoryStore()
    const provider = { execute: vi.fn(async () => undefined) }
    const service = serviceFor(provider, store)

    await expect(service.execute({ operations: [{ kind: "trash", sourcePath: "relative.txt" }] })).rejects.toThrow("absolute path")
    expect(provider.execute).not.toHaveBeenCalled()
    expect((await store.listFileDeletions({})).items).toEqual([])
  })
})

function serviceFor(
  provider: FileMutationProvider,
  deletions: FileDeletionStore,
  journal?: FileUndoJournalStore,
): FileOperationService {
  let sequence = 0
  return new FileOperationService(provider, {
    nodeId: "neoview",
    componentId: "component-1",
    workspaceId: "workspace-1",
  }, {
    deletions,
    journal,
    now: () => 1_700_000_000_000 + sequence,
    id: () => `id-${++sequence}`,
  })
}

function receipt(original: FileUndoReceipt["original"]): FileUndoReceipt | undefined {
  if (original.kind !== "trash") return undefined
  return {
    original,
    inverse: original,
    guard: {
      path: original.sourcePath,
      kind: "file",
      size: 7,
      mtimeMs: 1,
      ctimeMs: 2,
      device: 3,
      inode: 4,
    },
    providerData: {
      kind: "trash-rs",
      item: { id: "$R-test", name: "demo.cbz", originalParent: absolute("books"), timeDeleted: 123 },
    },
  }
}

function memoryStore(events: string[] = []): FileDeletionStore {
  let records: FileDeletionRecord[] = []
  return {
    async createFileDeletionRecords(input) {
      events.push(`create:${input[0]?.state}`)
      records.push(...structuredClone(input))
    },
    async getFileDeletion(id) {
      const record = records.find((item) => item.id === id)
      return record ? structuredClone(record) : undefined
    },
    async listFileDeletions(query: FileDeletionQuery): Promise<FileDeletionList> {
      let filtered = records.filter((record) => matches(record, query))
      filtered = filtered.sort((left, right) => right.deletedAt - left.deletedAt || right.id.localeCompare(left.id))
      const start = query.cursor ? Math.max(0, filtered.findIndex((record) => record.id === query.cursor) + 1) : 0
      const limit = query.limit ?? 50
      const items = filtered.slice(start, start + limit)
      return {
        items: structuredClone(items),
        nextCursor: start + limit < filtered.length ? items.at(-1)?.id ?? null : null,
      }
    },
    async updateFileDeletion(record) {
      const index = records.findIndex((item) => item.id === record.id)
      if (index < 0) throw new Error(`missing deletion: ${record.id}`)
      records[index] = structuredClone(record)
      return structuredClone(record)
    },
  }
}

function matches(record: FileDeletionRecord, query: FileDeletionQuery): boolean {
  return (!query.nodeId || record.nodeId === query.nodeId)
    && (!query.componentId || record.componentId === query.componentId)
    && (!query.workspaceId || record.workspaceId === query.workspaceId)
    && (!query.state || record.state === query.state)
    && (!query.deletionKind || record.deletionKind === query.deletionKind)
    && (query.from === undefined || record.deletedAt >= query.from)
    && (query.to === undefined || record.deletedAt <= query.to)
}

function memoryJournal(): FileUndoJournalStore & { records: FileUndoJournalRecord[] } {
  const journal = {
    records: [] as FileUndoJournalRecord[],
    async loadFileUndoTransactions() { return structuredClone(journal.records) },
    async saveFileUndoTransaction(record: FileUndoJournalRecord) {
      journal.records = [...journal.records.filter((item) => item.id !== record.id), structuredClone(record)]
    },
    async removeFileUndoTransaction(id: string) {
      const before = journal.records.length
      journal.records = journal.records.filter((item) => item.id !== id)
      return before !== journal.records.length
    },
  }
  return journal
}

function absolute(path: string): string {
  return process.platform === "win32" ? `C:\\xiranite-test\\${path.replaceAll("/", "\\")}` : `/xiranite-test/${path}`
}
