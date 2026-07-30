import type { ReaderVideoPlaybackTarget } from "./ReaderVideoController"

interface DecodedFrame {
  readonly displayWidth?: number
  readonly displayHeight?: number
  readonly timestamp?: number
  readonly duration?: number | null
  close(): void
}

interface FrameTiming {
  readonly timestampMs?: number
  readonly durationMs: number
}

interface ImageDecoderLike {
  readonly completed: Promise<void>
  readonly tracks: {
    readonly ready: Promise<void>
    readonly selectedTrack?: { readonly frameCount?: number }
  }
  decode(options: { frameIndex: number }): Promise<{ image: DecodedFrame }>
  close(): void
}

interface ImageDecoderConstructor {
  new(options: { data: ReadableStream<Uint8Array>; type: string; preferAnimation: boolean }): ImageDecoderLike
  isTypeSupported?(type: string): Promise<boolean>
}

export type AnimatedImagePlaybackLoadResult = "ready" | "static" | "unsupported"

export class ReaderAnimatedImagePlayback implements ReaderVideoPlaybackTarget {
  readonly supportsSeeking = true

  #decoder: ImageDecoderLike | undefined
  #frameCount = 0
  #frameIndex = 0
  #frameDurationMs = 100
  #frameElapsedMs = 0
  #currentTime = 0
  #duration = 0
  #paused = true
  #ended = false
  #volume = 1
  #muted = false
  #playbackRate = 1
  #loop = false
  #lastTick = 0
  #frameRequest: number | undefined
  #decoding = false
  #generation = 0
  #seekRevision = 0
  #decoderQueue: Promise<unknown> = Promise.resolve()
  readonly #frameTimings = new Map<number, FrameTiming>()
  readonly #listeners = new Set<() => void>()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  get paused(): boolean { return this.#paused }
  get ended(): boolean { return this.#ended }
  get currentTime(): number { return this.#currentTime }
  set currentTime(value: number) { this.#requestSeek(value) }
  get duration(): number { return this.#duration }
  get volume(): number { return this.#volume }
  set volume(value: number) { this.#volume = clamp(value, 0, 1) }
  get muted(): boolean { return this.#muted }
  set muted(value: boolean) { this.#muted = value }
  get playbackRate(): number { return this.#playbackRate }
  set playbackRate(value: number) { this.#playbackRate = Math.max(0.05, value) }
  get loop(): boolean { return this.#loop }
  set loop(value: boolean) { this.#loop = value }

  subscribe(listener: () => void, _onEnded: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async load(url: string, signal?: AbortSignal): Promise<AnimatedImagePlaybackLoadResult> {
    const generation = ++this.#generation
    this.#reset()
    const Decoder = imageDecoderConstructor()
    if (!Decoder) return "unsupported"

    const response = await fetch(url, { signal })
    if (!response.ok || !response.body) throw new Error(`Unable to read animated image: HTTP ${response.status}`)
    const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? ""
    if (!type.startsWith("image/")) return "unsupported"
    if (Decoder.isTypeSupported && !await Decoder.isTypeSupported(type)) return "unsupported"

    const decoder = new Decoder({ data: response.body, type, preferAnimation: true })
    try {
      await decoder.tracks.ready
      let frameCount = decoder.tracks.selectedTrack?.frameCount
      if (frameCount === undefined) {
        await decoder.completed
        frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1
      }
      if (generation !== this.#generation) {
        decoder.close()
        return "unsupported"
      }
      if (frameCount < 2) {
        decoder.close()
        return "static"
      }

      this.#decoder = decoder
      this.#frameCount = frameCount
      const firstTiming = await this.#drawFrame(0, generation)
      if (generation !== this.#generation) return "unsupported"
      const lastTiming = frameCount > 1
        ? await this.#readFrameTiming(frameCount - 1, generation)
        : firstTiming
      if (generation !== this.#generation) return "unsupported"
      this.#duration = durationFromTimings(frameCount, firstTiming, lastTiming)
      this.#paused = false
      this.#publish()
      this.#schedule()
      return "ready"
    } catch (error) {
      decoder.close()
      throw error
    }
  }

  play(): Promise<void> {
    if (!this.#decoder) return Promise.resolve()
    if (this.#ended) {
      this.#ended = false
      this.#requestSeek(0)
    }
    this.#paused = false
    this.#lastTick = 0
    this.#publish()
    this.#schedule()
    return Promise.resolve()
  }

  pause(): void {
    if (this.#paused) return
    this.#paused = true
    this.#stop()
    this.#lastTick = 0
    this.#publish()
  }

  dispose(): void {
    this.#generation += 1
    this.#reset()
    this.#listeners.clear()
  }

  #reset(): void {
    this.#stop()
    this.#decoder?.close()
    this.#decoder = undefined
    this.#frameCount = 0
    this.#frameIndex = 0
    this.#frameDurationMs = 100
    this.#frameElapsedMs = 0
    this.#currentTime = 0
    this.#duration = 0
    this.#paused = true
    this.#ended = false
    this.#decoding = false
    this.#lastTick = 0
    this.#seekRevision += 1
    this.#frameTimings.clear()
    const context = this.canvas.getContext("2d")
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  #schedule(): void {
    if (this.#paused || this.#decoding || this.#frameRequest !== undefined) return
    this.#frameRequest = requestAnimationFrame((timestamp) => this.#tick(timestamp))
  }

  #stop(): void {
    if (this.#frameRequest !== undefined) cancelAnimationFrame(this.#frameRequest)
    this.#frameRequest = undefined
  }

  #tick(timestamp: number): void {
    this.#frameRequest = undefined
    if (this.#paused || !this.#decoder || this.#decoding) return
    if (this.#lastTick === 0) this.#lastTick = timestamp
    const elapsed = Math.max(0, timestamp - this.#lastTick)
    this.#lastTick = timestamp
    this.#frameElapsedMs += elapsed * this.#playbackRate
    this.#currentTime = Math.min(this.#duration, this.#currentTime + elapsed * this.#playbackRate / 1_000)
    if (this.#frameElapsedMs < this.#frameDurationMs) {
      this.#schedule()
      return
    }

    this.#frameElapsedMs %= this.#frameDurationMs
    const next = this.#frameIndex + 1
    if (next >= this.#frameCount && !this.#loop) {
      this.#paused = true
      this.#ended = true
      this.#currentTime = this.#duration
      this.#publish()
      return
    }
    const seekRevision = this.#seekRevision
    this.#decoding = true
    void this.#drawFrame(
      next % this.#frameCount,
      this.#generation,
      () => seekRevision === this.#seekRevision,
    ).then((timing) => {
      if (seekRevision !== this.#seekRevision) return
      this.#decoding = false
      if (timing?.timestampMs !== undefined) {
        this.#currentTime = Math.min(this.#duration, (timing.timestampMs + this.#frameElapsedMs) / 1_000)
      } else if (next >= this.#frameCount) {
        this.#currentTime = this.#frameElapsedMs / 1_000
      }
      this.#publish()
      this.#schedule()
    }).catch((error) => this.#fail(error))
  }

  async #drawFrame(
    index: number,
    generation: number,
    isCurrent: () => boolean = () => true,
  ): Promise<FrameTiming | undefined> {
    return this.#withDecodedFrame(index, generation, isCurrent, (image) => {
      const timing = this.#rememberFrameTiming(index, image)
      const width = Math.max(1, image.displayWidth ?? this.canvas.width ?? 1)
      const height = Math.max(1, image.displayHeight ?? this.canvas.height ?? 1)
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width
        this.canvas.height = height
      }
      const context = this.canvas.getContext("2d")
      if (!context) throw new Error("Animated image canvas is unavailable.")
      context.clearRect(0, 0, width, height)
      context.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height)
      this.#frameIndex = index
      this.#frameDurationMs = timing.durationMs
      return timing
    })
  }

  async #readFrameTiming(index: number, generation: number): Promise<FrameTiming | undefined> {
    const cached = this.#frameTimings.get(index)
    if (cached) return cached
    return this.#withDecodedFrame(index, generation, () => true, (image) => this.#rememberFrameTiming(index, image))
  }

  async #withDecodedFrame<T>(
    index: number,
    generation: number,
    isCurrent: () => boolean,
    consume: (image: DecodedFrame) => T,
  ): Promise<T | undefined> {
    const decoder = this.#decoder
    if (!decoder) return
    const operation = async (): Promise<T | undefined> => {
      if (generation !== this.#generation || this.#decoder !== decoder || !isCurrent()) return
      const { image } = await decoder.decode({ frameIndex: index })
      try {
        if (generation !== this.#generation || this.#decoder !== decoder || !isCurrent()) return
        return consume(image)
      } finally {
        image.close()
      }
    }
    const result = this.#decoderQueue.then(operation, operation)
    this.#decoderQueue = result.then(() => undefined, () => undefined)
    return result
  }

  #rememberFrameTiming(index: number, image: DecodedFrame): FrameTiming {
    const timestampMs = Number.isFinite(image.timestamp) && (image.timestamp ?? -1) >= 0
      ? image.timestamp! / 1_000
      : undefined
    const timing = {
      timestampMs,
      durationMs: Math.max(10, Math.round((image.duration ?? 100_000) / 1_000)),
    }
    this.#frameTimings.set(index, timing)
    return timing
  }

  #requestSeek(value: number): void {
    if (!this.#decoder || this.#duration <= 0 || !Number.isFinite(value)) return
    const targetTime = clamp(value, 0, this.#duration)
    const seekRevision = ++this.#seekRevision
    const generation = this.#generation
    this.#stop()
    this.#lastTick = 0
    this.#currentTime = targetTime
    this.#ended = false
    this.#decoding = true
    this.#publish()
    void this.#seekTo(targetTime, generation, seekRevision).then(() => {
      if (generation !== this.#generation || seekRevision !== this.#seekRevision) return
      this.#decoding = false
      if (targetTime >= this.#duration) {
        this.#currentTime = this.#duration
        this.#paused = true
        this.#ended = true
      }
      this.#publish()
      this.#schedule()
    }).catch((error) => {
      if (generation === this.#generation && seekRevision === this.#seekRevision) this.#fail(error)
    })
  }

  async #seekTo(targetTime: number, generation: number, seekRevision: number): Promise<void> {
    const index = await this.#frameIndexAtTime(targetTime, generation, seekRevision)
    if (generation !== this.#generation || seekRevision !== this.#seekRevision) return
    const timing = await this.#drawFrame(index, generation, () => seekRevision === this.#seekRevision)
    if (!timing || generation !== this.#generation || seekRevision !== this.#seekRevision) return
    const fallbackStartMs = this.#duration * 1_000 * index / Math.max(1, this.#frameCount)
    const frameStartMs = timing.timestampMs ?? fallbackStartMs
    this.#frameElapsedMs = clamp(targetTime * 1_000 - frameStartMs, 0, timing.durationMs)
  }

  async #frameIndexAtTime(targetTime: number, generation: number, seekRevision: number): Promise<number> {
    const lastIndex = Math.max(0, this.#frameCount - 1)
    const estimatedIndex = clamp(Math.floor(targetTime / this.#duration * this.#frameCount), 0, lastIndex)
    if (targetTime >= this.#duration) return lastIndex
    if (this.#frameTimings.get(lastIndex)?.timestampMs === undefined) return estimatedIndex

    let minimum = 0
    let maximum = lastIndex
    let match = 0
    while (minimum <= maximum) {
      if (generation !== this.#generation || seekRevision !== this.#seekRevision) return this.#frameIndex
      const candidate = Math.floor((minimum + maximum) / 2)
      const timing = await this.#readFrameTiming(candidate, generation)
      if (timing?.timestampMs === undefined) return estimatedIndex
      if (timing.timestampMs <= targetTime * 1_000) {
        match = candidate
        minimum = candidate + 1
      } else {
        maximum = candidate - 1
      }
    }
    return match
  }

  #fail(error: unknown): void {
    this.#paused = true
    this.#decoding = false
    this.#stop()
    this.#publish()
    this.onError(error)
  }

  #publish(): void {
    for (const listener of this.#listeners) listener()
  }
}

export function supportsReaderAnimatedImagePlayback(): boolean {
  return imageDecoderConstructor() !== undefined
}

function imageDecoderConstructor(): ImageDecoderConstructor | undefined {
  return (globalThis as typeof globalThis & { ImageDecoder?: ImageDecoderConstructor }).ImageDecoder
}

function durationFromTimings(
  frameCount: number,
  firstTiming: FrameTiming | undefined,
  lastTiming: FrameTiming | undefined,
): number {
  if (lastTiming?.timestampMs !== undefined) {
    return Math.max(0.01, (lastTiming.timestampMs + lastTiming.durationMs) / 1_000)
  }
  return Math.max(0.01, frameCount * (firstTiming?.durationMs ?? 100) / 1_000)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
