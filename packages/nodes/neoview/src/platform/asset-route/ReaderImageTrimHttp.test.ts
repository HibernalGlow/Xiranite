import { describe, expect, it, vi } from "vitest"

import {
  applyReaderImageTrimPatch,
  DEFAULT_READER_IMAGE_TRIM,
  type ReaderImageTrimSettings,
} from "../../application/image-trim/ReaderImageTrim.js"
import type { NeoviewImageTrimPatch } from "../../application/config/ReaderRuntimeConfig.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

describe("Reader image trim HTTP", () => {
  it("[neoview.image-trim.transport-linked] [neoview.image-trim.threshold-http] [neoview.image-trim.target-http] [neoview.image-trim.reset-http] serializes validated projections against the latest committed state", async () => {
    let committed: ReaderImageTrimSettings = {
      ...DEFAULT_READER_IMAGE_TRIM,
      top: 10,
      bottom: 20,
      left: 5,
      right: 15,
    }
    let releaseFirst!: () => void
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve })
    const updateImageTrim = vi.fn(async (patch: NeoviewImageTrimPatch, _tomlPatch: Record<string, unknown>) => {
      if (updateImageTrim.mock.calls.length === 1) await firstPending
      committed = applyReaderImageTrimPatch(committed, patch.imageTrim)
      return committed
    })
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      imageTrim: committed,
      updateImageTrim,
    })
    try {
      const linkRequest = controller.handle(request({ imageTrim: { linkVertical: true, linkHorizontal: true } }))
      await vi.waitFor(() => expect(updateImageTrim).toHaveBeenCalledTimes(1))
      const edgeRequest = controller.handle(request({ imageTrim: { top: 12, left: 8 } }))
      await Promise.resolve()
      expect(updateImageTrim).toHaveBeenCalledTimes(1)

      releaseFirst()
      const [linked, edged] = await Promise.all([linkRequest, edgeRequest])
      expect(linked?.status).toBe(200)
      expect(edged?.status).toBe(200)
      expect(updateImageTrim).toHaveBeenCalledTimes(2)
      expect(updateImageTrim.mock.calls[0]?.[0].imageTrim).toMatchObject({
        top: 20,
        bottom: 20,
        left: 15,
        right: 15,
        linkVertical: true,
        linkHorizontal: true,
      })
      expect(updateImageTrim.mock.calls[1]?.[0].imageTrim).toMatchObject({
        top: 12,
        bottom: 12,
        left: 8,
        right: 8,
        linkVertical: true,
        linkHorizontal: true,
      })
      await expect(edged!.json()).resolves.toMatchObject({ imageTrim: committed })

      const invalid = await controller.handle(request({ imageTrim: { top: 46 } }))
      expect(invalid?.status).toBe(400)
      expect(updateImageTrim).toHaveBeenCalledTimes(2)

      const invalidOptions = await controller.handle(request({ imageTrim: { autoTrimThreshold: 12, autoTrimTarget: "gray" } }))
      expect(invalidOptions?.status).toBe(400)
      expect(updateImageTrim).toHaveBeenCalledTimes(2)

      const options = await controller.handle(request({ imageTrim: { autoTrimThreshold: 45, autoTrimTarget: "white" } }))
      expect(options?.status).toBe(200)
      expect(updateImageTrim).toHaveBeenCalledTimes(3)
      await expect(options!.json()).resolves.toMatchObject({ imageTrim: { autoTrimThreshold: 45, autoTrimTarget: "white" } })

      const reset = await controller.handle(request({ imageTrim: { reset: "defaults" } }))
      expect(reset?.status).toBe(200)
      expect(updateImageTrim).toHaveBeenCalledTimes(4)
      await expect(reset!.json()).resolves.toMatchObject({ imageTrim: DEFAULT_READER_IMAGE_TRIM })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function request(body: unknown): Request {
  return new Request("http://127.0.0.1:41000/reader/config", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-xiranite-token": "reader-token" },
    body: JSON.stringify(body),
  })
}
