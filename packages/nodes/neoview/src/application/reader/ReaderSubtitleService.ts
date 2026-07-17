import type { ReaderSubtitleAsset } from "../../domain/book/book.js"
import { subtitleMatchesVideo, type ReaderSubtitleFormat } from "../../domain/subtitle/subtitle.js"
import type { ReaderSubtitleConverter, ReaderSubtitleConverterLoader } from "../../ports/ReaderSubtitleConverter.js"
import type { ReaderService, ReaderSessionId } from "./contracts.js"

const DEFAULT_MAX_SOURCE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export interface ReaderSubtitleTrack {
  id: string
  name: string
  format: ReaderSubtitleFormat
  contentVersion: string
}

export interface ReaderSubtitleServiceOptions {
  maxSourceBytes?: number
  maxOutputBytes?: number
}

export class ReaderSubtitleService {
  readonly #reader: ReaderService
  readonly #loadConverter: ReaderSubtitleConverterLoader
  readonly #maxSourceBytes: number
  readonly #maxOutputBytes: number
  #converter?: Promise<ReaderSubtitleConverter>

  constructor(
    reader: ReaderService,
    loadConverter: ReaderSubtitleConverterLoader,
    options: ReaderSubtitleServiceOptions = {},
  ) {
    this.#reader = reader
    this.#loadConverter = loadConverter
    this.#maxSourceBytes = positiveInteger(options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES, "maxSourceBytes")
    this.#maxOutputBytes = positiveInteger(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, "maxOutputBytes")
  }

  list(sessionId: ReaderSessionId, pageId: string): readonly ReaderSubtitleTrack[] {
    const { page, assets } = this.#matchedAssets(sessionId, pageId)
    return [...assets]
      .sort((left, right) => trackRank(page.name, left.name) - trackRank(page.name, right.name)
        || left.name.localeCompare(right.name))
      .map(({ id, name, format, contentVersion }) => ({ id, name, format, contentVersion }))
  }

  async render(
    sessionId: ReaderSessionId,
    pageId: string,
    assetId: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; contentVersion: string }> {
    signal?.throwIfAborted()
    const { assets } = this.#matchedAssets(sessionId, pageId)
    const asset = assets.find((candidate) => candidate.id === assetId)
    if (!asset) throw new Error("Reader subtitle track was not found for this video page.")
    if (asset.byteLength > this.#maxSourceBytes) {
      throw new Error(`Reader subtitle exceeds the ${this.#maxSourceBytes} byte source budget.`)
    }
    const source = await asset.content.load(signal)
    let stream: ReadableStream<Uint8Array> | undefined
    try {
      stream = await source.open(signal)
      const bytes = await readBounded(stream, this.#maxSourceBytes, signal)
      const converter = await this.#getConverter()
      const converted = await converter.convertToWebVtt(bytes, asset.format, signal)
      if (converted.byteLength > this.#maxOutputBytes) {
        throw new Error(`Converted WebVTT exceeds the ${this.#maxOutputBytes} byte output budget.`)
      }
      return { bytes: converted, contentVersion: asset.contentVersion }
    } finally {
      await stream?.cancel("Reader subtitle conversion finished.").catch(() => undefined)
      await source.close().catch(() => undefined)
    }
  }

  #matchedAssets(sessionId: ReaderSessionId, pageId: string): { page: { name: string; entryPath?: string }; assets: readonly ReaderSubtitleAsset[] } {
    const session = this.#reader.getSession(sessionId)
    if (!session) throw new Error("Reader session was not found.")
    const page = session.getPage(pageId)
    if (!page || page.mediaKind !== "video") throw new Error("Reader video page was not found.")
    return {
      page,
      assets: (session.book.subtitleAssets ?? []).filter((asset) => subtitleMatchesVideo(page, asset)).slice(0, 16),
    }
  }

  #getConverter(): Promise<ReaderSubtitleConverter> {
    if (!this.#converter) {
      const pending = this.#loadConverter()
      const guarded = pending.catch((error) => {
        if (this.#converter === guarded) this.#converter = undefined
        throw error
      })
      this.#converter = guarded
    }
    return this.#converter
  }
}

async function readBounded(stream: ReadableStream<Uint8Array>, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      signal?.throwIfAborted()
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > maxBytes) throw new Error(`Reader subtitle emitted more than the ${maxBytes} byte source budget.`)
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel("Reader subtitle bytes collected.").catch(() => undefined)
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function trackRank(videoName: string, subtitleName: string): number {
  const videoStem = videoName.replace(/\.[^.]+$/, "").toLowerCase()
  const subtitleStem = subtitleName.replace(/\.[^.]+$/, "").toLowerCase()
  return subtitleStem === videoStem ? 0 : 1
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}
