import { describe, expect, it } from "vitest"

import {
  applyReaderInfoOverlayPatch,
  DEFAULT_READER_INFO_OVERLAY,
  normalizeReaderInfoOverlay,
  parseReaderInfoOverlayPatch,
} from "./ReaderInfoOverlay.js"

describe("ReaderInfoOverlay", () => {
  it("[neoview.info-overlay.defaults] preserves legacy defaults and automatic dimensions", () => {
    expect(DEFAULT_READER_INFO_OVERLAY).toEqual({ enabled: false, opacity: 0.85, showBorder: false })
    expect(normalizeReaderInfoOverlay(undefined)).toEqual(DEFAULT_READER_INFO_OVERLAY)
  })

  it("[neoview.info-overlay.legacy-normalize] tolerates invalid fields and clamps loaded values", () => {
    expect(normalizeReaderInfoOverlay({
      enabled: "yes",
      opacity: 2,
      showBorder: true,
      width: 1,
      height: 900,
    })).toEqual({
      enabled: false,
      opacity: 1,
      showBorder: true,
      width: 120,
      height: 600,
    })
    expect(normalizeReaderInfoOverlay({ width: 0, height: -1 })).toEqual(DEFAULT_READER_INFO_OVERLAY)
    expect(normalizeReaderInfoOverlay({ opacity: Number.NaN, width: "480" })).toEqual(DEFAULT_READER_INFO_OVERLAY)
  })

  it("[neoview.info-overlay.patch] validates strict fields and normalizes clear commands", () => {
    expect(parseReaderInfoOverlayPatch({ enabled: true, opacity: 0, showBorder: true, width: 480, height: 56 })).toEqual({
      enabled: true,
      opacity: 0,
      showBorder: true,
      width: 480,
      height: 56,
    })
    expect(parseReaderInfoOverlayPatch({ width: 0, height: null })).toEqual({ width: null, height: null })
    expect(() => parseReaderInfoOverlayPatch({ opacity: 1.1 })).toThrow(RangeError)
    expect(() => parseReaderInfoOverlayPatch({ width: 119 })).toThrow(RangeError)
    expect(() => parseReaderInfoOverlayPatch({ height: 601 })).toThrow(RangeError)
    expect(() => parseReaderInfoOverlayPatch({ enabled: 1 })).toThrow(TypeError)
    expect(() => parseReaderInfoOverlayPatch({ future: true })).toThrow(/Unknown/)
    expect(() => parseReaderInfoOverlayPatch({})).toThrow("at least one")
  })

  it("[neoview.info-overlay.clear] deletes optional dimensions without changing other settings", () => {
    expect(applyReaderInfoOverlayPatch({
      enabled: true,
      opacity: 0.5,
      showBorder: true,
      width: 480,
      height: 56,
    }, { width: -1, height: 0 })).toEqual({
      enabled: true,
      opacity: 0.5,
      showBorder: true,
    })
  })

  it("[neoview.info-overlay.reset] uses one exclusive reset-compatible mutation", () => {
    expect(parseReaderInfoOverlayPatch({ reset: "defaults" })).toEqual({ reset: "defaults" })
    expect(applyReaderInfoOverlayPatch({
      enabled: true,
      opacity: 0.2,
      showBorder: true,
      width: 800,
      height: 200,
    }, { reset: "defaults" })).toEqual(DEFAULT_READER_INFO_OVERLAY)
    expect(() => parseReaderInfoOverlayPatch({ reset: "defaults", enabled: true })).toThrow("cannot be combined")
    expect(() => parseReaderInfoOverlayPatch({ reset: true })).toThrow('must be "defaults"')
  })
})
