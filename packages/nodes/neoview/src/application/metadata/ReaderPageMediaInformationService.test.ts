import { describe, expect, it, vi } from "vitest"

import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ReaderPageMediaMetadataProvider } from "../../ports/ReaderPageMediaMetadataProvider.js"
import { ReaderPageMediaInformationService } from "./ReaderPageMediaInformationService.js"

describe("ReaderPageMediaInformationService", () => {
  it("[neoview.image-information.image-zero-ffprobe] returns image identity without loading the video provider", async () => {
    const loadProvider = vi.fn(async () => provider())
    const service = new ReaderPageMediaInformationService(loadProvider)
    await expect(service.inspect("session-1", page({ mediaKind: "image" }))).resolves.toEqual({
      pageId: "page-1",
      contentVersion: "v1",
      mediaKind: "image",
    })
    expect(loadProvider).not.toHaveBeenCalled()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image-information.video-dedupe] deduplicates a video probe and strictly omits invalid fields", async () => {
    const inspect = vi.fn(async () => ({
      durationSeconds: 12.5,
      frameRate: 29.97,
      bitRateBps: 2_000_000,
      videoCodec: " h264 ",
      audioCodec: "",
    }))
    const service = new ReaderPageMediaInformationService(async () => provider(inspect))
    const video = page({ mediaKind: "video", sourcePath: "D:/media/clip.mp4" })
    const [left, right] = await Promise.all([
      service.inspect("session-1", video),
      service.inspect("session-1", video),
    ])
    expect(left).toEqual({
      pageId: "page-1",
      contentVersion: "v1",
      mediaKind: "video",
      durationSeconds: 12.5,
      frameRate: 29.97,
      bitRateBps: 2_000_000,
      videoCodec: "h264",
    })
    expect(right).toEqual(left)
    expect(inspect).toHaveBeenCalledOnce()
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: "D:/media/clip.mp4",
      priority: "view",
      ownerId: "reader:media-information:page-1",
    }), expect.any(AbortSignal))
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image-information.archive-video-stream] streams archive content and closes the source", async () => {
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3)) },
      cancel: cancelled,
    })
    const close = vi.fn(async () => undefined)
    const source = pageSource(stream, close)
    const inspect = vi.fn(async (request) => {
      expect(request).toMatchObject({ priority: "view" })
      expect(request.sourceStream).toBe(stream)
      return { durationSeconds: 3 }
    })
    const service = new ReaderPageMediaInformationService(async () => provider(inspect))
    const result = await service.inspect("session-archive", page({
      mediaKind: "video",
      sourcePath: "D:/books/video.cbz",
      entryPath: "clips/clip.mp4",
      content: { load: vi.fn(async () => source) },
    }))
    expect(result.durationSeconds).toBe(3)
    expect(cancelled).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image-information.video-cancel] returns promptly and closes an archive source that loads after cancellation", async () => {
    const lateSource = Promise.withResolvers<PageSource>()
    const close = vi.fn(async () => undefined)
    const load = vi.fn(() => lateSource.promise)
    const service = new ReaderPageMediaInformationService(async () => provider())
    const controller = new AbortController()
    const pending = service.inspect("session-archive", page({
      mediaKind: "video",
      entryPath: "clips/clip.mp4",
      content: { load },
    }), controller.signal)

    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    controller.abort(new DOMException("Card collapsed", "AbortError"))
    await expect(withTimeout(pending, 500)).rejects.toMatchObject({ name: "AbortError" })
    lateSource.resolve({
      byteLength: 3,
      contentType: "video/mp4",
      rangeSupported: false,
      open: vi.fn(),
      close,
      [Symbol.asyncDispose]: close,
    })
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image-information.video-cancel] returns promptly and cancels an archive stream that opens after cancellation", async () => {
    const lateStream = Promise.withResolvers<ReadableStream<Uint8Array>>()
    const streamCancelled = vi.fn()
    const sourceClosed = vi.fn(async () => undefined)
    const open = vi.fn(() => lateStream.promise)
    const service = new ReaderPageMediaInformationService(async () => provider())
    const controller = new AbortController()
    const pending = service.inspect("session-archive", page({
      mediaKind: "video",
      entryPath: "clips/clip.mp4",
      content: { load: vi.fn(async () => ({
        byteLength: 3,
        contentType: "video/mp4",
        rangeSupported: false,
        open,
        close: sourceClosed,
        [Symbol.asyncDispose]: sourceClosed,
      })) },
    }), controller.signal)

    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    controller.abort(new DOMException("Card collapsed", "AbortError"))
    await expect(withTimeout(pending, 500)).rejects.toMatchObject({ name: "AbortError" })
    expect(sourceClosed).toHaveBeenCalledOnce()
    lateStream.resolve(new ReadableStream<Uint8Array>({ cancel: streamCancelled }))
    await vi.waitFor(() => expect(streamCancelled).toHaveBeenCalledOnce())
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image-information.video-cancel] aborts the underlying probe and closes an archive source when demand ends", async () => {
    const close = vi.fn(async () => undefined)
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel: cancelled })
    const started = Promise.withResolvers<void>()
    const inspect = vi.fn((_request, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      started.resolve()
      const abort = () => reject(signal?.reason)
      signal?.addEventListener("abort", abort, { once: true })
    }))
    const service = new ReaderPageMediaInformationService(async () => provider(inspect))
    const controller = new AbortController()
    const pending = service.inspect("session-archive", page({
      mediaKind: "video",
      entryPath: "clips/clip.mp4",
      content: { load: vi.fn(async () => pageSource(stream, close)) },
    }), controller.signal)
    await started.promise
    const reason = new DOMException("Card collapsed", "AbortError")
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(cancelled).toHaveBeenCalledOnce()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image-information.session-release] aborts and drains active work before session close returns", async () => {
    const aborted = vi.fn()
    const started = Promise.withResolvers<void>()
    const inspect = vi.fn((_request, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      started.resolve()
      signal?.addEventListener("abort", () => {
        aborted()
        reject(signal.reason)
      }, { once: true })
    }))
    const service = new ReaderPageMediaInformationService(async () => provider(inspect))
    const pending = service.inspect("session-1", page({ mediaKind: "video" }))
    await started.promise
    await service.releaseSession("session-1")
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(aborted).toHaveBeenCalledOnce()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image-information.provider-load-cancel] does not wait for a stalled provider loader during dispose", async () => {
    const providerReady = Promise.withResolvers<ReaderPageMediaMetadataProvider>()
    const loadProvider = vi.fn(() => providerReady.promise)
    const service = new ReaderPageMediaInformationService(loadProvider)
    const pending = service.inspect("session-1", page({ mediaKind: "video" }))
    await vi.waitFor(() => expect(loadProvider).toHaveBeenCalledOnce())

    await expect(service[Symbol.asyncDispose]()).resolves.toBeUndefined()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })

    providerReady.resolve(provider())
    await Promise.resolve()
  })

  it("[neoview.image-information.provider-inspect-cancel] drains a non-cooperative provider inspect during session release", async () => {
    const started = Promise.withResolvers<void>()
    const inspect = vi.fn(() => {
      started.resolve()
      return new Promise<never>(() => undefined)
    })
    const service = new ReaderPageMediaInformationService(async () => provider(inspect))
    const pending = service.inspect("session-1", page({ mediaKind: "video" }))
    await started.promise

    await expect(withTimeout(service.releaseSession("session-1"), 500)).resolves.toBeUndefined()
    await expect(withTimeout(pending, 500)).rejects.toMatchObject({ name: "AbortError" })
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.image-information.video-cache-budget] bounds settled probes per session", async () => {
    const inspect = vi.fn(async () => ({ durationSeconds: 1 }))
    const service = new ReaderPageMediaInformationService(async () => provider(inspect))
    for (let index = 0; index < 65; index += 1) {
      await service.inspect("session-1", page({ id: `page-${index}`, contentVersion: `v${index}` }))
    }
    await service.inspect("session-1", page({ id: "page-0", contentVersion: "v0" }))
    await service.inspect("session-1", page({ id: "page-64", contentVersion: "v64" }))

    expect(inspect).toHaveBeenCalledTimes(66)
    await service[Symbol.asyncDispose]()
  })
})

function provider(
  inspect: ReaderPageMediaMetadataProvider["inspect"] = vi.fn(async () => ({})),
): ReaderPageMediaMetadataProvider {
  return { inspect }
}

function page(overrides: Partial<ReaderPage> = {}): ReaderPage {
  return {
    id: "page-1",
    index: 0,
    name: "clip.mp4",
    sourcePath: "D:/media/clip.mp4",
    mediaKind: "video",
    mimeType: "video/mp4",
    byteLength: 3,
    contentVersion: "v1",
    content: { load: vi.fn(async () => pageSource(new ReadableStream<Uint8Array>(), vi.fn())) },
    ...overrides,
  }
}

function pageSource(stream: ReadableStream<Uint8Array>, close: () => Promise<void>): PageSource {
  return {
    byteLength: 3,
    contentType: "video/mp4",
    rangeSupported: false,
    open: vi.fn(async () => stream),
    close,
    [Symbol.asyncDispose]: close,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Test promise timed out after ${timeoutMs} ms.`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
