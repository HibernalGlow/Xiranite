export const AUTO_TRAINING_IDLE_DELAY_MS = 10 * 60 * 1000

export interface ClipmAutoTrainingSchedulerOptions {
  enabled: boolean
  batchSize: number
  runAttempt(batchSize: number): Promise<void>
  onError?(error: unknown): void
  idleDelayMs?: number
}

export class ClipmAutoTrainingScheduler {
  #enabled: boolean
  #batchSize: number
  #runAttempt: (batchSize: number) => Promise<void>
  #onError: ((error: unknown) => void) | undefined
  readonly #idleDelayMs: number
  #activeOperations = 0
  #attempting = false
  #activityDuringAttempt = false
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(options: ClipmAutoTrainingSchedulerOptions) {
    this.#enabled = options.enabled
    this.#batchSize = normalizedBatchSize(options.batchSize)
    this.#runAttempt = options.runAttempt
    this.#onError = options.onError
    this.#idleDelayMs = options.idleDelayMs ?? AUTO_TRAINING_IDLE_DELAY_MS
  }

  update(options: Omit<ClipmAutoTrainingSchedulerOptions, "idleDelayMs">): void {
    this.#enabled = options.enabled
    this.#batchSize = normalizedBatchSize(options.batchSize)
    this.#runAttempt = options.runAttempt
    this.#onError = options.onError
    if (!this.#enabled) this.#clearTimer()
  }

  async runActivity<T>(operation: () => Promise<T>): Promise<T> {
    this.#activeOperations += 1
    if (this.#attempting) this.#activityDuringAttempt = true
    this.#clearTimer()
    try {
      return await operation()
    } finally {
      this.#activeOperations -= 1
      this.#schedule()
    }
  }

  disable(): void {
    this.#enabled = false
    this.#clearTimer()
  }

  #schedule(): void {
    if (!this.#enabled || this.#activeOperations > 0 || this.#attempting || this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#attempt()
    }, this.#idleDelayMs)
    this.#timer.unref?.()
  }

  async #attempt(): Promise<void> {
    if (!this.#enabled || this.#activeOperations > 0 || this.#attempting) {
      this.#schedule()
      return
    }
    this.#attempting = true
    this.#activityDuringAttempt = false
    try {
      await this.#runAttempt(this.#batchSize)
    } catch (error) {
      this.#onError?.(error)
    } finally {
      this.#attempting = false
      if (this.#activityDuringAttempt) this.#schedule()
    }
  }

  #clearTimer(): void {
    if (!this.#timer) return
    clearTimeout(this.#timer)
    this.#timer = undefined
  }
}

function normalizedBatchSize(value: number): number {
  return Number.isInteger(value) && value >= 1 && value <= 1000 ? value : 20
}
