import { describe, expect, it, vi } from "vitest"

import { PlatformReaderDirectoryClipmScoreProvider } from "./PlatformReaderDirectoryClipmScoreProvider.js"

describe("PlatformReaderDirectoryClipmScoreProvider", () => {
  it("hydrates directories from one shared aggregate request and leaves files untouched", async () => {
    const getDirectoryScores = vi.fn(async () => ({
      directories: [
        { directoryPath: "C:/Books/High", work: work("C:/Books/High/best.cbz", 932, "A2BC") },
        { directoryPath: "C:/Books/Empty", work: null },
      ],
    }))
    const provider = new PlatformReaderDirectoryClipmScoreProvider({ getDirectoryScores })
    const entries = [
      { name: "High", path: "C:/Books/High", kind: "directory" as const, readerSupported: true },
      { name: "Empty", path: "C:/Books/Empty", kind: "directory" as const, readerSupported: true },
      { name: "file.cbz", path: "C:/Books/file.cbz", kind: "file" as const, readerSupported: true },
    ]

    const hydrated = await provider.hydrate(entries)

    expect(getDirectoryScores).toHaveBeenCalledOnce()
    expect(getDirectoryScores).toHaveBeenCalledWith(["C:/Books/High", "C:/Books/Empty"], { signal: undefined })
    expect(hydrated[0]?.clipmScore).toEqual({
      label: "P",
      score: 932,
      bundleVersion: 3,
      shortCode: "A2BC",
      sourcePath: "C:/Books/High/best.cbz",
    })
    expect(hydrated[1]).toEqual(entries[1])
    expect(hydrated[2]).toBe(entries[2])
  })
})

function work(path: string, score: number, shortCode: string) {
  return {
    workId: "018f0000-0000-7000-8000-000000000001",
    path,
    label: "P" as const,
    score,
    bundleVersion: 3,
    shortCode,
  }
}
