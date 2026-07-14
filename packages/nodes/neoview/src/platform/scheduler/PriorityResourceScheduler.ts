import type {
  ResourceLease,
  ResourcePriority,
  ResourceScheduler,
  ResourceTaskRequest,
} from "../../ports/ResourceScheduler.js"

interface WaitingTask {
  request: ResourceTaskRequest
  resolve: (lease: ResourceLease) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

export interface PriorityResourceSchedulerOptions {
  maxConcurrent?: number
  reservedInteractive?: number
}

export class PriorityResourceScheduler implements ResourceScheduler {
  readonly #maxConcurrent: number
  readonly #reservedInteractive: number
  readonly #queues: Record<ResourcePriority, WaitingTask[]> = {
    interactive: [],
    prefetch: [],
    background: [],
  }
  #active = 0

  constructor(options: PriorityResourceSchedulerOptions = {}) {
    this.#maxConcurrent = boundedInteger(options.maxConcurrent ?? 2, "maxConcurrent", 1, 64)
    this.#reservedInteractive = boundedInteger(
      options.reservedInteractive ?? Math.min(1, this.#maxConcurrent - 1),
      "reservedInteractive",
      0,
      this.#maxConcurrent - 1,
    )
  }

  get active(): number {
    return this.#active
  }

  get queued(): number {
    return this.#queues.interactive.length + this.#queues.prefetch.length + this.#queues.background.length
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

  #drain(): void {
    while (this.#active < this.#maxConcurrent) {
      const interactive = this.#queues.interactive.shift()
      if (interactive) {
        this.#start(interactive)
        continue
      }
      if (this.#active >= this.#maxConcurrent - this.#reservedInteractive) return
      const deferred = this.#queues.prefetch.shift() ?? this.#queues.background.shift()
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
