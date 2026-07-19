import type {
  ResourceLease,
  ResourcePriority,
  ResourceScheduler,
  ResourceTaskRequest,
} from "../../ports/ResourceScheduler.js"

interface WaitingTask {
  request: ResourceTaskRequest
  enqueuedAtMs: number
  resolve: (lease: ResourceLease) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

export interface PriorityResourceSchedulerSnapshot {
  topology: "shared-queue"
  active: number
  queued: number
  queuedByPriority: Readonly<Record<ResourcePriority, number>>
  granted: number
  released: number
  cancelled: number
  queueWaitSamples: number
  totalQueueWaitMs: number
  maxQueueWaitMs: number
  oldestQueuedWaitMs: number
}

export interface PriorityResourceSchedulerOptions {
  maxConcurrent?: number
  reservedInteractive?: number
  now?: () => number
}

export class PriorityResourceScheduler implements ResourceScheduler, AsyncDisposable {
  readonly #maxConcurrent: number
  readonly #reservedInteractive: number
  readonly #queues: Record<ResourcePriority, WaitingTask[]> = {
    interactive: [],
    view: [],
    ahead: [],
    background: [],
  }
  #active = 0
  #granted = 0
  #released = 0
  #cancelled = 0
  #queueWaitSamples = 0
  #totalQueueWaitMs = 0
  #maxQueueWaitMs = 0
  #closed = false
  readonly #now: () => number

  constructor(options: PriorityResourceSchedulerOptions = {}) {
    this.#maxConcurrent = boundedInteger(options.maxConcurrent ?? 2, "maxConcurrent", 1, 64)
    this.#reservedInteractive = boundedInteger(
      options.reservedInteractive ?? Math.min(1, this.#maxConcurrent - 1),
      "reservedInteractive",
      0,
      this.#maxConcurrent - 1,
    )
    this.#now = options.now ?? performance.now.bind(performance)
  }

  get active(): number {
    return this.#active
  }

  get queued(): number {
    return this.#queues.interactive.length + this.#queues.view.length
      + this.#queues.ahead.length + this.#queues.background.length
  }

  snapshot(): PriorityResourceSchedulerSnapshot {
    const oldestQueuedAtMs = Object.values(this.#queues)
      .flatMap((queue) => queue.length ? [queue[0]!.enqueuedAtMs] : [])
      .reduce<number | undefined>((oldest, value) => oldest === undefined ? value : Math.min(oldest, value), undefined)
    return {
      topology: "shared-queue",
      active: this.#active,
      queued: this.queued,
      queuedByPriority: {
        interactive: this.#queues.interactive.length,
        view: this.#queues.view.length,
        ahead: this.#queues.ahead.length,
        background: this.#queues.background.length,
      },
      granted: this.#granted,
      released: this.#released,
      cancelled: this.#cancelled,
      queueWaitSamples: this.#queueWaitSamples,
      totalQueueWaitMs: this.#totalQueueWaitMs,
      maxQueueWaitMs: this.#maxQueueWaitMs,
      oldestQueuedWaitMs: oldestQueuedAtMs === undefined ? 0 : Math.max(0, this.#now() - oldestQueuedAtMs),
    }
  }

  acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<ResourceLease> {
    if (this.#closed) return Promise.reject(resourceSchedulerClosedError())
    signal?.throwIfAborted()
    return new Promise<ResourceLease>((resolve, reject) => {
      const waiting: WaitingTask = { request, enqueuedAtMs: this.#now(), resolve, reject, signal }
      if (signal) {
        waiting.abort = () => {
          const queue = this.#queues[request.priority]
          const index = queue.indexOf(waiting)
          if (index < 0) return
          queue.splice(index, 1)
          this.#cancelled += 1
          reject(signal.reason)
        }
        signal.addEventListener("abort", waiting.abort, { once: true })
      }
      this.#queues[request.priority].push(waiting)
      this.#drain()
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const error = resourceSchedulerClosedError()
    for (const queue of Object.values(this.#queues)) {
      for (const waiting of queue.splice(0)) {
        waiting.signal?.removeEventListener("abort", waiting.abort!)
        this.#cancelled += 1
        waiting.reject(error)
      }
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.close()
    return Promise.resolve()
  }

  #drain(): void {
    if (this.#closed) return
    while (this.#active < this.#maxConcurrent) {
      const interactive = this.#queues.interactive.shift()
      if (interactive) {
        this.#start(interactive)
        continue
      }
      if (this.#active >= this.#maxConcurrent - this.#reservedInteractive) return
      const deferred = this.#queues.view.shift() ?? this.#queues.ahead.shift() ?? this.#queues.background.shift()
      if (!deferred) return
      this.#start(deferred)
    }
  }

  #start(waiting: WaitingTask): void {
    waiting.signal?.removeEventListener("abort", waiting.abort!)
    if (waiting.signal?.aborted) {
      this.#cancelled += 1
      waiting.reject(waiting.signal.reason)
      return
    }
    const queueWaitMs = Math.max(0, this.#now() - waiting.enqueuedAtMs)
    this.#active += 1
    this.#granted += 1
    this.#queueWaitSamples += 1
    this.#totalQueueWaitMs += queueWaitMs
    this.#maxQueueWaitMs = Math.max(this.#maxQueueWaitMs, queueWaitMs)
    let released = false
    waiting.resolve({
      release: () => {
        if (released) return
        released = true
        this.#active -= 1
        this.#released += 1
        this.#drain()
      },
    })
  }
}

function resourceSchedulerClosedError(): DOMException {
  return new DOMException("Resource scheduler is closed.", "AbortError")
}

export const defaultImageTransformScheduler = new PriorityResourceScheduler({
  maxConcurrent: 2,
  reservedInteractive: 1,
})

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}
