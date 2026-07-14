import { describe, expect, test } from "vitest"

import { normalizeCzkawkaInput } from "./core.js"
import { toBasicScanOptions, toDuplicateScanOptions, toMediaScanOptions } from "./platform.js"

describe("Czkawka native DTO mapping", () => {
  test("maps duplicate-specific settings without leaking workflow fields", () => {
    const value = normalizeCzkawkaInput({
      tool: "duplicate-files",
      includedDirectories: ["D:/library"],
      includedDirectoriesReferenced: ["D:/library/reference"],
      checkMethod: "size-and-name",
      hashType: "xxh3",
      caseSensitiveNames: true,
      usePrehash: false,
    })
    expect(toDuplicateScanOptions(value)).toMatchObject({
      includedDirectories: ["D:/library"],
      referenceDirectories: ["D:/library/reference"],
      checkMethod: "size-and-name",
      hashType: "xxh3",
      caseSensitiveNames: true,
      usePrehash: false,
    })
    expect(toDuplicateScanOptions(value)).not.toHaveProperty("destinationDirectory")
  })

  test("maps big-file direction and limit", () => {
    const value = normalizeCzkawkaInput({ tool: "big-files", numberOfFiles: 120, biggestFirst: false })
    expect(toBasicScanOptions(value)).toMatchObject({ tool: "big-files", numberOfFiles: 120, biggestFirst: false })
  })

  test("maps every fork media algorithm setting", () => {
    const value = normalizeCzkawkaInput({
      tool: "duplicate-music",
      minimumFileSize: 100,
      maximumFileSize: 2_000,
      similarImagesHashSize: 64,
      similarImagesHashAlgorithm: "double-gradient",
      similarImagesResizeAlgorithm: "catmull-rom",
      similarImagesIgnoreSameSize: true,
      similarVideosIgnoreSameSize: true,
      similarVideosSkipForward: 45,
      similarVideosHashDuration: 20,
      similarVideosCropDetect: "motion",
      musicCheckType: "fingerprint",
      musicApproximateComparison: false,
      musicCompareTitle: false,
      musicCompareArtist: true,
      musicCompareBitrate: true,
      musicCompareGenre: true,
      musicCompareYear: true,
      musicCompareLength: true,
      musicMaximumDifference: 4,
      musicMinimumFragmentDuration: 30,
      musicCompareFingerprintsOnlyWithSimilarTitles: false,
      brokenAudio: false,
      brokenPdf: true,
      brokenArchive: false,
      brokenImage: true,
    })
    expect(toMediaScanOptions(value)).toMatchObject({
      minimumFileSize: 100,
      maximumFileSize: 2_000,
      imageHashSize: 64,
      imageHashAlgorithm: "double-gradient",
      imageResizeAlgorithm: "catmull-rom",
      imageIgnoreSameSize: true,
      videoIgnoreSameSize: true,
      videoSkipForward: 45,
      videoHashDuration: 20,
      videoCropDetect: "motion",
      musicCheckType: "fingerprint",
      musicApproximateComparison: false,
      musicCompareTitle: false,
      musicCompareArtist: true,
      musicCompareBitrate: true,
      musicCompareGenre: true,
      musicCompareYear: true,
      musicCompareLength: true,
      musicMaximumDifference: 4,
      musicMinimumFragmentDuration: 30,
      musicCompareFingerprintsOnlyWithSimilarTitles: false,
      brokenAudio: false,
      brokenPdf: true,
      brokenArchive: false,
      brokenImage: true,
    })
  })
})
