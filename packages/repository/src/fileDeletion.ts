import { createClient, type Client } from "@libsql/client"
import {
  parseFileDeletionRecord,
  parseFileUndoJournalRecord,
  type FileDeletionQuery,
  type FileDeletionRecord,
  type FileOperationScope,
  type FileUndoJournalRecord,
} from "@xiranite/file-operations"
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, type SQL } from "drizzle-orm"
import { drizzle } from "drizzle-orm/libsql"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import type { FileDeletionRepository } from "./index.js"

const fileDeletions = sqliteTable("file_deletions", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id"),
  transactionIndex: integer("transaction_index"),
  nodeId: text("node_id").notNull(),
  componentId: text("component_id"),
  workspaceId: text("workspace_id"),
  sourcePath: text("source_path").notNull(),
  deletionKind: text("deletion_kind").notNull(),
  pathKind: text("path_kind"),
  size: integer("size"),
  deletedAt: integer("deleted_at").notNull(),
  state: text("state").notNull(),
  restoreAvailable: integer("restore_available", { mode: "boolean" }).notNull(),
  receipt: text("receipt"),
  restoredAt: integer("restored_at"),
  lastRestoreAttemptAt: integer("last_restore_attempt_at"),
  lastError: text("last_error"),
})

const fileUndoTransactions = sqliteTable("file_undo_transactions", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  nodeId: text("node_id"),
  componentId: text("component_id"),
  workspaceId: text("workspace_id"),
  entries: text("entries").notNull(),
})

export interface LibsqlFileDeletionRepositoryOptions {
  url: string
  authToken?: string
  /** Lets a host compose file operations with another libSQL-backed repository. */
  client?: Client
}

export interface LibsqlFileDeletionRepository extends FileDeletionRepository {
  client: Client
}

export async function createLibsqlFileDeletionRepository(
  options: LibsqlFileDeletionRepositoryOptions,
): Promise<LibsqlFileDeletionRepository> {
  const client = options.client ?? createClient({ url: options.url, authToken: options.authToken })
  const db = drizzle(client)
  await ensureFileDeletionSchema(client)

  return {
    client,
    async createFileDeletionRecords(records) {
      if (!records.length) return
      for (const record of records) parseFileDeletionRecord(record)
      await db.transaction(async (tx) => {
        await tx.insert(fileDeletions).values(records.map(fromFileDeletionRecord))
      })
    },
    async getFileDeletion(id) {
      const rows = await db.select().from(fileDeletions).where(eq(fileDeletions.id, id)).limit(1)
      return rows[0] ? toFileDeletionRecord(rows[0]) : undefined
    },
    async listFileDeletions(query) {
      const limit = boundedLimit(query.limit)
      const conditions = deletionConditions(query)
      if (query.cursor) {
        const cursorRows = await db.select({ id: fileDeletions.id, deletedAt: fileDeletions.deletedAt })
          .from(fileDeletions).where(eq(fileDeletions.id, query.cursor)).limit(1)
        const cursor = cursorRows[0]
        if (cursor) {
          conditions.push(or(
            lt(fileDeletions.deletedAt, cursor.deletedAt),
            and(eq(fileDeletions.deletedAt, cursor.deletedAt), lt(fileDeletions.id, cursor.id)),
          )!)
        }
      }
      let rows = await db.select().from(fileDeletions)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(fileDeletions.deletedAt), desc(fileDeletions.id))
        .limit(limit + 1)
      const nextCursor = rows.length > limit ? rows[limit - 1]?.id ?? null : null
      if (rows.length > limit) rows = rows.slice(0, limit)
      return { items: rows.map(toFileDeletionRecord), nextCursor }
    },
    async listFileDeletionNodes() {
      const rows = await db.selectDistinct({ nodeId: fileDeletions.nodeId })
        .from(fileDeletions)
        .orderBy(asc(fileDeletions.nodeId))
      return rows.map((row) => row.nodeId)
    },
    async updateFileDeletion(record) {
      parseFileDeletionRecord(record)
      const rows = await db.update(fileDeletions).set(fromFileDeletionRecord(record))
        .where(eq(fileDeletions.id, record.id)).returning()
      if (!rows[0]) throw new Error(`File deletion not found: ${record.id}`)
      return toFileDeletionRecord(rows[0])
    },
    async loadFileUndoTransactions(limit, scope) {
      const rows = await db.select().from(fileUndoTransactions)
        .where(undoScopeCondition(scope))
        .orderBy(desc(fileUndoTransactions.createdAt), desc(fileUndoTransactions.id))
        .limit(boundedUndoLimit(limit))
      return rows.reverse().map(toFileUndoJournalRecord)
    },
    async saveFileUndoTransaction(record, limit, scope) {
      parseFileUndoJournalRecord(record)
      const boundedLimit = boundedUndoLimit(limit)
      await db.transaction(async (tx) => {
        const row = fromFileUndoJournalRecord(record, scope)
        await tx.insert(fileUndoTransactions).values(row).onConflictDoUpdate({
          target: fileUndoTransactions.id,
          set: {
            createdAt: row.createdAt,
            nodeId: row.nodeId,
            componentId: row.componentId,
            workspaceId: row.workspaceId,
            entries: row.entries,
          },
        })
        const rows = await tx.select({ id: fileUndoTransactions.id }).from(fileUndoTransactions)
          .where(undoScopeCondition(scope))
          .orderBy(desc(fileUndoTransactions.createdAt), desc(fileUndoTransactions.id))
        const staleIds = rows.slice(boundedLimit).map((item) => item.id)
        if (staleIds.length) await tx.delete(fileUndoTransactions).where(inArray(fileUndoTransactions.id, staleIds))
      })
    },
    async removeFileUndoTransaction(id) {
      const result = await db.delete(fileUndoTransactions).where(eq(fileUndoTransactions.id, id))
      return result.rowsAffected > 0
    },
  }
}

