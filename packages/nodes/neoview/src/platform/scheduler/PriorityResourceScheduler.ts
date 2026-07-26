import type {
  ResourceLease,
  ResourcePriority,
  ResourceScheduler,
  ResourceTaskRequest,
} from "../../ports/ResourceScheduler.js"

interface WaitingTask {
  request: ResourceTaskRequest
  requestedWeight: number
  minimumWeight: number
  enqueuedAtMs: number
  resolve: (lease: ResourceLease) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

export interface PriorityResourceSchedulerSnapshot {
  topology: "shared-queue"
  active: number
  activeWeight: number
  queued: number
  queuedWeight: number
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

export interface PriorityResourceSchedulerOptions {
  maxConcurrent?: number
  reservedInteractive?: number
  maxWeight?: number
  reservedInteractiveWeight?: number
  /** How long deferred work may wait before it earns one priority level. */
  deferredAgingMs?: number
  now?: () => number
}

const DEFAULT_DEFERRED_AGING_MS = 1_000
const DEFERRED_PRIORITIES: readonly ResourcePriority[] = ["view", "ahead", "background"]
const DEFERRED_PRIORITY_RANK: Readonly<Record<ResourcePriority, number>> = {
  interactive: 4,
  view: 3,
  ahead: 2,
  background: 1,
}

export class PriorityResourceScheduler implements ResourceScheduler, AsyncDisposable {
  readonly #maxConcurrent: number
  readonly #reservedInteractive: number
  readonly #maxWeight: number
  readonly #reservedInteractiveWeight: number
  readonly #deferredAgingMs: number
  readonly #queues: Record<ResourcePriority, WaitingTask[]> = {
    interactive: [],
    view: [],
    ahead: [],
    background: [],
  }
  #active = 0
  #activeWeight = 0
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
    this.#maxWeight = boundedInteger(options.maxWeight ?? this.#maxConcurrent, "maxWeight", 1, 1_000_000)
    this.#reservedInteractiveWeight = boundedInteger(
      options.reservedInteractiveWeight ?? Math.min(1, this.#maxWeight - 1),
      "reservedInteractiveWeight",
      0,
      this.#maxWeight - 1,
    )
    this.#deferredAgingMs = positiveFiniteNumber(
      options.deferredAgingMs ?? DEFAULT_DEFERRED_AGING_MS,
      "deferredAgingMs",
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
      activeWeight: this.#activeWeight,
      queued: this.queued,
      queuedWeight: Object.values(this.#queues).reduce(
        (total, queue) => total + queue.reduce((sum, task) => sum + task.requestedWeight, 0),
        0,
      ),
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
      oldestQueuedWaitMs: oldestQueuedAtMs === undefined ? 0 : Math.max(0, this.#now() - oldestQueuedAtMs),
    }
  }

  acquire(request: ResourceTaskRequest, signal?: AbortSignal): Promise<ResourceLease> {
    if (this.#closed) return Promise.reject(resourceSchedulerClosedError())
    signal?.throwIfAborted()
    const requestedWeight = boundedInteger(request.weight ?? 1, "weight", 1, 1_000_000)
    const minimumWeight = boundedInteger(request.minimumWeight ?? requestedWeight, "minimumWeight", 1, requestedWeight)
    const eligibleWeight = request.priority === "interactive"
      ? this.#maxWeight
      : this.#maxWeight - this.#reservedInteractiveWeight
    if (minimumWeight > eligibleWeight) {
      return Promise.reject(new RangeError(`minimumWeight ${minimumWeight} exceeds ${request.priority} capacity ${eligibleWeight}`))
    }
    return new Promise<ResourceLease>((resolve, reject) => {
      const waiting: WaitingTask = { request, requestedWeight, minimumWeight, enqueuedAtMs: this.#now(), resolve, reject, signal }
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
      const interactiveCapacity = this.#maxWeight - this.#activeWeight
      const interactive = takeFitting(this.#queues.interactive, interactiveCapacity)
      if (interactive) {
        this.#start(interactive, Math.min(interactive.requestedWeight, interactiveCapacity))
        continue
      }
      if (this.#active >= this.#maxConcurrent - this.#reservedInteractive) return
      const deferredCapacity = this.#maxWeight - this.#reservedInteractiveWeight - this.#activeWeight
      const deferred = deferredCapacity > 0 ? this.#takeDeferred(deferredCapacity) : undefined
      if (!deferred) return
      this.#start(deferred, Math.min(deferred.requestedWeight, deferredCapacity))
    }
  }

  #takeDeferred(availableWeight: number): WaitingTask | undefined {
    const now = this.#now()
    let selectedPriority: ResourcePriority | undefined
    let selectedIndex = -1
    let selectedRank = -1
    let selectedEnqueuedAt = Number.POSITIVE_INFINITY

    for (const priority of DEFERRED_PRIORITIES) {
      const queue = this.#queues[priority]
      for (let index = 0; index < queue.length; index += 1) {
        const waiting = queue[index]!
        if (waiting.minimumWeight > availableWeight) continue
        const waitMs = Math.max(0, now - waiting.enqueuedAtMs)
        const agingSteps = Math.floor(waitMs / this.#deferredAgingMs)
        const rank = Math.min(
          DEFERRED_PRIORITY_RANK.view,
          DEFERRED_PRIORITY_RANK[priority] + agingSteps,
        )
        if (rank > selectedRank || (rank === selectedRank && waiting.enqueuedAtMs < selectedEnqueuedAt)) {
          selectedPriority = priority
          selectedIndex = index
          selectedRank = rank
          selectedEnqueuedAt = waiting.enqueuedAtMs
        }
      }
    }

    return selectedPriority === undefined ? undefined : this.#queues[selectedPriority].splice(selectedIndex, 1)[0]
  }

  #start(waiting: WaitingTask, grantedWeight: number): void {
    waiting.signal?.removeEventListener("abort", waiting.abort!)
    if (waiting.signal?.aborted) {
      this.#cancelled += 1
      waiting.reject(waiting.signal.reason)
      return
    }
    const queueWaitMs = Math.max(0, this.#now() - waiting.enqueuedAtMs)
    this.#active += 1
    this.#activeWeight += grantedWeight
    this.#granted += 1
    this.#queueWaitSamples += 1
    this.#totalQueueWaitMs += queueWaitMs
    this.#maxQueueWaitMs = Math.max(this.#maxQueueWaitMs, queueWaitMs)
    let released = false
    waiting.resolve({
      weight: grantedWeight,
      release: () => {
        if (released) return
        released = true
        this.#active -= 1
        this.#activeWeight -= grantedWeight
        this.#released += 1
        this.#drain()
      },
    })
  }
}

function takeFitting(queue: WaitingTask[], availableWeight: number): WaitingTask | undefined {
  const index = queue.findIndex((task) => task.minimumWeight <= availableWeight)
  return index < 0 ? undefined : queue.splice(index, 1)[0]
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

function positiveFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than 0`)
  }
  return value
}
