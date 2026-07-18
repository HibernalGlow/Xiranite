import { describe, expect, it } from "vitest"

import {
  DEFAULT_READER_ANIMATED_VIDEO_MODE,
  matchesReaderAnimatedVideoKeyword,
  normalizeReaderAnimatedVideoKeywords,
  normalizeReaderAnimatedVideoMode,
  parseReaderAnimatedVideoModePatch,
} from "./ReaderAnimatedVideoMode.js"

describe("ReaderAnimatedVideoMode", () => {
  it("[neoview.animated-video.defaults] preserves the legacy disabled default and keyword", () => {
    expect(normalizeReaderAnimatedVideoMode(undefined)).toEqual(DEFAULT_READER_ANIMATED_VIDEO_MODE)
  })

  it("[neoview.animated-video.keywords] normalizes case, whitespace and duplicates without allowing an empty list", () => {
    expect(normalizeReaderAnimatedVideoKeywords([" #Dyna ", "[anim]", "#dyna", ""])).toEqual(["#dyna", "[anim]"])
    expect(normalizeReaderAnimatedVideoKeywords([])).toEqual(["[#dyna]"])
  })

  it("[neoview.animated-video.patch] strictly validates canonical patches", () => {
    expect(parseReaderAnimatedVideoModePatch({ enabled: true, keywords: ["[#gif]"] })).toEqual({ enabled: true, keywords: ["[#gif]"] })
    expect(() => parseReaderAnimatedVideoModePatch({ unknown: true })).toThrow()
    expect(() => parseReaderAnimatedVideoModePatch({ keywords: [1] })).toThrow()
  })

  it("[neoview.animated-video.match] matches normalized file text against configured keywords", () => {
    expect(matchesReaderAnimatedVideoKeyword("Chapter [#DYNA] page", ["[#dyna]"])).toBe(true)
    expect(matchesReaderAnimatedVideoKeyword("static.webp", ["[#dyna]"])).toBe(false)
  })
})