async function ensureFileDeletionSchema(client: Client): Promise<void> {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS file_deletions (
      id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT,
      transaction_index INTEGER,
      node_id TEXT NOT NULL,
      component_id TEXT,
      workspace_id TEXT,
      source_path TEXT NOT NULL,
      deletion_kind TEXT NOT NULL,
      path_kind TEXT,
      size INTEGER,
      deleted_at INTEGER NOT NULL,
      state TEXT NOT NULL,
      restore_available INTEGER NOT NULL,
      receipt TEXT,
      restored_at INTEGER,
      last_restore_attempt_at INTEGER,
      last_error TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS file_deletions_node_idx ON file_deletions (node_id, deleted_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS file_deletions_component_idx ON file_deletions (component_id, deleted_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS file_deletions_workspace_idx ON file_deletions (workspace_id, deleted_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS file_deletions_state_idx ON file_deletions (state, deleted_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS file_deletions_restore_node_idx
      ON file_deletions (restore_available, node_id, deleted_at DESC, id DESC)`,
    `CREATE TABLE IF NOT EXISTS file_undo_transactions (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      node_id TEXT,
      component_id TEXT,
      workspace_id TEXT,
      entries TEXT NOT NULL
    )`,
  ], "write")
  const tableInfo = await client.execute("PRAGMA table_info(file_undo_transactions)")
  const columns = new Set(tableInfo.rows.map((row) => String(row.name)))
  const migrations = [
    ["node_id", "ALTER TABLE file_undo_transactions ADD COLUMN node_id TEXT"],
    ["component_id", "ALTER TABLE file_undo_transactions ADD COLUMN component_id TEXT"],
    ["workspace_id", "ALTER TABLE file_undo_transactions ADD COLUMN workspace_id TEXT"],
  ].filter(([column]) => !columns.has(column!)).map(([, sql]) => sql!)
  if (migrations.length) await client.batch(migrations, "write")
  await client.batch([
    `CREATE INDEX IF NOT EXISTS file_undo_created_idx ON file_undo_transactions (created_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS file_undo_scope_created_idx
      ON file_undo_transactions (node_id, component_id, workspace_id, created_at DESC, id DESC)`,
  ], "write")
}

function fromFileDeletionRecord(record: FileDeletionRecord): typeof fileDeletions.$inferInsert {
  return {
    id: record.id,
    transactionId: record.transactionId ?? null,
    transactionIndex: record.transactionIndex ?? null,
    nodeId: record.nodeId,
    componentId: record.componentId ?? null,
    workspaceId: record.workspaceId ?? null,
    sourcePath: record.sourcePath,
    deletionKind: record.deletionKind,
    pathKind: record.pathKind ?? null,
    size: record.size ?? null,
    deletedAt: record.deletedAt,
    state: record.state,
    restoreAvailable: record.restoreAvailable,
    receipt: record.receipt ? JSON.stringify(record.receipt) : null,
    restoredAt: record.restoredAt ?? null,
    lastRestoreAttemptAt: record.lastRestoreAttemptAt ?? null,
    lastError: record.lastError ?? null,
  }
}

function toFileDeletionRecord(row: typeof fileDeletions.$inferSelect): FileDeletionRecord {
  return parseFileDeletionRecord({
    id: row.id,
    transactionId: row.transactionId ?? undefined,
    transactionIndex: row.transactionIndex ?? undefined,
    nodeId: row.nodeId,
    componentId: row.componentId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    sourcePath: row.sourcePath,
    deletionKind: row.deletionKind,
    pathKind: row.pathKind ?? undefined,
    size: row.size ?? undefined,
    deletedAt: row.deletedAt,
    state: row.state,
    restoreAvailable: row.restoreAvailable,
    receipt: row.receipt ? JSON.parse(row.receipt) : undefined,
    restoredAt: row.restoredAt ?? undefined,
    lastRestoreAttemptAt: row.lastRestoreAttemptAt ?? undefined,
    lastError: row.lastError ?? undefined,
  })
}

function deletionConditions(query: FileDeletionQuery): SQL[] {
  const conditions: SQL[] = []
  if (query.nodeId) conditions.push(eq(fileDeletions.nodeId, query.nodeId))
  if (query.componentId) conditions.push(eq(fileDeletions.componentId, query.componentId))
  if (query.workspaceId) conditions.push(eq(fileDeletions.workspaceId, query.workspaceId))
  if (query.state) conditions.push(eq(fileDeletions.state, query.state))
  if (query.deletionKind) conditions.push(eq(fileDeletions.deletionKind, query.deletionKind))
  if (query.restoreAvailable !== undefined) conditions.push(eq(fileDeletions.restoreAvailable, query.restoreAvailable))
  if (query.from !== undefined) conditions.push(gte(fileDeletions.deletedAt, query.from))
  if (query.to !== undefined) conditions.push(lte(fileDeletions.deletedAt, query.to))
  return conditions
}

function undoScopeCondition(scope: FileOperationScope | undefined): SQL | undefined {
  if (!scope) return undefined
  return and(
    eq(fileUndoTransactions.nodeId, scope.nodeId),
    scope.componentId === undefined
      ? isNull(fileUndoTransactions.componentId)
      : eq(fileUndoTransactions.componentId, scope.componentId),
    scope.workspaceId === undefined
      ? isNull(fileUndoTransactions.workspaceId)
      : eq(fileUndoTransactions.workspaceId, scope.workspaceId),
  )
}

function fromFileUndoJournalRecord(
  record: FileUndoJournalRecord,
  scope?: FileOperationScope,
): typeof fileUndoTransactions.$inferInsert {
  return {
    id: record.id,
    createdAt: record.createdAt,
    nodeId: scope?.nodeId ?? null,
    componentId: scope?.componentId ?? null,
    workspaceId: scope?.workspaceId ?? null,
    entries: JSON.stringify(record.entries),
  }
}

function toFileUndoJournalRecord(row: typeof fileUndoTransactions.$inferSelect): FileUndoJournalRecord {
  return parseFileUndoJournalRecord({ id: row.id, createdAt: row.createdAt, entries: JSON.parse(row.entries) })
}

function boundedLimit(limit: number | undefined): number {
  const value = limit ?? 50
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) throw new Error("File deletion limit must be from 1 to 1000.")
  return value
}

function boundedUndoLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("File undo limit must be from 1 to 100.")
  return limit
}
