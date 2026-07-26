import type {
  ResourceClass,
  ResourceLease,
  ResourcePriority,
  ResourceScheduler,
  ResourceTaskRequest,
} from "@xiranite/contract"

interface WaitingTask {
  request: ResourceTaskRequest
  requestedWeight: number
  minimumWeight: number
  memoryMiB: number
  enqueuedAtMs: number
  resolve: (lease: ResourceLease) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

export interface ResourcePoolOptions {
  maxConcurrent: number
  reservedInteractive?: number
  maxWeight?: number
  reservedInteractiveWeight?: number
}

export interface ResourceSchedulerServiceOptions {
  pools?: Partial<Record<ResourceClass, ResourcePoolOptions>>
  memory?: MemoryBudgetOptions
  now?: () => number
}

export interface MemoryBudgetOptions {
  maxMiB: number
  reservedInteractiveMiB?: number
}

export interface MemoryBudgetSnapshot {
  activeMiB: number
  queuedMiB: number
  maxMiB: number
  reservedInteractiveMiB: number
}

export interface ResourcePoolSnapshot {
  active: number
  activeWeight: number
  activeMemoryMiB: number
  queued: number
  queuedWeight: number
  queuedMemoryMiB: number
  maxWeight: number
  reservedInteractiveWeight: number
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
const DEFAULT_MEMORY: MemoryBudgetOptions = { maxMiB: 1_000_000, reservedInteractiveMiB: 0 }

export interface ResourceSchedulerServiceSnapshot extends Readonly<Record<ResourceClass, ResourcePoolSnapshot>> {
  memory: MemoryBudgetSnapshot
}

export class ResourceSchedulerService implements ResourceScheduler, AsyncDisposable {
  readonly #pools: Record<ResourceClass, PriorityResourcePool>
  readonly #memory: SharedMemoryBudget

