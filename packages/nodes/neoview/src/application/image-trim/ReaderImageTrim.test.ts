import { describe, expect, it } from "vitest"

import {
  applyReaderImageTrimPatch,
  DEFAULT_READER_IMAGE_TRIM,
  normalizeReaderImageTrim,
  parseReaderImageTrimPatch,
  READER_IMAGE_TRIM_TARGETS,
  mergeReaderImageCropInsets,
  readerImageCropTranslation,
  readerImageTrimClipPath,
  readerImageTrimEffectiveDimensions,
  serializeReaderImageTrim,
} from "./ReaderImageTrim.js"

describe("ReaderImageTrim", () => {
  it("[neoview.image-trim.defaults] [neoview.image-trim.threshold] [neoview.image-trim.target] preserves the resident card defaults and option values", () => {
    expect(DEFAULT_READER_IMAGE_TRIM).toEqual({
      enabled: false,
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      linkVertical: false,
      linkHorizontal: false,
      autoTrimThreshold: 30,
      autoTrimTarget: "auto",
    })
    expect(READER_IMAGE_TRIM_TARGETS).toEqual(["auto", "black", "white"])
  })

  it("[neoview.image-trim.legacy-normalize] [neoview.image-trim.bounds] accepts camel/snake legacy fields and clamps to slider steps", () => {
    expect(normalizeReaderImageTrim({
      enabled: "yes",
      top_percent: -4,
      bottom: 45.24,
      left_margin: 1.26,
      right: 99,
      link_vertical: true,
      linkHorizontal: "yes",
      auto_trim_threshold: 101,
      auto_trim_target: "future",
    })).toEqual({
      ...DEFAULT_READER_IMAGE_TRIM,
      bottom: 45,
      left: 1.5,
      right: 45,
      linkVertical: true,
      autoTrimThreshold: 100,
    })
    expect(normalizeReaderImageTrim({ top: Number.NaN, autoTrimThreshold: 12.5 })).toEqual({
      ...DEFAULT_READER_IMAGE_TRIM,
      autoTrimThreshold: 15,
    })
  })

  it("[neoview.image-trim.patch] [neoview.image-trim.bounds] [neoview.image-trim.threshold] [neoview.image-trim.target] strictly validates bounds, steps, enums and unknown fields", () => {
    expect(parseReaderImageTrimPatch({ enabled: true, top: 45, bottom: 0.5, autoTrimThreshold: 100, autoTrimTarget: "white" })).toEqual({
      enabled: true,
      top: 45,
      bottom: 0.5,
      autoTrimThreshold: 100,
      autoTrimTarget: "white",
    })
    expect(() => parseReaderImageTrimPatch({ top: 1.25 })).toThrow(/step/)
    expect(() => parseReaderImageTrimPatch({ autoTrimThreshold: 12.5 })).toThrow(/step/)
    expect(() => parseReaderImageTrimPatch({ right: 46 })).toThrow(RangeError)
    expect(() => parseReaderImageTrimPatch({ autoTrimTarget: "gray" })).toThrow(RangeError)
    expect(() => parseReaderImageTrimPatch({ linkVertical: 1 })).toThrow(TypeError)
    expect(() => parseReaderImageTrimPatch({ future: true })).toThrow(/Unknown/)
    expect(() => parseReaderImageTrimPatch({})).toThrow(/at least one/)
  })

  it("[neoview.image-trim.reset] uses one exclusive reset mutation", () => {
    expect(parseReaderImageTrimPatch({ reset: "defaults" })).toEqual({ reset: "defaults" })
    expect(applyReaderImageTrimPatch({ ...DEFAULT_READER_IMAGE_TRIM, enabled: true, top: 15, autoTrimTarget: "black" }, { reset: "defaults" }))
      .toEqual(DEFAULT_READER_IMAGE_TRIM)
    expect(() => parseReaderImageTrimPatch({ reset: "factory" })).toThrow('must be "defaults"')
    expect(() => parseReaderImageTrimPatch({ reset: "defaults", enabled: true })).toThrow(/cannot be combined/)
  })

  it("[neoview.image-trim.link-vertical] [neoview.image-trim.link-horizontal] preserves legacy linked-edge projection", () => {
    const linked = applyReaderImageTrimPatch({
      ...DEFAULT_READER_IMAGE_TRIM,
      top: 10,
      bottom: 20,
      left: 5,
      right: 15,
    }, { linkVertical: true, linkHorizontal: true })
    expect(linked).toMatchObject({ top: 20, bottom: 20, left: 15, right: 15 })

    expect(applyReaderImageTrimPatch(linked, { top: 12 })).toMatchObject({ top: 12, bottom: 12 })
    expect(applyReaderImageTrimPatch(linked, { bottom: 7 })).toMatchObject({ top: 7, bottom: 7 })
    expect(applyReaderImageTrimPatch(linked, { left: 8 })).toMatchObject({ left: 8, right: 8 })
    expect(applyReaderImageTrimPatch(linked, { right: 4 })).toMatchObject({ left: 4, right: 4 })
    expect(applyReaderImageTrimPatch(linked, { top: 3, bottom: 4, left: 5, right: 6 })).toMatchObject({
      top: 3,
      bottom: 4,
      left: 5,
      right: 6,
    })
  })

  it("[neoview.image-trim.json] emits detached JSON-safe persistence values", () => {
    const settings = applyReaderImageTrimPatch(DEFAULT_READER_IMAGE_TRIM, {
      enabled: true,
      top: 10.5,
      linkVertical: true,
      autoTrimThreshold: 50,
      autoTrimTarget: "black",
    })
    const encoded = serializeReaderImageTrim(settings)
    expect(encoded).toEqual(settings)
    expect(JSON.parse(JSON.stringify(encoded))).toEqual(encoded)
    expect(encoded).not.toBe(settings)
  })

  it("[neoview.image-trim.media-core] projects one media-agnostic inset contract", () => {
    expect(readerImageTrimClipPath({
      ...DEFAULT_READER_IMAGE_TRIM,
      enabled: true,
      top: 5,
      right: 10,
      bottom: 15,
      left: 20,
    })).toBe("inset(5% 10% 15% 20%)")
    expect(readerImageTrimClipPath(DEFAULT_READER_IMAGE_TRIM)).toBeUndefined()
  })

  it("[neoview.image-trim.clip-path] composes typed presentation crops without parsing CSS", () => {
    const settings = { ...DEFAULT_READER_IMAGE_TRIM, enabled: true, top: 5, right: 10, bottom: 15, left: 20 }
    const presentation = { top: 0, right: 50, bottom: 0, left: 0 }
    expect(mergeReaderImageCropInsets({ top: 5, right: 10, bottom: 15, left: 20 }, presentation))
      .toEqual({ top: 5, right: 50, bottom: 15, left: 20 })
    expect(readerImageTrimClipPath(settings, presentation)).toBe("inset(5% 50% 15% 20%)")
    expect(readerImageTrimClipPath(DEFAULT_READER_IMAGE_TRIM, presentation)).toBe("inset(0% 50% 0% 0%)")
    expect(() => mergeReaderImageCropInsets(undefined, { top: 60, right: 0, bottom: 40, left: 0 })).toThrow(/visible area/)
  })

  it("[neoview.image-trim.effective-dimensions] reports the visible geometry without creating another asset", () => {
    const settings = { ...DEFAULT_READER_IMAGE_TRIM, enabled: true, top: 5, right: 10, bottom: 15, left: 20 }
    expect(readerImageTrimEffectiveDimensions({ width: 1200, height: 800 }, settings)).toEqual({
      width: 840,
      height: 640,
      aspectRatio: 1.3125,
    })
    expect(readerImageTrimEffectiveDimensions({ width: 1200, height: 800 }, settings, { top: 0, right: 50, bottom: 0, left: 0 })).toEqual({
      width: 360,
      height: 640,
      aspectRatio: 0.5625,
    })
    expect(() => readerImageTrimEffectiveDimensions({ width: 0, height: 800 }, settings)).toThrow(/positive finite/)
  })

  it("[neoview.reader.split-wide-pages] centers typed physical-half crops", () => {
    expect(readerImageCropTranslation({ top: 0, right: 50, bottom: 0, left: 0 })).toEqual({ xPercent: 25, yPercent: 0 })
    expect(readerImageCropTranslation({ top: 0, right: 0, bottom: 0, left: 50 })).toEqual({ xPercent: -25, yPercent: 0 })
    expect(readerImageCropTranslation(undefined)).toEqual({ xPercent: 0, yPercent: 0 })
  })
})
