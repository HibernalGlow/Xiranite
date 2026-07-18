export type ReaderVideoLoopMode = "list" | "single" | "none"

export interface ReaderVideoRuntimeConfig {
  videoMinPlaybackRate: number
  videoMaxPlaybackRate: number
  videoPlaybackRateStep: number
}

export interface ReaderVideoSnapshot {
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  playbackRate: number
  minimumPlaybackRate: number
  maximumPlaybackRate: number
  playbackRateStep: number
  loopMode: ReaderVideoLoopMode
  seekMode: boolean
  active: boolean
}

export interface ReaderVideoActionPort {
  hasActiveVideo(): boolean
  isSeekMode(): boolean
  playPause(): boolean
  seek(direction: 1 | -1): boolean
  toggleMute(): boolean
  cycleLoopMode(): boolean
  adjustVolume(direction: 1 | -1): boolean
  adjustSpeed(direction: 1 | -1): boolean
  toggleSpeed(): boolean
  toggleSeekMode(): boolean
}

interface Registration {
  element: HTMLVideoElement
  onListEnded: () => void
  ended: () => void
  sync: () => void
}

const DEFAULT_RUNTIME_CONFIG: ReaderVideoRuntimeConfig = {
  videoMinPlaybackRate: 0.25,
  videoMaxPlaybackRate: 16,
  videoPlaybackRateStep: 0.25,
}

