import { describe, expect, it } from "vitest"

import {
  applyReaderImageTrimPatch,
  DEFAULT_READER_IMAGE_TRIM,
  normalizeReaderImageTrim,
  parseReaderImageTrimPatch,
  READER_IMAGE_TRIM_TARGETS,
  serializeReaderImageTrim,
} from "./ReaderImageTrim.js"

describe("ReaderImageTrim", () => {
  it("[neoview.image-trim.defaults] preserves the resident card defaults and option values", () => {
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

  it("[neoview.image-trim.legacy-normalize] accepts camel/snake legacy fields and clamps to slider steps", () => {
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

  it("[neoview.image-trim.patch] strictly validates bounds, steps, enums and unknown fields", () => {
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
})
