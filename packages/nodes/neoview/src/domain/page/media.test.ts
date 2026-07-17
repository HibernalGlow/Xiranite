import { describe, expect, it } from "vitest"

import {
  DEFAULT_READER_MEDIA_FORMAT_REGISTRY,
  ReaderMediaFormatRegistry,
  pageMediaType,
} from "./media.js"

describe("ReaderMediaFormatRegistry", () => {
  it("[neoview.media.format-registry] preserves the default image, video and NOV aliases", () => {
    expect(DEFAULT_READER_MEDIA_FORMAT_REGISTRY.resolve("cover.JXL")).toEqual({ kind: "image", mimeType: "image/jxl" })
    expect(pageMediaType("animation.gif")).toEqual({ kind: "animated-image", mimeType: "image/gif" })
    expect(pageMediaType("clip.nov")).toEqual({ kind: "video", mimeType: "video/mp4" })
  })

  it("[neoview.media.format-registry-custom] normalizes explicit custom aliases without guessing MIME", () => {
    const registry = new ReaderMediaFormatRegistry({
      supportedImageFormats: [".JPG", "comic-image", "jpg"],
      videoFormats: ["comic-video"],
      mediaMimeTypes: { "comic-image": "image/webp", "comic-video": "video/mp4" },
    })
    expect(registry.supportedImageFormats).toEqual(["jpg", "comic-image"])
    expect(registry.resolve("page.comic-image")).toEqual({ kind: "image", mimeType: "image/webp" })
    expect(registry.resolve("clip.comic-video")).toEqual({ kind: "video", mimeType: "video/mp4" })
    expect(registry.resolve("clip.mp4")).toBeUndefined()
  })

  it("rejects ambiguous, orphaned and media-kind-mismatched declarations", () => {
    expect(() => new ReaderMediaFormatRegistry({ supportedImageFormats: ["custom"] })).toThrow("explicit image/* MIME")
    expect(() => new ReaderMediaFormatRegistry({ mediaMimeTypes: { orphan: "image/jpeg" } })).toThrow("not present")
    expect(() => new ReaderMediaFormatRegistry({
      supportedImageFormats: ["jpg"],
      videoFormats: ["jpg"],
    })).toThrow("both image and video")
    expect(() => new ReaderMediaFormatRegistry({
      supportedImageFormats: ["custom"],
      mediaMimeTypes: { custom: "video/mp4" },
    })).toThrow("image/*")
  })
})
