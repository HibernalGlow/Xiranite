import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { SharpMosaicImageComposer } from "./SharpMosaicImageComposer.js"

const PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
))

describe("SharpMosaicImageComposer", () => {
  it("[neoview.thumbnail.mosaic-sharp] creates one bounded WebP for a 2x2 preview", async () => {
    const composer = new SharpMosaicImageComposer()
    const result = await composer.compose(Array.from({ length: 4 }, () => byteStream(PNG)), {
      count: 4,
      size: 64,
      quality: 75,
    })
    expect(result.contentType).toBe("image/webp")
    expect(Buffer.from(result.bytes.subarray(0, 4)).toString("ascii")).toBe("RIFF")
    await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ width: 64, height: 64, format: "webp" })
  })
})

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
}
