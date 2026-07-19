import { describe, expect, it, vi } from "vitest"

import type { ReaderBook, ReaderSubtitleAsset } from "../../domain/book/book.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderSubtitleConverter } from "../../ports/ReaderSubtitleConverter.js"
import { CoreReaderService } from "./ReaderService.js"
import { ReaderSubtitleService } from "./ReaderSubtitleService.js"

describe("ReaderSubtitleService", () => {
  it("[neoview.subtitle.service] matches exact and language tracks without loading the converter during discovery", async () => {
    const loadConverter = vi.fn(async (): Promise<ReaderSubtitleConverter> => ({
      async convertToWebVtt(bytes) { return bytes },
    }))
    const reader = new CoreReaderService(async () => subtitleBook([
      subtitle("clip.zh-CN.srt"),
      subtitle("clip.srt"),
      subtitle("other.srt"),
    ]))
    const session = await reader.openViewSource({ kind: "media", path: "C:/clip.mp4" })
    const service = new ReaderSubtitleService(reader, loadConverter)

    expect(service.list(session.id, "video-1").map((track) => track.name)).toEqual(["clip.srt", "clip.zh-CN.srt"])
    expect(loadConverter).not.toHaveBeenCalled()
    await reader[Symbol.asyncDispose]()
  })

  it("[neoview.subtitle.cancellation] cancels the source stream and closes it when GUI demand leaves", async () => {
    const sourceClosed = vi.fn(async () => undefined)
    const streamCancelled = vi.fn()
    const source: PageSource = {
      byteLength: 4,
      contentType: "text/plain",
      rangeSupported: false,
      async open(signal) {
        return new ReadableStream<Uint8Array>({
          pull() {
            signal?.throwIfAborted()
          },
          cancel: streamCancelled,
        })
      },
      close: sourceClosed,
      [Symbol.asyncDispose]: sourceClosed,
    }
    const reader = new CoreReaderService(async () => subtitleBook([subtitle("clip.srt", source)]))
    const session = await reader.openViewSource({ kind: "media", path: "C:/clip.mp4" })
    const service = new ReaderSubtitleService(reader, async () => ({ async convertToWebVtt(bytes) { return bytes } }))
    const controller = new AbortController()
    const rendering = service.render(session.id, "video-1", "subtitle-clip.srt", controller.signal)
    controller.abort(new DOMException("page changed", "AbortError"))

    await expect(rendering).rejects.toMatchObject({ name: "AbortError" })
    expect(streamCancelled).toHaveBeenCalled()
    expect(sourceClosed).toHaveBeenCalledOnce()
    await reader[Symbol.asyncDispose]()
  })

  it("[neoview.subtitle.cancellation] interrupts a non-cooperative pending read within a bounded time", async () => {
    const sourceClosed = vi.fn(async () => undefined)
    const streamCancelled = vi.fn()
    let resolvePullStarted!: () => void
    const pullStarted = new Promise<void>((resolve) => { resolvePullStarted = resolve })
    const source: PageSource = {
      byteLength: 4,
      contentType: "text/plain",
      rangeSupported: false,
      async open() {
        return new ReadableStream<Uint8Array>({
          pull() {
            resolvePullStarted()
          },
          cancel: streamCancelled,
        })
      },
      close: sourceClosed,
      [Symbol.asyncDispose]: sourceClosed,
    }
    const reader = new CoreReaderService(async () => subtitleBook([subtitle("clip.srt", source)]))
    const session = await reader.openViewSource({ kind: "media", path: "C:/clip.mp4" })
    const service = new ReaderSubtitleService(reader, async () => ({ async convertToWebVtt(bytes) { return bytes } }))
    const controller = new AbortController()
    const reason = new DOMException("page changed", "AbortError")
    const rendering = service.render(session.id, "video-1", "subtitle-clip.srt", controller.signal)

    await withTimeout(pullStarted, 500)
    controller.abort(reason)

    await expect(withTimeout(rendering, 500)).rejects.toBe(reason)
    expect(streamCancelled).toHaveBeenCalledOnce()
    expect(sourceClosed).toHaveBeenCalledOnce()
    await reader[Symbol.asyncDispose]()
  })

  it("[neoview.subtitle.byte-budget] rejects oversized tracks before opening their content", async () => {
    const load = vi.fn()
    const asset = subtitle("clip.srt")
    asset.byteLength = 5
    asset.content = { load }
    const reader = new CoreReaderService(async () => subtitleBook([asset]))
    const session = await reader.openViewSource({ kind: "media", path: "C:/clip.mp4" })
    const service = new ReaderSubtitleService(reader, async () => ({ async convertToWebVtt(bytes) { return bytes } }), {
      maxSourceBytes: 4,
    })

    await expect(service.render(session.id, "video-1", asset.id)).rejects.toThrow("source budget")
    expect(load).not.toHaveBeenCalled()
    await reader[Symbol.asyncDispose]()
  })
})

function subtitle(name: string, source: PageSource = completedSource()): ReaderSubtitleAsset {
  return {
    id: `subtitle-${name}`,
    name,
    sourcePath: `C:/${name}`,
    format: "srt",
    byteLength: 4,
    contentVersion: "v1",
    content: { async load() { return source } },
  }
}

function completedSource(): PageSource {
  const close = vi.fn(async () => undefined)
  return {
    byteLength: 4,
    contentType: "text/plain",
    rangeSupported: false,
    async open() {
      return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("test")); controller.close() } })
    },
    close,
    [Symbol.asyncDispose]: close,
  }
}

function subtitleBook(subtitleAssets: ReaderSubtitleAsset[]): ReaderBook {
  const close = vi.fn(async () => undefined)
  return {
    id: "book-1",
    source: { kind: "media", path: "C:/clip.mp4" },
    displayName: "clip.mp4",
    pages: [{
      id: "video-1",
      index: 0,
      name: "clip.mp4",
      sourcePath: "C:/clip.mp4",
      mediaKind: "video",
      mimeType: "video/mp4",
      byteLength: 4,
      contentVersion: "v1",
      content: { async load() { throw new Error("not used") } },
    }],
    subtitleAssets,
    close,
    [Symbol.asyncDispose]: close,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Test promise timed out after ${timeoutMs} ms.`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
