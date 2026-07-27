import type { ReaderVideoPlaybackTarget } from "./ReaderVideoController"

interface DecodedFrame {
  readonly displayWidth?: number
  readonly displayHeight?: number
  readonly duration?: number | null
  close(): void
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
  readonly supportsSeeking = false

  #decoder: ImageDecoderLike | undefined
  #frameCount = 0
  #frameIndex = 0
  #frameDurationMs = 100
  #frameElapsedMs = 0
  #currentTime = 0
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
  readonly #listeners = new Set<() => void>()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  get paused(): boolean { return this.#paused }
  get ended(): boolean { return this.#ended }
  get currentTime(): number { return this.#currentTime }
  set currentTime(_value: number) {}
  get duration(): number { return 0 }
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
      await this.#drawFrame(0, generation)
      if (generation !== this.#generation) return "unsupported"
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
      this.#frameIndex = 0
      this.#frameElapsedMs = 0
      this.#currentTime = 0
      void this.#drawFrame(0, this.#generation).catch((error) => this.#fail(error))
    }
    this.#paused = false
    this.#publish()
    this.#schedule()
    return Promise.resolve()
  }

  pause(): void {
    if (this.#paused) return
    this.#paused = true
    this.#stop()
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
    this.#paused = true
    this.#ended = false
    this.#decoding = false
    this.#lastTick = 0
    const context = this.canvas.getContext("2d")
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  #schedule(): void {
    if (this.#paused || this.#frameRequest !== undefined) return
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
    this.#currentTime += elapsed / 1_000
    if (this.#frameElapsedMs < this.#frameDurationMs) {
      this.#schedule()
      return
    }

    this.#frameElapsedMs %= this.#frameDurationMs
    const next = this.#frameIndex + 1
    if (next >= this.#frameCount && !this.#loop) {
      this.#paused = true
      this.#ended = true
      this.#publish()
      return
    }
    this.#decoding = true
    void this.#drawFrame(next % this.#frameCount, this.#generation).then(() => {
      this.#decoding = false
      this.#publish()
      this.#schedule()
    }).catch((error) => this.#fail(error))
  }

  async #drawFrame(index: number, generation: number): Promise<void> {
    const decoder = this.#decoder
    if (!decoder) return
    const { image } = await decoder.decode({ frameIndex: index })
    try {
      if (generation !== this.#generation) return
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
      this.#frameDurationMs = Math.max(10, Math.round((image.duration ?? 100_000) / 1_000))
    } finally {
      image.close()
    }
  }

  #fail(error: unknown): void {
    this.#paused = true
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
