export type ReaderVideoLoopMode = "list" | "single" | "none"

export interface ReaderVideoRuntimeConfig {
  videoMinPlaybackRate: number
  videoMaxPlaybackRate: number
  videoPlaybackRateStep: number
}

export interface ReaderVideoSnapshot {
  volume: number
  muted: boolean
  playbackRate: number
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

  configure(runtime: ReaderVideoRuntimeConfig): void {
    this.#runtime = normalizeRuntime(runtime)
    this.#playbackRate = clamp(this.#playbackRate, this.#runtime.videoMinPlaybackRate, this.#runtime.videoMaxPlaybackRate)
    this.#previousPlaybackRate = clamp(this.#previousPlaybackRate, this.#runtime.videoMinPlaybackRate, this.#runtime.videoMaxPlaybackRate)
    this.#apply(this.#active())
  }

  register(element: HTMLVideoElement, onListEnded: () => void): () => void {
    const registration: Registration = {
      element,
      onListEnded,
      ended: () => {
        if (this.#active() !== element || this.#loopMode !== "list") return
        onListEnded()
      },
    }
    this.#registrations.push(registration)
    element.addEventListener("ended", registration.ended)
    this.#apply(element)
    return () => {
      const index = this.#registrations.indexOf(registration)
      if (index < 0) return
      element.removeEventListener("ended", registration.ended)
      this.#registrations.splice(index, 1)
      this.#apply(this.#active())
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
    return true
  }

  seek(direction: 1 | -1): boolean {
    const element = this.#active()
    if (!element) return false
    const maximum = Number.isFinite(element.duration) ? element.duration : Number.POSITIVE_INFINITY
    element.currentTime = clamp(element.currentTime + direction * 10, 0, maximum)
    return true
  }

  toggleMute(): boolean {
    const element = this.#active()
    if (!element) return false
    this.#muted = !this.#muted
    element.muted = this.#muted
    return true
  }

  cycleLoopMode(): boolean {
    const element = this.#active()
    if (!element) return false
    this.#loopMode = this.#loopMode === "list" ? "single" : this.#loopMode === "single" ? "none" : "list"
    element.loop = this.#loopMode === "single"
    return true
  }

  adjustVolume(direction: 1 | -1): boolean {
    const element = this.#active()
    if (!element) return false
    this.#volume = clamp(Math.round((this.#volume + direction * 0.1) * 10) / 10, 0, 1)
    this.#muted = this.#volume === 0
    element.volume = this.#volume
    element.muted = this.#muted
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
    return true
  }

  toggleSeekMode(): boolean {
    if (!this.#active()) return false
    this.#seekMode = !this.#seekMode
    return true
  }

  getSnapshot(): ReaderVideoSnapshot {
    return {
      volume: this.#volume,
      muted: this.#muted,
      playbackRate: this.#playbackRate,
      loopMode: this.#loopMode,
      seekMode: this.#seekMode,
      active: this.hasActiveVideo(),
    }
  }

  dispose(): void {
    for (const registration of this.#registrations) {
      registration.element.removeEventListener("ended", registration.ended)
    }
    this.#registrations = []
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
}

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
