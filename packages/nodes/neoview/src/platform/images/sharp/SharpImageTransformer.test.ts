import { describe, expect, it } from "vitest"

import type { ImageTransformRequest } from "../../../domain/image/image-transform.js"
import { SharpImageTransformer } from "./SharpImageTransformer.js"

const WEBP_REQUEST: ImageTransformRequest = {
  width: 1,
  height: 1,
  dpr: 1,
  fit: "inside",
  format: "webp",
  quality: 80,
}

describe("SharpImageTransformer", () => {
  it("[neoview.image.transform-sharp] incrementally resizes and transcodes through Web streams", async () => {
    const sharp = await loadSharp()
    const source = await sharp(Uint8Array.of(
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer()
    let offset = 0
    const input = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= source.byteLength) return controller.close()
        const end = Math.min(offset + 7, source.byteLength)
        controller.enqueue(source.subarray(offset, end))
        offset = end
      },
    })

    const result = await new SharpImageTransformer().transform(input, WEBP_REQUEST)
    expect(result.contentType).toBe("image/webp")
    const output = Buffer.from(await new Response(result.stream).arrayBuffer())
    await expect(sharp(output).metadata()).resolves.toMatchObject({ format: "webp", width: 1, height: 1 })
  })

  it("[neoview.image.transform-cancellation] propagates abort to an active input stream", async () => {
    let cancelled: unknown
    let emitted = false
    const input = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!emitted) {
          emitted = true
          controller.enqueue(Uint8Array.of(0x89, 0x50, 0x4e, 0x47))
        }
      },
      cancel(reason) {
        cancelled = reason
      },
    })
    const abort = new AbortController()
    const result = await new SharpImageTransformer().transform(input, WEBP_REQUEST, abort.signal)
    const reading = result.stream.getReader().read()
    abort.abort(new Error("superseded transform"))
    await expect(reading).rejects.toThrow()
    await expect.poll(() => cancelled).toBeInstanceOf(Error)
  })
})

async function loadSharp(): Promise<typeof import("sharp")> {
  const module = await import("sharp")
  return ((module as unknown as { default?: typeof import("sharp") }).default ?? module) as typeof import("sharp")
}
