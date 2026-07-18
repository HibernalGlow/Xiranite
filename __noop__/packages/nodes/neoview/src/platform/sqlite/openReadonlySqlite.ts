export type SqliteBinding = string | number | bigint | Uint8Array | null

export interface ReadonlySqliteConnection {
  all(sql: string, ...bindings: SqliteBinding[]): Record<string, unknown>[]
  get(sql: string, ...bindings: SqliteBinding[]): Record<string, unknown> | undefined
  exec(sql: string): void
  close(): void
}

export async function openReadonlySqlite(path: string): Promise<ReadonlySqliteConnection> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { readonly: boolean; strict: boolean }) => {
        query(sql: string): {
          all(...bindings: SqliteBinding[]): Record<string, unknown>[]
          get(...bindings: SqliteBinding[]): Record<string, unknown> | null
        }
        exec(sql: string): void
        close(): void
      }
    }
    const database = new sqlite.Database(path, { readonly: true, strict: true })
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
      exec: (sql) => database.exec(sql),
      close: () => {
        statements.clear()
        database.close()
      },
    }
  }

  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path, { readOnly: true })
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
    exec: (sql) => database.exec(sql),
    close: () => {
      statements.clear()
      database.close()
    },
  }
}
