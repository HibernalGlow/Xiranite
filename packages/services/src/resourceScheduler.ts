import type {
  ResourceClass,
  ResourceLease,
  ResourcePriority,
  ResourceScheduler,
  ResourceTaskRequest,
} from "@xiranite/contract"

interface WaitingTask {
  request: ResourceTaskRequest
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
}

export interface ResourcePoolSnapshot {
  active: number
  queued: number
  queuedByPriority: Readonly<Record<ResourcePriority, number>>
}

const DEFAULT_POOLS: Record<ResourceClass, ResourcePoolOptions> = {
  cpu: { maxConcurrent: 2, reservedInteractive: 1 },
  io: { maxConcurrent: 4, reservedInteractive: 1 },
  gpu: { maxConcurrent: 1, reservedInteractive: 0 },
}

export class ResourceSchedulerService implements ResourceScheduler {
  readonly #pools: Record<ResourceClass, PriorityResourcePool>

  constructor(options: ResourceSchedulerServiceOptions = {}) {
    this.#pools = {
      cpu: new PriorityResourcePool(options.pools?.cpu ?? DEFAULT_POOLS.cpu),
      io: new PriorityResourcePool(options.pools?.io ?? DEFAULT_POOLS.io),
      gpu: new PriorityResourcePool(options.pools?.gpu ?? DEFAULT_POOLS.gpu),
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

  constructor(options: ResourcePoolOptions) {
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
      const waiting: WaitingTask = { request, resolve, reject, signal }
      if (signal) {
        waiting.abort = () => {
          const queue = this.#queues[request.priority]
          const index = queue.indexOf(waiting)
          if (index >= 0) queue.splice(index, 1)
          reject(signal.reason)
        }
        signal.addEventListener("abort", waiting.abort, { once: true })
      }
      this.#queues[request.priority].push(waiting)
      this.#drain()
    })
  }

  snapshot(): ResourcePoolSnapshot {
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
      waiting.reject(waiting.signal.reason)
      return
    }
    this.#active += 1
    let released = false
    waiting.resolve({
      release: () => {
        if (released) return
        released = true
        this.#active -= 1
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
