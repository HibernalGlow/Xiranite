import { describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { normalizeCzkawkaInput } from "./core.js"
import { createNodeCzkawkaRuntime, toBasicScanOptions, toDuplicateScanOptions, toMediaScanOptions } from "./platform.js"

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
