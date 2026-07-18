export class LatestRecordWriteCoordinator<Key, Record> {
  readonly #pending = new Map<Key, Record>()
  readonly #timers = new Map<Key, ReturnType<typeof setTimeout>>()
  readonly #running = new Map<Key, Promise<void>>()
  readonly #runningRecords = new Map<Key, Record>()
  #closed = false

  constructor(
    private readonly keyOf: (record: Record) => Key,
    private readonly save: (record: Record) => Promise<void>,
    private readonly delayMs = 250,
  ) {}

  latest(key: Key): Record | undefined {
    return this.#pending.get(key) ?? this.#runningRecords.get(key)
  }

  record(value: Record): void {
    if (this.#closed) return
    const key = this.keyOf(value)
    this.#pending.set(key, value)
    if (this.#timers.has(key)) return
    const timer = setTimeout(() => {
      this.#timers.delete(key)
      void this.flush(key).catch(() => undefined)
    }, this.delayMs)
    timer.unref?.()
    this.#timers.set(key, timer)
  }

  async flush(key: Key): Promise<void> {
    const timer = this.#timers.get(key)
    if (timer) clearTimeout(timer)
    this.#timers.delete(key)
    while (true) {
      await this.#running.get(key)?.catch(() => undefined)
      const value = this.#pending.get(key)
      if (!value) return
      this.#pending.delete(key)
      const write = this.save(value)
      this.#running.set(key, write)
      this.#runningRecords.set(key, value)
      try {
        await write
      } finally {
        if (this.#running.get(key) === write) {
          this.#running.delete(key)
          this.#runningRecords.delete(key)
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const keys = new Set([...this.#pending.keys(), ...this.#running.keys(), ...this.#timers.keys()])
    const writes = await Promise.allSettled([...keys].map((key) => this.flush(key)))
    const errors = writes.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
    if (errors.length) throw new AggregateError(errors, "Failed to persist one or more pending records.")
  }
}
