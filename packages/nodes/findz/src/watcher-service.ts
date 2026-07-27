export interface FindzWatcherEvent {
  path: string
  type: string
}

export interface FindzWatcherClient {
  applyWatcherChanges(libraryId: string, changes: FindzWatcherEvent[]): Promise<unknown>
  startScan(libraryId: string): Promise<unknown>
  setWatcherHealth(libraryId: string, health: "healthy" | "degraded"): Promise<unknown>
}

export interface FindzWatcherSubscription {
  unsubscribe(): Promise<void>
}

export interface FindzWatcherTimer {
  set(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clear(timer: ReturnType<typeof setTimeout>): void
}

const defaultTimer: FindzWatcherTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (timer) => clearTimeout(timer),
}

export function coalesceFindzWatcherEvents(events: readonly FindzWatcherEvent[]): FindzWatcherEvent[] {
  const latestByPath = new Map<string, FindzWatcherEvent>()
  for (const event of events) latestByPath.set(event.path, { path: event.path, type: event.type })
  return [...latestByPath.values()]
}

export class FindzLibraryWatch {
  private readonly changes = new Map<string, FindzWatcherEvent>()
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private reconciliationQueued = false
  private subscription: FindzWatcherSubscription | undefined

  constructor(
    readonly libraryId: string,
    readonly root: string,
    private readonly client: FindzWatcherClient,
    private readonly timer: FindzWatcherTimer = defaultTimer,
    private readonly quietPeriodMs = 250,
  ) {}

  setSubscription(subscription: FindzWatcherSubscription): void {
    if (this.closed) {
      void subscription.unsubscribe()
      return
    }
    this.subscription = subscription
  }

  queue(events: readonly FindzWatcherEvent[]): void {
    if (this.closed) return
    for (const event of coalesceFindzWatcherEvents(events)) this.changes.set(event.path, event)
    if (this.flushTimer) return
    this.flushTimer = this.timer.set(() => { void this.flush() }, this.quietPeriodMs)
  }

  async degrade(): Promise<void> {
    if (this.closed) return
    await this.client.setWatcherHealth(this.libraryId, "degraded")
    if (this.reconciliationQueued || this.closed) return
    this.reconciliationQueued = true
    try {
      await this.client.startScan(this.libraryId)
    } catch {
      // The degraded state remains visible even when reconciliation cannot start.
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.flushTimer) this.timer.clear(this.flushTimer)
    this.flushTimer = undefined
    this.changes.clear()
    await this.subscription?.unsubscribe()
    this.subscription = undefined
  }

  private async flush(): Promise<void> {
    this.flushTimer = undefined
    if (this.closed || !this.changes.size) return
    const changes = [...this.changes.values()]
    this.changes.clear()
    try {
      await this.client.applyWatcherChanges(this.libraryId, changes)
      if (!this.closed) {
        this.reconciliationQueued = false
        await this.client.setWatcherHealth(this.libraryId, "healthy")
      }
    } catch {
      await this.degrade()
    }
  }
}
