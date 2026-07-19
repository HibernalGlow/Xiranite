import { describe, expect, it, vi } from "vitest"

import type { NeoviewMediaProgressTuiPort } from "../interaction.js"
import { createNeoviewMediaProgressTuiDefinition } from "../interaction.js"

describe("NeoView media-progress terminal interaction", () => {
  it("[neoview.media-progress.tui] reuses the current video progress controller and disposes it after each action", async () => {
    const dispose = vi.fn(async () => undefined)
    const open = vi.fn(async () => readerSnapshot())
    const getMediaProgress = vi.fn(async () => undefined)
    const updateMediaProgress = vi.fn(async (update, options) => ({
      bookId: "video-book",
      ...update,
      updatedAt: 10,
      flush: options?.flush,
    }))
    const controller = { open, getMediaProgress, updateMediaProgress, [Symbol.asyncDispose]: dispose } as NeoviewMediaProgressTuiPort
    const definition = createNeoviewMediaProgressTuiDefinition("en", async () => controller)

    await expect(definition.run({ action: "get", path: "D:/videos/clip.mp4" }, () => undefined)).resolves.toMatchObject({
      success: true,
      progress: undefined,
    })
    await expect(definition.run({
      action: "set",
      path: "D:/videos/clip.mp4",
      position: 12.5,
      duration: 30,
      completed: false,
      flush: false,
    }, () => undefined)).resolves.toMatchObject({
      success: true,
      progress: { position: 12.5, duration: 30, completed: false },
    })

    expect(updateMediaProgress).toHaveBeenCalledWith({ position: 12.5, duration: 30, completed: false }, { flush: false })
    expect(open).toHaveBeenCalledWith({ path: "D:/videos/clip.mp4", archivePasswords: undefined })
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it("[neoview.media-progress.tui-schema] projects controls without duplicating service validation", async () => {
    const schema = createNeoviewMediaProgressTuiDefinition("en", async () => { throw new Error("unused") }).schema
    const input = schema.toInput({
      action: "set",
      path: " D:/videos/clip.mp4 ",
      position: "12.5",
      duration: "30",
      completed: false,
      flush: true,
    })
    expect(input).toEqual({
      action: "set",
      path: "D:/videos/clip.mp4",
      position: 12.5,
      duration: 30,
      completed: false,
      flush: true,
    })
    expect(schema.validate({}, input)).toBeNull()
    expect(schema.validate({}, { action: "get", path: "" })).toContain("Enter a video path")
    expect(schema.isDangerous(input)).toBe(false)
  })

  it("[neoview.media-progress.tui-service-validation] returns controller validation errors without a parallel validator", async () => {
    const controller = {
      open: vi.fn(async () => readerSnapshot()),
      getMediaProgress: vi.fn(async () => undefined),
      updateMediaProgress: vi.fn(async () => { throw new Error("Media position cannot exceed duration.") }),
      [Symbol.asyncDispose]: vi.fn(async () => undefined),
    } as NeoviewMediaProgressTuiPort
    const definition = createNeoviewMediaProgressTuiDefinition("en", async () => controller)

    await expect(definition.run({
      action: "set",
      path: "D:/videos/clip.mp4",
      position: 31,
      duration: 30,
      completed: false,
    }, () => undefined)).resolves.toMatchObject({
      success: false,
      message: "Media position cannot exceed duration.",
    })
  })
})

function readerSnapshot() {
  return {
    book: { displayName: "clip.mp4", pageCount: 1 },
    frame: {
      generation: 0,
      anchorPageIndex: 0,
      direction: "left-to-right" as const,
      layout: { pageMode: "single" as const, panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "page-1", pageIndex: 0, side: "single" as const }],
      pageCount: 1,
      atStart: true,
      atEnd: true,
    },
    visiblePages: [{ id: "page-1", index: 0, name: "clip.mp4", mediaKind: "video" as const, contentVersion: "v1" }],
  }
}
