import { describe, expect, it, vi } from "vitest"

import type { ImageTransformRequest } from "../../domain/image/image-transform.js"
import type { ImageTransformer } from "../../ports/ImageTransformer.js"
import { WindowsWicImageTransformer } from "./WindowsWicImageTransformer.js"

const REQUEST: ImageTransformRequest = {
  width: 416,
  dpr: 1,
  fit: "inside",
  format: "webp",
  quality: 82,
}
const WEBP = Uint8Array.of(0x52, 0x49, 0x46, 0x46)

describe("WindowsWicImageTransformer", () => {
  it("[neoview.image.wic-bypass] replays ordinary formats to sharp without loading WIC", async () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    const fallback = vi.fn(async (input: ReadableStream<Uint8Array>) => ({
      contentType: "image/webp",
      stream: byteStream(await readAll(input)),
    }))
    const loadWic = vi.fn()
    const transformer = new WindowsWicImageTransformer({ transform: fallback } as ImageTransformer, { loadWic })

    const result = await transformer.transform(chunkStream(png, 3), REQUEST)

    expect(await readAll(result.stream)).toEqual(png)
    expect(fallback).toHaveBeenCalledOnce()
    expect(loadWic).not.toHaveBeenCalled()
  })

  it("[neoview.image.wic-avif] decodes and encodes AVIF inside the native WIC path", async () => {
    const avif = isoBrand("avif")
    const release = vi.fn()
    const createWicImageThumbnailEncoded = vi.fn(async () => encoded())
    const transformer = new WindowsWicImageTransformer(unusedFallback(), {
      resourceScheduler: { acquire: vi.fn(async () => ({ release })) },
      loadWic: async () => ({ createWicImageThumbnailEncoded }),
    })

    const result = await transformer.transform(byteStream(avif), REQUEST)

    expect(await readAll(result.stream)).toEqual(WEBP)
    expect(createWicImageThumbnailEncoded).toHaveBeenCalledWith({
      data: avif,
      maxDimension: 416,
      format: "webp",
      lossless: false,
      quality: 82,
    })
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.image.wic-shared-lease] reuses but never releases an externally owned CPU lease", async () => {
    const acquire = vi.fn()
    const release = vi.fn()
    const transformer = new WindowsWicImageTransformer(unusedFallback(), {
      resourceScheduler: { acquire },
      loadWic: async () => ({ createWicImageThumbnailEncoded: async () => encoded() }),
    })

    const result = await transformer.transform(byteStream(isoBrand("avif")), REQUEST, undefined, {
      resourceLease: { release },
    })
    expect(await readAll(result.stream)).toEqual(WEBP)
    expect(acquire).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })

  it("[neoview.image.wic-fit] preserves full pixels for two-dimensional crop transforms", async () => {
    const createWicImageThumbnailEncoded = vi.fn(async () => encoded())
    const transformer = new WindowsWicImageTransformer(unusedFallback(), {
      resourceScheduler: { acquire: async () => ({ release() {} }) },
      loadWic: async () => ({ createWicImageThumbnailEncoded }),
    })

    await transformer.transform(byteStream(isoBrand("avif")), { ...REQUEST, height: 320, fit: "cover" })

    expect(createWicImageThumbnailEncoded).toHaveBeenCalledWith(expect.objectContaining({ maxDimension: 0 }))
  })

  it("[neoview.image.wic-avif-fallback] releases the WIC lease before falling back to sharp", async () => {
    const avif = isoBrand("avis")
    const release = vi.fn()
    const fallback = vi.fn(async (input: ReadableStream<Uint8Array>) => {
      expect(release).toHaveBeenCalledOnce()
      return { contentType: "image/webp", stream: byteStream(await readAll(input)) }
    })
    const transformer = new WindowsWicImageTransformer({ transform: fallback } as ImageTransformer, {
      resourceScheduler: { acquire: async () => ({ release }) },
      loadWic: async () => ({ createWicImageThumbnailEncoded: async () => { throw new Error("codec missing") } }),
    })

    const result = await transformer.transform(chunkStream(avif, 5), REQUEST)

    expect(await readAll(result.stream)).toEqual(avif)
    expect(fallback).toHaveBeenCalledOnce()
  })

  it.each([
    Uint8Array.of(0xff, 0x0a, 1, 2, 3),
    Uint8Array.of(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a),
  ])("[neoview.image.wic-jxl-fallback] releases the WIC lease and replays JXL to custom sharp", async (jxl) => {
    const release = vi.fn()
    const fallback = vi.fn(async (input: ReadableStream<Uint8Array>) => {
      expect(release).toHaveBeenCalledOnce()
      return { contentType: "image/webp", stream: byteStream(await readAll(input)) }
    })
    const transformer = new WindowsWicImageTransformer({ transform: fallback } as ImageTransformer, {
      resourceScheduler: { acquire: async () => ({ release }) },
      loadWic: async () => ({ createWicImageThumbnailEncoded: async () => { throw new Error("codec missing") } }),
    })

    const result = await transformer.transform(byteStream(jxl), REQUEST)
    expect(await readAll(result.stream)).toEqual(jxl)
    expect(fallback).toHaveBeenCalledOnce()
  })
})

function isoBrand(brand: "avif" | "avis"): Uint8Array {
  return Uint8Array.of(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, ...new TextEncoder().encode(brand), 0, 0, 0, 0)
}

function encoded() {
  return { data: WEBP, width: 1, height: 1, mimeType: "image/webp" }
}

function unusedFallback(): ImageTransformer {
  return { transform: vi.fn(async () => { throw new Error("unexpected fallback") }) }
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return chunkStream(bytes, bytes.byteLength || 1)
}

function chunkStream(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) { controller.close(); return }
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) { chunks.push(chunk); total += chunk.byteLength }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}
