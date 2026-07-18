export type ReaderMemoryPressureLevel = "normal" | "elevated" | "critical"

export interface ReaderMemoryPressureSnapshot {
  level: ReaderMemoryPressureLevel
  availableBytes?: number
  samples: number
  elevatedReliefs: number
  criticalReliefs: number
  admissionRejections: number
  lastReliefAtMs?: number
}

export interface ReaderMemoryPressureSample {
  level: ReaderMemoryPressureLevel
  availableBytes?: number
  relieve: boolean
}

export interface ReaderMemoryPressureMonitorOptions {
  criticalAvailableBytes?: number
  elevatedAvailableBytes?: number
  recoveryAvailableBytes?: number
  sampleIntervalMs?: number
  reliefIntervalMs?: number
  availableMemory?: () => number
  now?: () => number
}

/** Request-bound pressure policy. Sampling never creates timers or background work. */
export class ReaderMemoryPressureMonitor {
  readonly #criticalBytes: number
  readonly #elevatedBytes: number
  readonly #recoveryBytes: number
  readonly #sampleIntervalMs: number
  readonly #reliefIntervalMs: number
  readonly #availableMemory?: () => number
  readonly #now: () => number
  #level: ReaderMemoryPressureLevel = "normal"
  #availableBytes?: number
  #lastSampleAtMs = Number.NEGATIVE_INFINITY
  #lastReliefAtMs?: number
  #samples = 0
  #elevatedReliefs = 0
  #criticalReliefs = 0
  #admissionRejections = 0

  constructor(options: ReaderMemoryPressureMonitorOptions = {}) {
    this.#criticalBytes = positiveInteger(options.criticalAvailableBytes ?? 256 * 1024 * 1024, "criticalAvailableBytes")
    this.#elevatedBytes = positiveInteger(options.elevatedAvailableBytes ?? 512 * 1024 * 1024, "elevatedAvailableBytes")
    this.#recoveryBytes = positiveInteger(options.recoveryAvailableBytes ?? 768 * 1024 * 1024, "recoveryAvailableBytes")
    if (this.#criticalBytes > this.#elevatedBytes || this.#elevatedBytes >= this.#recoveryBytes) {
      throw new RangeError("Memory pressure thresholds must satisfy critical <= elevated < recovery.")
    }
    this.#sampleIntervalMs = nonNegativeInteger(options.sampleIntervalMs ?? 1_000, "sampleIntervalMs")
    this.#reliefIntervalMs = positiveInteger(options.reliefIntervalMs ?? 5_000, "reliefIntervalMs")
    this.#availableMemory = options.availableMemory ?? process.availableMemory
    this.#now = options.now ?? Date.now
  }

  sample(): ReaderMemoryPressureSample {
    const now = this.#now()
    if (now - this.#lastSampleAtMs >= this.#sampleIntervalMs) {
      this.#lastSampleAtMs = now
      this.#samples += 1
      this.#availableBytes = readAvailableMemory(this.#availableMemory)
      this.#level = this.#availableBytes === undefined ? "normal" : nextLevel(
        this.#level,
        this.#availableBytes,
        this.#criticalBytes,
        this.#elevatedBytes,
        this.#recoveryBytes,
      )
    }
    const relieve = this.#level !== "normal"
      && (this.#lastReliefAtMs === undefined || now - this.#lastReliefAtMs >= this.#reliefIntervalMs)
    return { level: this.#level, availableBytes: this.#availableBytes, relieve }
  }

  recordRelief(level: Exclude<ReaderMemoryPressureLevel, "normal">): void {
    this.#lastReliefAtMs = this.#now()
    if (level === "critical") this.#criticalReliefs += 1
    else this.#elevatedReliefs += 1
  }

  recordAdmissionRejection(): void {
    this.#admissionRejections += 1
  }

  snapshot(): ReaderMemoryPressureSnapshot {
    return {
      level: this.#level,
      availableBytes: this.#availableBytes,
      samples: this.#samples,
      elevatedReliefs: this.#elevatedReliefs,
      criticalReliefs: this.#criticalReliefs,
      admissionRejections: this.#admissionRejections,
      lastReliefAtMs: this.#lastReliefAtMs,
    }
  }
}

function nextLevel(
  current: ReaderMemoryPressureLevel,
  available: number,
  critical: number,
  elevated: number,
  recovery: number,
): ReaderMemoryPressureLevel {
  if (available >= recovery) return "normal"
  if (available <= critical) return "critical"
  if (current === "critical" && available <= elevated) return "critical"
  return available <= elevated || current !== "normal" ? "elevated" : "normal"
}

function readAvailableMemory(reader: (() => number) | undefined): number | undefined {
  if (!reader) return undefined
  try {
    const value = reader()
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  } catch {
    return undefined
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`)
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`)
  return value
}
