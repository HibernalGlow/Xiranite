import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { scanBasicFiles, scanDuplicateFiles, scanMediaFiles, type BasicScanOptions, type DuplicateScanOptions, type MediaScanOptions } from "@xiranite/czkawka-native"
import type { CzkawkaInput, CzkawkaRuntime } from "./core.js"

type NormalizedInput = Required<CzkawkaInput>

export function toDuplicateScanOptions(input: NormalizedInput): DuplicateScanOptions {
  return {
    includedDirectories: input.includedDirectories,
    referenceDirectories: input.includedDirectoriesReferenced,
    excludedDirectories: input.excludedDirectories,
    excludedItems: input.excludedItems,
    allowedExtensions: input.allowedExtensions,
    excludedExtensions: input.excludedExtensions,
    minimumFileSize: input.minimumFileSize,
    maximumFileSize: input.maximumFileSize,
    recursive: input.recursive,
    useCache: input.useCache,
    ignoreHardLinks: input.ignoreHardLinks,
    usePrehash: input.usePrehash,
    caseSensitiveNames: input.caseSensitiveNames,
    checkMethod: input.checkMethod,
    hashType: input.hashType,
  }
}

export function toBasicScanOptions(input: NormalizedInput): BasicScanOptions {
  return {
    tool: input.tool as BasicScanOptions["tool"],
    includedDirectories: input.includedDirectories,
    referenceDirectories: input.includedDirectoriesReferenced,
    excludedDirectories: input.excludedDirectories,
    excludedItems: input.excludedItems,
    allowedExtensions: input.allowedExtensions,
    excludedExtensions: input.excludedExtensions,
    recursive: input.recursive,
    minimumFileSize: input.minimumFileSize,
    maximumFileSize: input.maximumFileSize,
    useCache: input.useCache,
    numberOfFiles: input.numberOfFiles,
    biggestFirst: input.biggestFirst,
  }
}

export function toMediaScanOptions(input: NormalizedInput): MediaScanOptions {
  return {
    tool: input.tool as MediaScanOptions["tool"],
    includedDirectories: input.includedDirectories,
    referenceDirectories: input.includedDirectoriesReferenced,
    excludedDirectories: input.excludedDirectories,
    excludedItems: input.excludedItems,
    allowedExtensions: input.allowedExtensions,
    excludedExtensions: input.excludedExtensions,
    recursive: input.recursive,
    minimumFileSize: input.minimumFileSize,
    maximumFileSize: input.maximumFileSize,
    useCache: input.useCache,
    ignoreHardLinks: input.ignoreHardLinks,
    similarity: input.similarity,
    imageHashSize: input.similarImagesHashSize,
    imageHashAlgorithm: input.similarImagesHashAlgorithm,
    imageResizeAlgorithm: input.similarImagesResizeAlgorithm,
    imageIgnoreSameSize: input.similarImagesIgnoreSameSize,
    videoIgnoreSameSize: input.similarVideosIgnoreSameSize,
    videoSkipForward: input.similarVideosSkipForward,
    videoHashDuration: input.similarVideosHashDuration,
    videoCropDetect: input.similarVideosCropDetect,
    musicCheckType: input.musicCheckType,
    musicApproximateComparison: input.musicApproximateComparison,
    musicCompareTitle: input.musicCompareTitle,
    musicCompareArtist: input.musicCompareArtist,
    musicCompareBitrate: input.musicCompareBitrate,
    musicCompareGenre: input.musicCompareGenre,
    musicCompareYear: input.musicCompareYear,
    musicCompareLength: input.musicCompareLength,
    musicMaximumDifference: input.musicMaximumDifference,
    musicMinimumFragmentDuration: input.musicMinimumFragmentDuration,
    musicCompareFingerprintsOnlyWithSimilarTitles: input.musicCompareFingerprintsOnlyWithSimilarTitles,
    brokenAudio: input.brokenAudio,
    brokenPdf: input.brokenPdf,
    brokenArchive: input.brokenArchive,
    brokenImage: input.brokenImage,
  }
}

export function createNodeCzkawkaRuntime(): CzkawkaRuntime {
  return {
    scanDuplicates: (input) => scanDuplicateFiles(toDuplicateScanOptions(input)),
    scanBasic: (input) => scanBasicFiles(toBasicScanOptions(input)),
    scanMedia: (input) => scanMediaFiles(toMediaScanOptions(input)),
    removePath: async (path) => { await rm(path, { force: true, recursive: false }) },
    movePath: async (source, target) => { await mkdir(dirname(target), { recursive: true }); await rename(source, target) },
    writeText: async (path, content) => { await writeFile(path, content, "utf8") },
    ensureDirectory: async (path) => { if (path) await mkdir(path, { recursive: true }) },
    join,
    dirname,
    basename,
  }
}
