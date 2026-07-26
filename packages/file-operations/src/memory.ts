import type {
  FileDeletionList,
  FileDeletionQuery,
  FileDeletionRecord,
  FileDeletionStore,
  FileOperationScope,
  FileUndoJournalRecord,
  FileUndoJournalStore,
} from "./types.js"

export interface MemoryFileOperationStore extends FileDeletionStore, FileUndoJournalStore {}

interface ScopedUndoTransaction {
  record: FileUndoJournalRecord
  scope?: FileOperationScope
}

export function createMemoryFileOperationStore(options: {
  deletions?: readonly FileDeletionRecord[]
  undoTransactions?: readonly FileUndoJournalRecord[]
} = {}): MemoryFileOperationStore {
  let deletions: FileDeletionRecord[] = structuredClone([...(options.deletions ?? [])])
  let undoTransactions: ScopedUndoTransaction[] = structuredClone(
    [...(options.undoTransactions ?? [])].map((record) => ({ record })),
  )
  return {
    async createFileDeletionRecords(records) {
      const ids = new Set(deletions.map((item) => item.id))
      for (const record of records) {
        if (ids.has(record.id)) throw new Error(`File deletion already exists: ${record.id}`)
        ids.add(record.id)
      }
      deletions.push(...structuredClone(records))
    },
    async getFileDeletion(id) {
      const record = deletions.find((item) => item.id === id)
      return record ? structuredClone(record) : undefined
    },
    async listFileDeletions(query: FileDeletionQuery): Promise<FileDeletionList> {
      let filtered = deletions.filter((record) => matches(record, query))
      filtered = filtered.sort((left, right) => right.deletedAt - left.deletedAt || right.id.localeCompare(left.id))
      const cursorIndex = query.cursor ? filtered.findIndex((record) => record.id === query.cursor) : -1
      const start = cursorIndex >= 0 ? cursorIndex + 1 : 0
      const limit = boundedLimit(query.limit, 1_000)
      const items = filtered.slice(start, start + limit)
      return {
        items: structuredClone(items),
        nextCursor: start + limit < filtered.length ? items.at(-1)?.id ?? null : null,
      }
    },
    async listFileDeletionNodes() {
      return [...new Set(deletions.map((record) => record.nodeId))].sort()
    },
    async updateFileDeletion(record) {
      const index = deletions.findIndex((item) => item.id === record.id)
      if (index < 0) throw new Error(`File deletion not found: ${record.id}`)
      deletions[index] = structuredClone(record)
      return structuredClone(record)
    },
    async loadFileUndoTransactions(limit, scope) {
      return structuredClone(undoTransactions
        .filter((item) => !scope || sameScope(item.scope, scope))
        .sort((left, right) => left.record.createdAt - right.record.createdAt || left.record.id.localeCompare(right.record.id))
        .slice(-boundedLimit(limit, 100))
        .map((item) => item.record))
    },
    async saveFileUndoTransaction(record, limit, scope) {
      const next = [...undoTransactions.filter((item) => item.record.id !== record.id), structuredClone({ record, scope })]
      const matching = next
        .filter((item) => sameScope(item.scope, scope))
        .sort((left, right) => left.record.createdAt - right.record.createdAt || left.record.id.localeCompare(right.record.id))
      const keep = new Set(matching.slice(-boundedLimit(limit, 100)).map((item) => item.record.id))
      undoTransactions = next.filter((item) => !sameScope(item.scope, scope) || keep.has(item.record.id))
    },
    async removeFileUndoTransaction(id) {
      const before = undoTransactions.length
      undoTransactions = undoTransactions.filter((item) => item.record.id !== id)
      return undoTransactions.length !== before
    },
  }
}

function sameScope(left: FileOperationScope | undefined, right: FileOperationScope | undefined): boolean {
  return left?.nodeId === right?.nodeId
    && left?.componentId === right?.componentId
    && left?.workspaceId === right?.workspaceId
}

function matches(record: FileDeletionRecord, query: FileDeletionQuery): boolean {
  return (!query.nodeId || record.nodeId === query.nodeId)
    && (!query.componentId || record.componentId === query.componentId)
    && (!query.workspaceId || record.workspaceId === query.workspaceId)
    && (!query.state || record.state === query.state)
    && (!query.deletionKind || record.deletionKind === query.deletionKind)
    && (query.restoreAvailable === undefined || record.restoreAvailable === query.restoreAvailable)
    && (query.from === undefined || record.deletedAt >= query.from)
    && (query.to === undefined || record.deletedAt <= query.to)
}

function boundedLimit(value: number | undefined, maximum: number): number {
  const limit = value ?? Math.min(50, maximum)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) throw new Error(`Limit must be from 1 to ${maximum}.`)
  return limit
}