export class ReaderVideoController implements ReaderVideoActionPort {
  #runtime = DEFAULT_RUNTIME_CONFIG
  #registrations: Registration[] = []
  #volume = 1
  #muted = false
  #playbackRate = 1
  #previousPlaybackRate = 1
  #loopMode: ReaderVideoLoopMode = "list"
  #seekMode = false
  #snapshot: ReaderVideoSnapshot = {
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    minimumPlaybackRate: DEFAULT_RUNTIME_CONFIG.videoMinPlaybackRate,
    maximumPlaybackRate: DEFAULT_RUNTIME_CONFIG.videoMaxPlaybackRate,
    playbackRateStep: DEFAULT_RUNTIME_CONFIG.videoPlaybackRateStep,
    loopMode: "list",
    seekMode: false,
    active: false,
  }
  readonly #listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): ReaderVideoSnapshot => this.#snapshot

  configure(runtime: ReaderVideoRuntimeConfig): void {
    this.#runtime = normalizeRuntime(runtime)
    this.#playbackRate = clamp(this.#playbackRate, this.#runtime.videoMinPlaybackRate, this.#runtime.videoMaxPlaybackRate)
    this.#previousPlaybackRate = clamp(this.#previousPlaybackRate, this.#runtime.videoMinPlaybackRate, this.#runtime.videoMaxPlaybackRate)
    this.#apply(this.#active())
    this.#publish()
  }

  register(element: HTMLVideoElement, onListEnded: () => void): () => void {
    const sync = () => this.#syncFrom(element)
    const registration: Registration = {
      element,
      onListEnded,
      ended: () => {
        if (this.#active() !== element || this.#loopMode !== "list") return
        onListEnded()
      },
      sync,
    }
    this.#registrations.push(registration)
    element.addEventListener("ended", registration.ended)
    for (const event of SYNC_EVENTS) element.addEventListener(event, sync)
    this.#apply(element)
    this.#publish()
    return () => {
      const index = this.#registrations.indexOf(registration)
      if (index < 0) return
      element.removeEventListener("ended", registration.ended)
      for (const event of SYNC_EVENTS) element.removeEventListener(event, sync)
      this.#registrations.splice(index, 1)
      this.#apply(this.#active())
      this.#publish()
    }
  }

  hasActiveVideo(): boolean {
    return this.#active() !== undefined
  }

  isSeekMode(): boolean {
    return this.#seekMode
  }

  playPause(): boolean {
    const element = this.#active()
    if (!element) return false
    if (element.paused) void element.play().catch(() => undefined)
    else element.pause()
    this.#publish()
    return true
  }

  seek(direction: 1 | -1): boolean {
    const element = this.#active()
    if (!element) return false
    const maximum = Number.isFinite(element.duration) ? element.duration : Number.POSITIVE_INFINITY
    element.currentTime = clamp(element.currentTime + direction * 10, 0, maximum)
    this.#publish()
    return true
  }

  seekTo(time: number): boolean {
    const element = this.#active()
    if (!element) return false
    const maximum = Number.isFinite(element.duration) ? element.duration : Number.POSITIVE_INFINITY
    element.currentTime = clamp(time, 0, maximum)
    this.#publish()
    return true
  }

  toggleMute(): boolean {
    const element = this.#active()
    if (!element) return false
    this.#muted = !this.#muted
    element.muted = this.#muted
    this.#publish()
    return true
  }

  cycleLoopMode(): boolean {
    const element = this.#active()
    if (!element) return false
    this.#loopMode = this.#loopMode === "list" ? "single" : this.#loopMode === "single" ? "none" : "list"
    element.loop = this.#loopMode === "single"
    this.#publish()
    return true
  }

  adjustVolume(direction: 1 | -1): boolean {
    const element = this.#active()
    if (!element) return false
    this.#volume = clamp(Math.round((this.#volume + direction * 0.1) * 10) / 10, 0, 1)
    this.#muted = this.#volume === 0
    element.volume = this.#volume
    element.muted = this.#muted
    this.#publish()
    return true
  }

  setVolume(volume: number): boolean {
    const element = this.#active()
    if (!element) return false
    this.#volume = clamp(volume, 0, 1)
    this.#muted = this.#volume === 0
    element.volume = this.#volume
    element.muted = this.#muted
    this.#publish()
    return true
  }

  adjustSpeed(direction: 1 | -1): boolean {
    const element = this.#active()
    if (!element) return false
    this.#playbackRate = clamp(
      this.#playbackRate + direction * this.#runtime.videoPlaybackRateStep,
      this.#runtime.videoMinPlaybackRate,
      this.#runtime.videoMaxPlaybackRate,
    )
    element.playbackRate = this.#playbackRate
    this.#publish()
    return true
  }

  setPlaybackRate(rate: number): boolean {
    const element = this.#active()
    if (!element) return false
    this.#playbackRate = clamp(rate, this.#runtime.videoMinPlaybackRate, this.#runtime.videoMaxPlaybackRate)
    element.playbackRate = this.#playbackRate
    this.#publish()
    return true
  }

  toggleSpeed(): boolean {
    const element = this.#active()
    if (!element) return false
    if (this.#playbackRate === 1) {
      this.#playbackRate = this.#previousPlaybackRate === 1 ? 1 : this.#previousPlaybackRate
    } else {
      this.#previousPlaybackRate = this.#playbackRate
      this.#playbackRate = 1
    }
    element.playbackRate = this.#playbackRate
    this.#publish()
    return true
  }

  toggleSeekMode(): boolean {
    if (!this.#active()) return false
    this.#seekMode = !this.#seekMode
    this.#publish()
    return true
  }

  dispose(): void {
    for (const registration of this.#registrations) {
      registration.element.removeEventListener("ended", registration.ended)
      for (const event of SYNC_EVENTS) registration.element.removeEventListener(event, registration.sync)
    }
    this.#registrations = []
    this.#publish()
  }

  #active(): HTMLVideoElement | undefined {
    return this.#registrations.at(-1)?.element
  }

  #apply(element: HTMLVideoElement | undefined): void {
    if (!element) return
    element.volume = this.#volume
    element.muted = this.#muted
    element.playbackRate = this.#playbackRate
    element.loop = this.#loopMode === "single"
  }

  #syncFrom(element: HTMLVideoElement): void {
    if (this.#active() !== element) return
    this.#volume = element.volume
    this.#muted = element.muted
    this.#playbackRate = element.playbackRate
    this.#publish()
  }

  #publish(): void {
    const active = this.#active()
    this.#snapshot = {
      playing: active ? !active.paused : false,
      currentTime: active?.currentTime ?? 0,
      duration: active && Number.isFinite(active.duration) ? active.duration : 0,
      volume: this.#volume,
      muted: this.#muted,
      playbackRate: this.#playbackRate,
      minimumPlaybackRate: this.#runtime.videoMinPlaybackRate,
      maximumPlaybackRate: this.#runtime.videoMaxPlaybackRate,
      playbackRateStep: this.#runtime.videoPlaybackRateStep,
      loopMode: this.#loopMode,
      seekMode: this.#seekMode,
      active: Boolean(active),
    }
    for (const listener of this.#listeners) listener()
  }
}

const SYNC_EVENTS = ["play", "pause", "timeupdate", "durationchange", "volumechange", "ratechange"] as const

function normalizeRuntime(runtime: ReaderVideoRuntimeConfig): ReaderVideoRuntimeConfig {
  const minimum = Math.max(0.05, runtime.videoMinPlaybackRate)
  const maximum = Math.max(minimum, runtime.videoMaxPlaybackRate)
  return {
    videoMinPlaybackRate: minimum,
    videoMaxPlaybackRate: maximum,
    videoPlaybackRateStep: Math.max(0.01, runtime.videoPlaybackRateStep),
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
