import { describe, expect, it } from "vitest"
import { currentLyricIndex, currentLyricLine, extractEmbeddedLyrics, lyricPathCandidates, parseLrc } from "./lyrics.js"

describe("Melodeck lyrics", () => {
  it("parses multiple LRC timestamps and sorts the result", () => {
    expect(parseLrc("[00:12.50][00:20.500] Chorus\n[00:03] Verse")).toEqual([
      { time: 3, text: "Verse" },
      { time: 12.5, text: "Chorus" },
      { time: 20.5, text: "Chorus" },
    ])
  })

  it("normalizes synchronized and plain embedded lyrics", () => {
    expect(extractEmbeddedLyrics([{ syncText: [{ timestamp: 2500, text: "Line two" }, { timestamp: 1000, text: "Line one" }] }])).toEqual([
      { time: 1, text: "Line one" },
      { time: 2.5, text: "Line two" },
    ])
    expect(extractEmbeddedLyrics([{ text: "First\nSecond" }])).toEqual([{ text: "First" }, { text: "Second" }])
  })

  it("selects the active synchronized line with the GUI timing tolerance", () => {
    const lines = [{ time: 1, text: "One" }, { time: 3, text: "Two" }]
    expect(currentLyricLine(lines, 0)).toBeUndefined()
    expect(currentLyricIndex(lines, 2.8)).toBe(1)
    expect(currentLyricLine(lines, 2.8)).toBe("Two")
  })

  it("builds the same sidecar candidates used by the GUI", () => {
    expect(lyricPathCandidates("D:/Music/demo.flac")).toEqual(["D:/Music/demo.lrc", "D:/Music/demo.LRC"])
  })
})
