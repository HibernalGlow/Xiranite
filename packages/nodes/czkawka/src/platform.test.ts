import { describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CZKAWKA_TOOLS, normalizeCzkawkaInput, type CzkawkaTool } from "./core.js"
import { createNodeCzkawkaRuntime, toBasicScanOptions, toDuplicateScanOptions, toMediaScanOptions } from "./platform.js"
import { createCzkawkaScanInput } from "./tool-options.js"

describe("Czkawka native DTO mapping", () => {
  test.each(CZKAWKA_TOOLS)("maps shared scan fields for %s", (tool) => {
    const input = normalizeCzkawkaInput(createCzkawkaScanInput(tool, {
      includedDirectories: ["D:/library", "D:/reference"],
      includedDirectoriesReferenced: ["D:/reference"],
      excludedDirectories: ["D:/excluded"],
      excludedItems: ["*/cache/*"],
      allowedExtensions: "jpg,png",
      excludedExtensions: "tmp",
      minimumFileSize: 123,
      maximumFileSize: 456_789,
      recursive: false,
      useCache: false,
    }))
    expect(nativeOptions(tool, input)).toMatchObject({
      includedDirectories: ["D:/library", "D:/reference"],
      referenceDirectories: ["D:/reference"],
      excludedDirectories: ["D:/excluded"],
      excludedItems: ["*/cache/*"],
      allowedExtensions: "jpg,png",
      excludedExtensions: "tmp",
      minimumFileSize: 123,
      maximumFileSize: 456_789,
      recursive: false,
      useCache: false,
    })
  })

  test.each([
    ["duplicate-files", { checkMethod: "size-and-name", hashType: "xxh3", duplicateMinimumGroupSize: 4, caseSensitiveNames: true, ignoreHardLinks: false, usePrehash: false }, { checkMethod: "size-and-name", hashType: "xxh3", caseSensitiveNames: true, ignoreHardLinks: false, usePrehash: false }],
    ["empty-folders", {}, { tool: "empty-folders" }],
    ["big-files", { numberOfFiles: 321, biggestFirst: false }, { tool: "big-files", numberOfFiles: 321, biggestFirst: false }],
    ["empty-files", {}, { tool: "empty-files" }],
    ["temporary-files", {}, { tool: "temporary-files" }],
    ["similar-images", { similarity: 7, similarImagesHashSize: 64, similarImagesHashAlgorithm: "double-gradient", similarImagesResizeAlgorithm: "catmull-rom", similarImagesIgnoreSameSize: true, similarImagesFolderThreshold: 5 }, { tool: "similar-images", similarity: 7, imageHashSize: 64, imageHashAlgorithm: "double-gradient", imageResizeAlgorithm: "catmull-rom", imageIgnoreSameSize: true }],
    ["similar-videos", { similarity: 8, similarVideosIgnoreSameSize: true, similarVideosSkipForward: 45, similarVideosHashDuration: 20, similarVideosCropDetect: "motion" }, { tool: "similar-videos", similarity: 8, videoIgnoreSameSize: true, videoSkipForward: 45, videoHashDuration: 20, videoCropDetect: "motion" }],
    ["duplicate-music", { musicCheckType: "fingerprint", musicApproximateComparison: false, musicCompareTitle: false, musicCompareArtist: true, musicCompareBitrate: true, musicCompareGenre: true, musicCompareYear: true, musicCompareLength: true, musicMaximumDifference: 4, musicMinimumFragmentDuration: 30, musicCompareFingerprintsOnlyWithSimilarTitles: false }, { tool: "duplicate-music", musicCheckType: "fingerprint", musicApproximateComparison: false, musicCompareTitle: false, musicCompareArtist: true, musicCompareBitrate: true, musicCompareGenre: true, musicCompareYear: true, musicCompareLength: true, musicMaximumDifference: 4, musicMinimumFragmentDuration: 30, musicCompareFingerprintsOnlyWithSimilarTitles: false }],
    ["invalid-symlinks", {}, { tool: "invalid-symlinks" }],
    ["broken-files", { brokenAudio: false, brokenPdf: true, brokenArchive: false, brokenImage: true }, { tool: "broken-files", brokenAudio: false, brokenPdf: true, brokenArchive: false, brokenImage: true }],
    ["bad-extensions", {}, { tool: "bad-extensions" }],
  ] as const)("maps the complete %s contract into its native family DTO", (tool, values, expected) => {
    const input = normalizeCzkawkaInput(createCzkawkaScanInput(tool, { includedDirectories: ["D:/library"], ...values }))
    expect(nativeOptions(tool, input)).toMatchObject(expected)
  })

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

  test("executes copy, move, existence, and permanent-delete primitives", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-czkawka-"))
    const runtime = createNodeCzkawkaRuntime()
    try {
      const source = join(root, "source.txt")
      const copied = join(root, "nested", "copied.txt")
      const moved = join(root, "moved.txt")
      await writeFile(source, "payload", "utf8")
      await runtime.copyPath(source, copied)
      expect(await readFile(copied, "utf8")).toBe("payload")
      await runtime.movePath(copied, moved)
      expect(await runtime.pathExists(copied)).toBe(false)
      expect(await readFile(moved, "utf8")).toBe("payload")
      await runtime.removePath(moved, { trash: false })
      expect(await runtime.pathExists(moved)).toBe(false)
      const emptyTree = join(root, "empty", "nested")
      await mkdir(emptyTree, { recursive: true })
      await runtime.removePath(join(root, "empty"), { trash: false, emptyFoldersOnly: true })
      expect(await runtime.pathExists(join(root, "empty"))).toBe(false)
      const changedFolder = join(root, "changed")
      await mkdir(changedFolder)
      await writeFile(join(changedFolder, "new.txt"), "new", "utf8")
      await expect(runtime.removePath(changedFolder, { trash: false, emptyFoldersOnly: true })).rejects.toThrow("no longer empty")
      expect(await runtime.pathExists(changedFolder)).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

function nativeOptions(tool: CzkawkaTool, input: ReturnType<typeof normalizeCzkawkaInput>) {
  if (tool === "duplicate-files") return toDuplicateScanOptions(input)
  if (["empty-folders", "big-files", "empty-files", "temporary-files", "invalid-symlinks"].includes(tool)) return toBasicScanOptions(input)
  return toMediaScanOptions(input)
}
