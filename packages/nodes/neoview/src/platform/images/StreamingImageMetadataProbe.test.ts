import { describe, expect, it, vi } from "vitest"

import type { PageContent, PageSource } from "../../domain/page/page-content.js"
import { createZipFixture, deterministicBytes } from "../../../test/fixture-builders/create-zip-fixture.js"
import { ZipArchiveProvider } from "../archives/zip/ZipArchiveProvider.js"
import { ArchivePageContent } from "../content/ArchivePageContent.js"
import { StreamingImageMetadataProbe } from "./StreamingImageMetadataProbe.js"

describe("StreamingImageMetadataProbe", () => {
  it("[neoview.image.probe-streaming] stops and cancels as soon as a chunk completes the header", async () => {
    const png = pngHeader(4096, 2048)
    const cancelled = vi.fn()
    const closed = vi.fn(async () => undefined)
    const content = chunkedContent([png.subarray(0, 8), png.subarray(8, 16), png.subarray(16), new Uint8Array(1024)], cancelled, closed)
    const metadata = await new StreamingImageMetadataProbe().probe(content, "image/png")
    expect(metadata).toEqual({ format: "png", dimensions: { width: 4096, height: 2048 }, orientation: undefined, bytesRead: 24 })
    expect(cancelled).toHaveBeenCalled()
    expect(closed).toHaveBeenCalledOnce()
  })

  it("[neoview.image.probe-budget] never retains more than the configured header budget", async () => {
    const cancelled = vi.fn()
    const closed = vi.fn(async () => undefined)
    const longJpegHeader = new Uint8Array(512)
    longJpegHeader.set([0xff, 0xd8, 0xff, 0xe1, 0x02, 0x00])
    const content = chunkedContent([longJpegHeader], cancelled, closed, false)
    const probe = new StreamingImageMetadataProbe({ maxHeaderBytes: 128 })
    await expect(probe.probe(content, "image/jpeg")).resolves.toBeUndefined()
    expect(cancelled).toHaveBeenCalled()
    expect(closed).toHaveBeenCalledOnce()
  })

  it("[neoview.image.probe-cancellation] rejects pre-cancelled work without loading a source", async () => {
    const load = vi.fn()
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    await expect(new StreamingImageMetadataProbe().probe({ load }, "image/png", controller.signal)).rejects.toThrow("cancelled")
    expect(load).not.toHaveBeenCalled()
  })

  it("[neoview.image.probe-cancellation] returns promptly and closes a source that loads after cancellation", async () => {
    const controller = new AbortController()
    const lateSource = Promise.withResolvers<PageSource>()
    const close = vi.fn(async () => undefined)
    const content: PageContent = {
      load: () => lateSource.promise,
    }
    const pending = new StreamingImageMetadataProbe().probe(content, "image/png", controller.signal)
    controller.abort(new Error("cancelled while loading"))
    await expect(pending).rejects.toThrow("cancelled while loading")
    lateSource.resolve({
      byteLength: 24,
      rangeSupported: false,
      open: vi.fn(),
      close,
      [Symbol.asyncDispose]: close,
    })
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it("[neoview.image.probe-cancellation] returns promptly and cancels a stream that opens after cancellation", async () => {
    const controller = new AbortController()
    const lateStream = Promise.withResolvers<ReadableStream<Uint8Array>>()
    const cancel = vi.fn()
    const close = vi.fn(async () => undefined)
    const open = vi.fn(() => lateStream.promise)
    const content: PageContent = {
      async load(): Promise<PageSource> {
        return {
          byteLength: 24,
          rangeSupported: false,
          open,
          close,
          [Symbol.asyncDispose]: close,
        }
      },
    }
    const pending = new StreamingImageMetadataProbe().probe(content, "image/png", controller.signal)
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    controller.abort(new Error("cancelled while opening"))
    await expect(pending).rejects.toThrow("cancelled while opening")
    expect(close).toHaveBeenCalledOnce()
    lateStream.resolve(new ReadableStream<Uint8Array>({ cancel }))
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it("[neoview.image.probe-cancellation] cancels a stalled read immediately and still closes its source", async () => {
    const controller = new AbortController()
    const cancelled = vi.fn()
    const closed = vi.fn(async () => undefined)
    let markOpened: (() => void) | undefined
    const opened = new Promise<void>((resolve) => { markOpened = resolve })
    const content: PageContent = {
      async load(): Promise<PageSource> {
        return {
          byteLength: 24,
          rangeSupported: false,
          async open() {
            return new ReadableStream<Uint8Array>({
              start() { markOpened?.() },
              cancel: cancelled,
            })
          },
          close: closed,
          [Symbol.asyncDispose]: closed,
        }
      },
    }
    const pending = new StreamingImageMetadataProbe().probe(content, "image/png", controller.signal)
    await opened
    controller.abort(new Error("cancelled while reading"))
    await expect(pending).rejects.toThrow("cancelled while reading")
    expect(cancelled).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
  })

  it("[neoview.image.probe-error-priority] returns discovered metadata despite reader and source cleanup failures", async () => {
    const png = pngHeader(640, 480)
    const cancel = vi.fn(async () => { throw new Error("reader cleanup failed") })
    const close = vi.fn(async () => { throw new Error("source cleanup failed") })
    const content: PageContent = {
      async load(): Promise<PageSource> {
        return {
          byteLength: png.byteLength,
          rangeSupported: false,
          async open() {
            return new ReadableStream<Uint8Array>({
              start(controller) { controller.enqueue(png) },
              cancel,
            })
          },
          close,
          [Symbol.asyncDispose]: close,
        }
      },
    }
    await expect(new StreamingImageMetadataProbe().probe(content, "image/png")).resolves.toMatchObject({
      dimensions: { width: 640, height: 480 },
      bytesRead: 24,
    })
    expect(cancel).toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.image.probe-cancellation] closes a loaded source when cancellation wins before open", async () => {
    const controller = new AbortController()
    const open = vi.fn()
    const close = vi.fn(async () => undefined)
    const content: PageContent = {
      async load(): Promise<PageSource> {
        controller.abort(new Error("cancelled before open"))
        return {
          byteLength: 24,
          rangeSupported: false,
          open,
          close,
          [Symbol.asyncDispose]: close,
        }
      },
    }
    await expect(new StreamingImageMetadataProbe().probe(content, "image/png", controller.signal)).rejects.toThrow("cancelled before open")
    expect(open).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.image.probe-fallback] leaves unsupported headers to the downstream decoder", async () => {
    const cancelled = vi.fn()
    const closed = vi.fn(async () => undefined)
    const content = chunkedContent([new TextEncoder().encode("<svg></svg>  ")], cancelled, closed)
    await expect(new StreamingImageMetadataProbe().probe(content, "image/svg+xml")).resolves.toBeUndefined()
    expect(cancelled).not.toHaveBeenCalled()
    expect(closed).toHaveBeenCalledOnce()
  })

  it("[neoview.image.probe-jxl] resolves a raw JXL codestream from its bounded header", async () => {
    const cancelled = vi.fn()
    const closed = vi.fn(async () => undefined)
    const content = chunkedContent([
      Uint8Array.of(0xff, 0x0a),
      Uint8Array.of(0x7a, 0x43, 0x1d, 0x00, 0x15, 0x88),
      new Uint8Array(1024),
    ], cancelled, closed)
    await expect(new StreamingImageMetadataProbe().probe(content, "image/jxl")).resolves.toEqual({
      format: "jxl",
      dimensions: { width: 3840, height: 2160 },
      orientation: undefined,
      bytesRead: 8,
    })
    expect(cancelled).toHaveBeenCalled()
    expect(closed).toHaveBeenCalledOnce()
  })

  it("[neoview.image.probe-jxl-container] leaves container dimensions unknown without reading the full box", async () => {
    const cancelled = vi.fn()
    const closed = vi.fn(async () => undefined)
    const content = chunkedContent([
      Uint8Array.of(0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a),
      new Uint8Array(1024 * 1024),
    ], cancelled, closed)
    await expect(new StreamingImageMetadataProbe().probe(content, "image/jxl")).resolves.toBeUndefined()
    expect(cancelled).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
  })

  it("[neoview.image.probe-archive] cancels a large stored ZIP entry after its bounded header", async () => {
    const payload = deterministicBytes(1024 * 1024)
    payload.set(pngHeader(3000, 2000), 0)
    const fixture = await createZipFixture({ entries: [{ path: "page.png", bytes: payload, level: 0 }] })
    let sourceBytesRead = 0
    const provider = new ZipArchiveProvider(fixture.path, {
      onRead: (_offset, _length, bytesRead) => {
        sourceBytesRead += bytesRead
      },
    })
    try {
      const entry = (await provider.list())[0]!
      const content = new ArchivePageContent(provider, entry.id, entry.uncompressedSize, "image/png")
      const metadata = await new StreamingImageMetadataProbe().probe(content, "image/png")
      expect(metadata).toMatchObject({ dimensions: { width: 3000, height: 2000 } })
      expect(metadata!.bytesRead).toBeLessThanOrEqual(64 * 1024)
      expect(sourceBytesRead).toBeLessThan(256 * 1024)
    } finally {
      await provider.close()
      await fixture.cleanup()
    }
  })
})

function chunkedContent(
  chunks: Uint8Array[],
  cancelled: ReturnType<typeof vi.fn>,
  closed: () => Promise<void>,
  closeWhenEmpty = true,
): PageContent {
  return {
    async load(): Promise<PageSource> {
      return {
        byteLength: chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
        contentType: "image/test",
        rangeSupported: false,
        async open() {
          let index = 0
          return new ReadableStream<Uint8Array>({
            pull(controller) {
              const chunk = chunks[index++]
              if (chunk) controller.enqueue(chunk)
              else if (closeWhenEmpty) controller.close()
            },
            cancel: cancelled,
          })
        },
        close: closed,
        [Symbol.asyncDispose]: closed,
      }
    },
  }
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  bytes[16] = (width >>> 24) & 0xff
  bytes[17] = (width >>> 16) & 0xff
  bytes[18] = (width >>> 8) & 0xff
  bytes[19] = width & 0xff
  bytes[20] = (height >>> 24) & 0xff
  bytes[21] = (height >>> 16) & 0xff
  bytes[22] = (height >>> 8) & 0xff
  bytes[23] = height & 0xff
  return bytes
}
