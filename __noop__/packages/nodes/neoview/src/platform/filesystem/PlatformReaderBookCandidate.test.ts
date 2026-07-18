import { describe, expect, it } from "vitest"

import { ReaderMediaFormatRegistry } from "../../domain/page/media.js"
import { platformReaderBookCandidate } from "./PlatformReaderBookCandidate.js"

describe("platformReaderBookCandidate", () => {
  it("[neoview.book.adjacent-formats] accepts folders, supported archives and configured videos but not images or deferred PDF", () => {
    const media = new ReaderMediaFormatRegistry({
      supportedImageFormats: ["jpg"],
      videoFormats: ["comicvideo"],
      mediaMimeTypes: { comicvideo: "video/mp4" },
    })
    expect(platformReaderBookCandidate(entry("Book", "directory"), media)).toBe(true)
    expect(platformReaderBookCandidate(entry("Book.cbz"), media)).toBe(true)
    expect(platformReaderBookCandidate(entry("Book.epub"), media)).toBe(true)
    expect(platformReaderBookCandidate(entry("Movie.comicvideo"), media)).toBe(true)
    expect(platformReaderBookCandidate(entry("Cover.jpg"), media)).toBe(false)
    expect(platformReaderBookCandidate(entry("Deferred.pdf"), media)).toBe(false)
  })
})

function entry(name: string, kind: "file" | "directory" = "file") {
  return { name, path: `C:/Library/${name}`, kind, readerSupported: true } as const
}
