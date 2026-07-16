import type {
  ResourceClass,
  ResourceLease,
  ResourcePriority,
  ResourceScheduler,
  ResourceTaskRequest,
} from "@xiranite/contract"

interface WaitingTask {
  request: ResourceTaskRequest
  enqueuedAtMs: number
  resolve: (lease: ResourceLease) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

export interface ResourcePoolOptions {
  maxConcurrent: number
  reservedInteractive?: number
}

export interface ResourceSchedulerServiceOptions {
  pools?: Partial<Record<ResourceClass, ResourcePoolOptions>>
  now?: () => number
}

export interface ResourcePoolSnapshot {
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

const DEFAULT_POOLS: Record<ResourceClass, ResourcePoolOptions> = {
  cpu: { maxConcurrent: 2, reservedInteractive: 1 },
  io: { maxConcurrent: 4, reservedInteractive: 1 },
  gpu: { maxConcurrent: 1, reservedInteractive: 0 },
}

export class ResourceSchedulerService implements ResourceScheduler {
  readonly #pools: Record<ResourceClass, PriorityResourcePool>

  constructor(options: ResourceSchedulerServiceOptions = {}) {
    const now = options.now ?? performance.now.bind(performance)
    this.#pools = {
      cpu: new PriorityResourcePool(options.pools?.cpu ?? DEFAULT_POOLS.cpu, now),
      io: new PriorityResourcePool(options.pools?.io ?? DEFAULT_POOLS.io, now),
      gpu: new PriorityResourcePool(options.pools?.gpu ?? DEFAULT_POOLS.gpu, now),
    }
  }

  acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<ResourceLease> {
    return this.#pools[request.resource].acquire(request, signal)
  }

  snapshot(): Readonly<Record<ResourceClass, ResourcePoolSnapshot>> {
    return {
      cpu: this.#pools.cpu.snapshot(),
      io: this.#pools.io.snapshot(),
      gpu: this.#pools.gpu.snapshot(),
    }
  }
}

class PriorityResourcePool {
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

  constructor(options: ResourcePoolOptions, private readonly now: () => number) {
    this.#maxConcurrent = boundedInteger(options.maxConcurrent, "maxConcurrent", 1, 64)
    this.#reservedInteractive = boundedInteger(
      options.reservedInteractive ?? Math.min(1, this.#maxConcurrent - 1),
      "reservedInteractive",
      0,
      this.#maxConcurrent - 1,
    )
  }

  acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<ResourceLease> {
    signal?.throwIfAborted()
    return new Promise<ResourceLease>((resolve, reject) => {
      const waiting: WaitingTask = { request, enqueuedAtMs: this.now(), resolve, reject, signal }
      if (signal) {
        waiting.abort = () => {
          const queue = this.#queues[request.priority]
          const index = queue.indexOf(waiting)
          if (index >= 0) queue.splice(index, 1)
          this.#cancelled += 1
          reject(signal.reason)
        }
        signal.addEventListener("abort", waiting.abort, { once: true })
      }
      this.#queues[request.priority].push(waiting)
      this.#drain()
    })
  }

  snapshot(): ResourcePoolSnapshot {
    const oldestQueuedAtMs = Object.values(this.#queues)
      .flatMap((queue) => queue.length ? [queue[0]!.enqueuedAtMs] : [])
      .reduce<number | undefined>((oldest, value) => oldest === undefined ? value : Math.min(oldest, value), undefined)
    return {
      active: this.#active,
      queued: this.#queues.interactive.length + this.#queues.view.length
        + this.#queues.ahead.length + this.#queues.background.length,
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
      oldestQueuedWaitMs: oldestQueuedAtMs === undefined ? 0 : Math.max(0, this.now() - oldestQueuedAtMs),
    }
  }

  #drain(): void {
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
    const queueWaitMs = Math.max(0, this.now() - waiting.enqueuedAtMs)
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

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}
