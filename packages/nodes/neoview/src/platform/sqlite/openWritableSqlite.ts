import type { SqliteBinding } from "./openReadonlySqlite.js"

export interface WritableSqliteConnection {
  all(sql: string, ...bindings: SqliteBinding[]): Record<string, unknown>[]
  get(sql: string, ...bindings: SqliteBinding[]): Record<string, unknown> | undefined
  run(sql: string, ...bindings: SqliteBinding[]): { changes: number }
  exec(sql: string): void
  close(): void
}

export async function openWritableSqlite(path: string): Promise<WritableSqliteConnection> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { create: boolean; strict: boolean }) => {
        query(sql: string): {
          all(...bindings: SqliteBinding[]): Record<string, unknown>[]
          get(...bindings: SqliteBinding[]): Record<string, unknown> | null
          run(...bindings: SqliteBinding[]): unknown
        }
        exec(sql: string): void
        close(): void
      }
    }
    const database = new sqlite.Database(path, { create: false, strict: true })
    const statements = new Map<string, ReturnType<typeof database.query>>()
    const statement = (sql: string) => {
      let current = statements.get(sql)
      if (!current) {
        current = database.query(sql)
        statements.set(sql, current)
      }
      return current
    }
    return {
      all: (sql, ...bindings) => statement(sql).all(...bindings),
      get: (sql, ...bindings) => statement(sql).get(...bindings) ?? undefined,
      run: (sql, ...bindings) => ({ changes: numericChanges(statement(sql).run(...bindings)) }),
      exec: (sql) => database.exec(sql),
      close: () => {
        statements.clear()
        database.close()
      },
    }
  }

  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path)
  const statements = new Map<string, import("node:sqlite").StatementSync>()
  const statement = (sql: string) => {
    let current = statements.get(sql)
    if (!current) {
      current = database.prepare(sql)
      statements.set(sql, current)
    }
    return current
  }
  return {
    all: (sql, ...bindings) => statement(sql).all(...bindings) as Record<string, unknown>[],
    get: (sql, ...bindings) => statement(sql).get(...bindings) as Record<string, unknown> | undefined,
    run: (sql, ...bindings) => ({ changes: numericChanges(statement(sql).run(...bindings)) }),
    exec: (sql) => database.exec(sql),
    close: () => {
      statements.clear()
      database.close()
    },
  }
}

function numericChanges(value: unknown): number {
  const changes = value && typeof value === "object" && "changes" in value ? (value as { changes: unknown }).changes : 0
  if (typeof changes === "bigint") return Number(changes)
  return typeof changes === "number" && Number.isSafeInteger(changes) ? changes : 0
}
