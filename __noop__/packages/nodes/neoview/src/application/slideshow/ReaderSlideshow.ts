export type ReaderSlideshowState = "stopped" | "playing" | "paused"

export interface ReaderSlideshowPosition {
  pageCount: number
  currentPageIndex: number
  atEnd: boolean
}

export interface ReaderSlideshowSnapshot {
  state: ReaderSlideshowState
  intervalSeconds: number
  loop: boolean
  random: boolean
  remainingSeconds: number
}

export interface ReaderSlideshowOptions {
  readPosition(): ReaderSlideshowPosition
  nextPage(): boolean | Promise<boolean>
  goToPage(pageIndex: number): boolean | Promise<boolean>
  random?: () => number
  onError?(error: unknown): void
}

export type ReaderSlideshowConfig = Pick<ReaderSlideshowSnapshot, "intervalSeconds" | "loop" | "random">

const MIN_INTERVAL_SECONDS = 1
const MAX_INTERVAL_SECONDS = 60

export class ReaderSlideshow {
  readonly #options: ReaderSlideshowOptions
  readonly #listeners = new Set<() => void>()
  #snapshot: ReaderSlideshowSnapshot
  #deadline = 0
  #timer: ReturnType<typeof setTimeout> | undefined
  #generation = 0

  constructor(options: ReaderSlideshowOptions, initial: Partial<ReaderSlideshowConfig> = {}) {
    this.#options = options
    const intervalSeconds = normalizeInterval(initial.intervalSeconds ?? 5)
    this.#snapshot = {
      state: "stopped",
      intervalSeconds,
      loop: initial.loop ?? false,
      random: initial.random ?? false,
      remainingSeconds: 0,
    }
  }

  getSnapshot = (): ReaderSlideshowSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  play(): void {
    if (this.#snapshot.state === "playing") return
    this.#replace({ state: "playing" })
    this.#restartCountdown()
  }

  pause(): void {
    if (this.#snapshot.state !== "playing") return
    this.#cancelTimer()
    this.#replace({ state: "paused" })
  }

  stop(): void {
    if (this.#snapshot.state === "stopped" && this.#snapshot.remainingSeconds === 0) return
    this.#cancelTimer()
    this.#replace({ state: "stopped", remainingSeconds: 0 })
  }

  toggle(): void {
    if (this.#snapshot.state === "playing") this.pause()
    else this.play()
  }

  setInterval(seconds: number): void {
    this.configure({ intervalSeconds: seconds })
  }

  setLoop(loop: boolean): void {
    this.configure({ loop })
  }

  setRandom(random: boolean): void {
    this.configure({ random })
  }

  configure(config: Partial<ReaderSlideshowConfig>): void {
    const patch: Partial<ReaderSlideshowSnapshot> = {}
    if (config.intervalSeconds !== undefined) {
      const intervalSeconds = normalizeInterval(config.intervalSeconds)
      if (intervalSeconds !== this.#snapshot.intervalSeconds) patch.intervalSeconds = intervalSeconds
    }
    if (config.loop !== undefined && config.loop !== this.#snapshot.loop) patch.loop = config.loop
    if (config.random !== undefined && config.random !== this.#snapshot.random) patch.random = config.random
    if (!Object.keys(patch).length) return
    this.#replace(patch)
    if (patch.intervalSeconds !== undefined && this.#snapshot.state === "playing") this.#restartCountdown()
  }

  resetOnUserAction(): void {
    if (this.#snapshot.state === "playing") this.#restartCountdown()
  }

  dispose(): void {
    this.#cancelTimer()
    this.#listeners.clear()
  }

  #restartCountdown(): void {
    this.#cancelTimer()
    this.#deadline = Date.now() + this.#snapshot.intervalSeconds * 1000
    this.#replace({ remainingSeconds: this.#snapshot.intervalSeconds })
    this.#scheduleTick()
  }

  #scheduleTick(): void {
    if (this.#snapshot.state !== "playing") return
    const remainingMs = Math.max(0, this.#deadline - Date.now())
    this.#timer = setTimeout(() => this.#tick(), Math.min(1000, remainingMs))
  }

  #tick(): void {
    this.#timer = undefined
    if (this.#snapshot.state !== "playing") return
    const remainingMs = Math.max(0, this.#deadline - Date.now())
    const remainingSeconds = Math.ceil(remainingMs / 1000)
    if (remainingSeconds > 0) {
      if (remainingSeconds !== this.#snapshot.remainingSeconds) this.#replace({ remainingSeconds })
      this.#scheduleTick()
      return
    }
    this.#replace({ remainingSeconds: 0 })
    void this.#advance()
  }

  async #advance(): Promise<void> {
    const generation = this.#generation
    const position = this.#options.readPosition()
    let completed = false
    try {
      if (position.pageCount <= 0) {
        this.stop()
        return
      }
      if (this.#snapshot.random) {
        completed = await this.#options.goToPage(randomPageIndex(
          position.currentPageIndex,
          position.pageCount,
          this.#options.random?.() ?? Math.random(),
        ))
      } else if (position.atEnd) {
        if (!this.#snapshot.loop) {
          this.stop()
          return
        }
        completed = await this.#options.goToPage(0)
      } else {
        completed = await this.#options.nextPage()
      }
    } catch (error) {
      this.#options.onError?.(error)
    }
    if (generation === this.#generation && this.#snapshot.state === "playing") {
      if (!completed && this.#options.readPosition().atEnd && !this.#snapshot.loop && !this.#snapshot.random) this.stop()
      else this.#restartCountdown()
    }
  }

  #cancelTimer(): void {
    this.#generation += 1
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
  }

  #replace(patch: Partial<ReaderSlideshowSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }
}

function normalizeInterval(seconds: number): number {
  if (!Number.isFinite(seconds)) return 5
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.round(seconds)))
}

function randomPageIndex(currentPageIndex: number, pageCount: number, random: number): number {
  if (pageCount <= 1) return 0
  const bounded = Math.min(Math.max(random, 0), 1 - Number.EPSILON)
  const candidate = Math.floor(bounded * (pageCount - 1))
  return candidate >= currentPageIndex ? candidate + 1 : candidate
}