  constructor(options: ResourceSchedulerServiceOptions = {}) {
    const now = options.now ?? performance.now.bind(performance)
    this.#memory = new SharedMemoryBudget(options.memory ?? DEFAULT_MEMORY)
    let pools!: Record<ResourceClass, PriorityResourcePool>
    const drainAll = () => {
      pools.cpu.drain()
      pools.io.drain()
      pools.gpu.drain()
    }
    pools = {
      cpu: new PriorityResourcePool(options.pools?.cpu ?? DEFAULT_POOLS.cpu, now, this.#memory, drainAll),
      io: new PriorityResourcePool(options.pools?.io ?? DEFAULT_POOLS.io, now, this.#memory, drainAll),
      gpu: new PriorityResourcePool(options.pools?.gpu ?? DEFAULT_POOLS.gpu, now, this.#memory, drainAll),
    }
    this.#pools = pools
  }

  acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<ResourceLease> {
    return this.#pools[request.resource].acquire(request, signal)
  }

  snapshot(): ResourceSchedulerServiceSnapshot {
    return {
      cpu: this.#pools.cpu.snapshot(),
      io: this.#pools.io.snapshot(),
      gpu: this.#pools.gpu.snapshot(),
      memory: this.#memory.snapshot(
        this.#pools.cpu.queuedMemoryMiB + this.#pools.io.queuedMemoryMiB + this.#pools.gpu.queuedMemoryMiB,
      ),
    }
  }

  close(): void {
    this.#pools.cpu.close()
    this.#pools.io.close()
    this.#pools.gpu.close()
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.close()
    return Promise.resolve()
  }
}

class PriorityResourcePool {
  readonly #maxConcurrent: number
  readonly #reservedInteractive: number
  readonly #maxWeight: number
  readonly #reservedInteractiveWeight: number
  readonly #queues: Record<ResourcePriority, WaitingTask[]> = {
    interactive: [],
    view: [],
    ahead: [],
    background: [],
  }
  #active = 0
  #activeWeight = 0
  #activeMemoryMiB = 0
  #granted = 0
  #released = 0
  #cancelled = 0
  #queueWaitSamples = 0
  #totalQueueWaitMs = 0
  #maxQueueWaitMs = 0
  #closed = false

  constructor(
    options: ResourcePoolOptions,
    private readonly now: () => number,
    private readonly memory: SharedMemoryBudget,
    private readonly capacityChanged: () => void,
  ) {
    this.#maxConcurrent = boundedInteger(options.maxConcurrent, "maxConcurrent", 1, 64)
    this.#reservedInteractive = boundedInteger(
      options.reservedInteractive ?? Math.min(1, this.#maxConcurrent - 1),
      "reservedInteractive",
      0,
      this.#maxConcurrent - 1,
    )
    this.#maxWeight = boundedInteger(options.maxWeight ?? this.#maxConcurrent, "maxWeight", 1, 1_000_000)
    this.#reservedInteractiveWeight = boundedInteger(
      options.reservedInteractiveWeight ?? Math.min(1, this.#maxWeight - 1),
      "reservedInteractiveWeight",
      0,
      this.#maxWeight - 1,
    )
  }

  acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<ResourceLease> {
    if (this.#closed) return Promise.reject(resourceSchedulerClosedError())
    signal?.throwIfAborted()
    const requestedWeight = boundedInteger(request.weight ?? 1, "weight", 1, 1_000_000)
    const minimumWeight = boundedInteger(request.minimumWeight ?? requestedWeight, "minimumWeight", 1, requestedWeight)
    const memoryMiB = boundedInteger(request.memoryMiB ?? 0, "memoryMiB", 0, 1_000_000)
    const eligibleWeight = request.priority === "interactive"
      ? this.#maxWeight
      : this.#maxWeight - this.#reservedInteractiveWeight
    if (minimumWeight > eligibleWeight) {
      return Promise.reject(new RangeError(`minimumWeight ${minimumWeight} exceeds ${request.priority} capacity ${eligibleWeight}`))
    }
    const eligibleMemoryMiB = this.memory.eligibleMiB(request.priority)
    if (memoryMiB > eligibleMemoryMiB) {
      return Promise.reject(new RangeError(`memoryMiB ${memoryMiB} exceeds ${request.priority} capacity ${eligibleMemoryMiB}`))
    }
    return new Promise<ResourceLease>((resolve, reject) => {
      const waiting: WaitingTask = { request, requestedWeight, minimumWeight, memoryMiB, enqueuedAtMs: this.now(), resolve, reject, signal }
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
      this.capacityChanged()
    })
  }

  snapshot(): ResourcePoolSnapshot {
    const oldestQueuedAtMs = Object.values(this.#queues)
      .flatMap((queue) => queue.length ? [queue[0]!.enqueuedAtMs] : [])
      .reduce<number | undefined>((oldest, value) => oldest === undefined ? value : Math.min(oldest, value), undefined)
    return {
      active: this.#active,
      activeWeight: this.#activeWeight,
      activeMemoryMiB: this.#activeMemoryMiB,
      queued: this.#queues.interactive.length + this.#queues.view.length
        + this.#queues.ahead.length + this.#queues.background.length,
      queuedWeight: Object.values(this.#queues).reduce(
        (total, queue) => total + queue.reduce((sum, task) => sum + task.requestedWeight, 0),
        0,
      ),
      queuedMemoryMiB: this.queuedMemoryMiB,
      maxWeight: this.#maxWeight,
      reservedInteractiveWeight: this.#reservedInteractiveWeight,
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

  get queuedMemoryMiB(): number {
    return Object.values(this.#queues).reduce(
      (total, queue) => total + queue.reduce((sum, task) => sum + task.memoryMiB, 0),
      0,
    )
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

  drain(): void {
    if (this.#closed) return
    while (this.#active < this.#maxConcurrent) {
      const interactiveCapacity = this.#maxWeight - this.#activeWeight
      const interactive = takeFitting(this.#queues.interactive, interactiveCapacity, (task) => this.memory.canGrant(task.request.priority, task.memoryMiB))
      if (interactive) {
        this.#start(interactive, Math.min(interactive.requestedWeight, interactiveCapacity))
        continue
      }
      if (this.#active >= this.#maxConcurrent - this.#reservedInteractive) return
      const deferredCapacity = this.#maxWeight - this.#reservedInteractiveWeight - this.#activeWeight
      const deferred = deferredCapacity > 0
        ? takeFitting(this.#queues.view, deferredCapacity, (task) => this.memory.canGrant(task.request.priority, task.memoryMiB))
          ?? takeFitting(this.#queues.ahead, deferredCapacity, (task) => this.memory.canGrant(task.request.priority, task.memoryMiB))
          ?? takeFitting(this.#queues.background, deferredCapacity, (task) => this.memory.canGrant(task.request.priority, task.memoryMiB))
        : undefined
      if (!deferred) return
      this.#start(deferred, Math.min(deferred.requestedWeight, deferredCapacity))
    }
  }

  #start(waiting: WaitingTask, grantedWeight: number): void {
    waiting.signal?.removeEventListener("abort", waiting.abort!)
    if (waiting.signal?.aborted) {
      this.#cancelled += 1
      waiting.reject(waiting.signal.reason)
      return
    }
    const queueWaitMs = Math.max(0, this.now() - waiting.enqueuedAtMs)
    this.memory.grant(waiting.memoryMiB)
    this.#active += 1
    this.#activeWeight += grantedWeight
    this.#activeMemoryMiB += waiting.memoryMiB
    this.#granted += 1
    this.#queueWaitSamples += 1
    this.#totalQueueWaitMs += queueWaitMs
    this.#maxQueueWaitMs = Math.max(this.#maxQueueWaitMs, queueWaitMs)
    let released = false
    waiting.resolve({
      weight: grantedWeight,
      memoryMiB: waiting.memoryMiB,
      release: () => {
        if (released) return
        released = true
        this.#active -= 1
        this.#activeWeight -= grantedWeight
        this.#activeMemoryMiB -= waiting.memoryMiB
        this.memory.release(waiting.memoryMiB)
        this.#released += 1
        this.capacityChanged()
      },
    })
  }
}

function takeFitting(
  queue: WaitingTask[],
  availableWeight: number,
  canStart: (task: WaitingTask) => boolean,
): WaitingTask | undefined {
  const index = queue.findIndex((task) => task.minimumWeight <= availableWeight && canStart(task))
  return index < 0 ? undefined : queue.splice(index, 1)[0]
}

class SharedMemoryBudget {
  readonly #maxMiB: number
  readonly #reservedInteractiveMiB: number
  #activeMiB = 0

  constructor(options: MemoryBudgetOptions) {
    this.#maxMiB = boundedInteger(options.maxMiB, "memory.maxMiB", 1, 1_000_000)
    this.#reservedInteractiveMiB = boundedInteger(
      options.reservedInteractiveMiB ?? 0,
      "memory.reservedInteractiveMiB",
      0,
      this.#maxMiB - 1,
    )
  }

  eligibleMiB(priority: ResourcePriority): number {
    return priority === "interactive" ? this.#maxMiB : this.#maxMiB - this.#reservedInteractiveMiB
  }

  canGrant(priority: ResourcePriority, memoryMiB: number): boolean {
    return this.#activeMiB + memoryMiB <= this.eligibleMiB(priority)
  }

  grant(memoryMiB: number): void {
    this.#activeMiB += memoryMiB
  }

  release(memoryMiB: number): void {
    this.#activeMiB -= memoryMiB
  }

  snapshot(queuedMiB: number): MemoryBudgetSnapshot {
    return {
      activeMiB: this.#activeMiB,
      queuedMiB,
      maxMiB: this.#maxMiB,
      reservedInteractiveMiB: this.#reservedInteractiveMiB,
    }
  }
}

function resourceSchedulerClosedError(): DOMException {
  return new DOMException("Resource scheduler is closed.", "AbortError")
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}
