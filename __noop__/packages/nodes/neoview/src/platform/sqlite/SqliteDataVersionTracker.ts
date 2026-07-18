export interface SqliteDataVersionConnection {
  get(sql: string): Record<string, unknown> | undefined
}

export class SqliteDataVersionTracker {
  readonly #database: SqliteDataVersionConnection
  readonly #pollIntervalMs: number
  readonly #now: () => number
  #dataVersion?: number
  #revision = 0
  #nextPollAt = 0

  constructor(
    database: SqliteDataVersionConnection,
    options: { pollIntervalMs?: number; now?: () => number } = {},
  ) {
    this.#database = database
    this.#pollIntervalMs = options.pollIntervalMs ?? 100
    this.#now = options.now ?? Date.now
    if (!Number.isSafeInteger(this.#pollIntervalMs) || this.#pollIntervalMs < 0 || this.#pollIntervalMs > 60_000) {
      throw new RangeError("pollIntervalMs must be an integer from 0 to 60000.")
    }
  }

  revision(): number {
    const now = this.#now()
    if (now < this.#nextPollAt) return this.#revision
    this.#nextPollAt = now + this.#pollIntervalMs
    try {
      const value = integerCell(this.#database.get("PRAGMA data_version"), "data_version")
      if (this.#dataVersion !== undefined && value !== this.#dataVersion) this.#revision += 1
      this.#dataVersion = value
    } catch {
      // A transient busy/error must not make thumbnail reads unavailable.
    }
    return this.#revision
  }
}

function integerCell(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key]
  const number = typeof value === "bigint" ? Number(value) : value
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Invalid SQLite ${key}.`)
  }
  return number
}
