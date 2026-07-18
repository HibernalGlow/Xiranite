import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { PriorityResourceScheduler } from "../scheduler/PriorityResourceScheduler.js"

export interface VideoProcessSchedulerOptions {
  maxConcurrent?: number
  reservedInteractive?: number
}

export interface VideoProcessSchedulerSnapshot {
  readonly active: number
  readonly queued: number
  readonly maxConcurrent: number
  readonly closed: boolean
}

/** Composition-owned process budget for ffmpeg/ffprobe work. */
export class VideoProcessScheduler implements ResourceScheduler, AsyncDisposable {
  readonly #scheduler: PriorityResourceScheduler
  readonly #maxConcurrent: number
  #closed = false

  constructor(options: VideoProcessSchedulerOptions = {}) {
    this.#maxConcurrent = options.maxConcurrent ?? 1
    this.#scheduler = new PriorityResourceScheduler({
      maxConcurrent: this.#maxConcurrent,
      reservedInteractive: options.reservedInteractive ?? 0,
    })
  }

  acquire: ResourceScheduler["acquire"] = (request, signal) => this.#scheduler.acquire(request, signal)

  snapshot(): Readonly<VideoProcessSchedulerSnapshot> {
    return Object.freeze({
      active: this.#scheduler.active,
      queued: this.#scheduler.queued,
      maxConcurrent: this.#maxConcurrent,
      closed: this.#closed,
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#scheduler.close()
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.close()
    return Promise.resolve()
  }
}

/** Shared process budget for all ffmpeg/ffprobe work in the Reader runtime. */
export const videoProcessSlots = new VideoProcessScheduler()
