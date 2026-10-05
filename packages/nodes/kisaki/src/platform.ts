import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { cp, link, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, parse, relative } from "node:path"
import { promisify } from "node:util"
import { createExifCandidate, createVideoOptimizerCandidate, getCzkawkaInfo, scanBasicFiles, scanDuplicateFiles, scanExifFiles, scanMediaFiles, scanVideoOptimizer, trashPath, type BasicScanOptions, type CzkawkaScanControls, type CzkawkaScanProgress, type DuplicateScanOptions, type ExifScanOptions, type MediaScanOptions, type VideoOptimizerCandidateOptions, type VideoOptimizerScanOptions } from "@xiranite/czkawka-native"
import { executeSingleFileMutation, type FileOperationExecutor } from "@xiranite/file-operations"
import { toNativeVideoCropDetect } from "./similar-video-crop.js"
import type { KisakiNativeProgress, KisakiNormalizedInput, KisakiRuntime, KisakiRuntimeInfo } from "./core.js"

type NormalizedInput = KisakiNormalizedInput
const execFileAsync = promisify(execFile)
let cacheEnvironmentSignature: string | undefined

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
    saveAlsoAsJson: input.saveAlsoAsJson,
    deleteOutdatedCache: input.deleteOutdatedCache,
    minimalCacheFileSize: input.duplicateMinimalHashCacheSizeKiB * 1024,
    minimalPrehashCacheFileSize: input.duplicateMinimalPrehashCacheSizeKiB * 1024,
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
    saveAlsoAsJson: input.saveAlsoAsJson,
    deleteOutdatedCache: input.deleteOutdatedCache,
    numberOfFiles: input.numberOfFiles,
    biggestFirst: input.biggestFirst,
    emptyFilesSearchZeroByteContent: input.emptyFilesSearchZeroByteContent,
    emptyFilesSearchNonPrintableContent: input.emptyFilesSearchNonPrintableContent,
    temporaryFileExtensions: input.temporaryFileExtensions,
  }
}

export function toExifScanOptions(input: NormalizedInput): ExifScanOptions {
  return {
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
    saveAlsoAsJson: input.saveAlsoAsJson,
    deleteOutdatedCache: input.deleteOutdatedCache,
  }
}

export function toVideoOptimizerScanOptions(input: NormalizedInput): VideoOptimizerScanOptions {
  return {
    mode: input.videoOptimizerMode,
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
    saveAlsoAsJson: input.saveAlsoAsJson,
    deleteOutdatedCache: input.deleteOutdatedCache,
    excludedCodecs: input.videoOptimizerExcludedCodecs,
    blackPixelThreshold: input.videoOptimizerBlackPixelThreshold,
    blackBarMinPercentage: input.videoOptimizerBlackBarMinPercentage,
    maxSamples: input.videoOptimizerMaxSamples,
    minCropSize: input.videoOptimizerMinCropSize,
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
    saveAlsoAsJson: input.saveAlsoAsJson,
    deleteOutdatedCache: input.deleteOutdatedCache,
    ignoreHardLinks: input.ignoreHardLinks,
    similarity: input.similarity,
    imageHashSize: input.similarImagesHashSize,
    imageHashAlgorithm: input.similarImagesHashAlgorithm,
    imageResizeAlgorithm: input.similarImagesResizeAlgorithm,
    imageIgnoreSameSize: input.similarImagesIgnoreSameSize,
    imageIgnoreSameResolution: input.similarImagesIgnoreSameResolution,
    imageGeometricInvariance: input.similarImagesGeometricInvariance,
    videoIgnoreSameSize: input.similarVideosIgnoreSameSize,
    videoIgnoreSameResolution: input.similarVideosIgnoreSameResolution,
    videoSkipForward: input.similarVideosSkipForward,
    videoHashDuration: input.similarVideosHashDuration,
    videoCropDetect: toNativeVideoCropDetect(input.similarVideosLetterboxCrop),
    videoWindowCount: input.similarVideosWindowCount,
    videoDurationTolerancePct: input.similarVideosDurationTolerancePct,
    videoMinMatchingWindows: input.similarVideosMinMatchingWindows,
    videoSubclipMinMatch: input.similarVideosSubclipMinMatch,
    videoCheckAudioContent: input.similarVideosCheckAudioContent,
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
    brokenVideoFfprobe: input.brokenVideoFfprobe,
    brokenVideoFfmpeg: input.brokenVideoFfmpeg,
    brokenFont: input.brokenFont,
    brokenMarkup: input.brokenMarkup,
  }
}

export interface KisakiRuntimeContext {
  fileOperations?: FileOperationExecutor
}

export function getNodeRuntimeInfo(): KisakiRuntimeInfo {
  const info = getCzkawkaInfo()
  return { apiVersion: info.apiVersion, sourceVersion: info.sourceVersion, capabilities: [...info.capabilities] }
}

export function createNodeKisakiRuntime(context: KisakiRuntimeContext = {}): KisakiRuntime {
  const nativeInfo = getNodeRuntimeInfo()
  const runtime: KisakiRuntime = {
    capabilities: nativeInfo.capabilities,
    scanDuplicates: (input, onProgress) => { configureKisakiCacheEnvironment(input); return runNativeScan(toDuplicateScanOptions(input), input.threadCount, runtime, onProgress, scanDuplicateFiles) },
    scanBasic: (input, onProgress) => { configureKisakiCacheEnvironment(input); return runNativeScan(toBasicScanOptions(input), input.threadCount, runtime, onProgress, scanBasicFiles) },
    scanExif: (input, onProgress) => { configureKisakiCacheEnvironment(input); return runNativeScan(toExifScanOptions(input), input.threadCount, runtime, onProgress, scanExifFiles) },
    scanVideoOptimizer: (input, onProgress) => { configureKisakiCacheEnvironment(input); return runNativeScan(toVideoOptimizerScanOptions(input), input.threadCount, runtime, onProgress, scanVideoOptimizer) },
    scanMedia: (input, onProgress) => { configureKisakiCacheEnvironment(input); return runNativeScan(toMediaScanOptions(input), input.threadCount, runtime, onProgress, scanMediaFiles) },
    createExifCandidate: (sourcePath, tags) => createExifCandidate({ sourcePath, tags }),
    createVideoOptimizerCandidate: (item, input) => runNativeVideoOptimizerCandidate(item, input, runtime),
    replaceWithCandidate: (candidatePath, sourcePath) => replaceWithCandidate(candidatePath, sourcePath, context.fileOperations),
    pathExists,
    listDirectory,
    removePath: (path, options) => removePath(path, options, context.fileOperations),
    copyPath,
    movePath,
    linkPath,
    readText: (path) => readFile(path, "utf8"),
    writeText: async (path, content) => { await writeFile(path, content, "utf8") },
    ensureDirectory: async (path) => { if (path) await mkdir(path, { recursive: true }) },
    join,
    dirname,
    basename,
    relativeDirectoryFromRoot: (path) => relative(parse(path).root, dirname(path)),
  }
  return runtime
}

export async function openKisakiPath(path: string): Promise<void> {
  const entry = await lstat(path)
  if (process.platform === "win32") {
    if (entry.isDirectory()) await execFileAsync("explorer.exe", [path])
    else await execFileAsync("rundll32.exe", ["url.dll,FileProtocolHandler", path])
    return
  }
  await execFileAsync(process.platform === "darwin" ? "open" : "xdg-open", [path])
}

/**
 * One native scan, with the wait left to the binding.
 *
 * This file used to run the polling loop itself over `setInterval`, which is exactly one runtime's
 * primitive: Node/Bun has timers, the host's QuickJS realm does not. The scan would have reported
 * progress on the first and silently stalled on the second, so the loop moved down to the binding
 * (`packages/czkawka-native` for the addon, `packages/quickjs-shims/src/czkawka-service.ts` for the
 * realm) and this function only hands the two controls down. The progress *wording* stays here, in
 * `normalizeProgress` and the node's own event text — one vocabulary, whichever runtime runs it.
 */
async function runNativeScan<TOptions extends object, TResult>(options: TOptions, threadCount: number, runtime: KisakiRuntime, onProgress: ((progress: KisakiNativeProgress) => void) | undefined, scan: (options: TOptions & { scanId: string; threadCount: number }, controls: CzkawkaScanControls) => Promise<TResult>): Promise<TResult> {
  const scanId = randomUUID()
  let lastProgress = ""
  return scan({ ...options, scanId, threadCount }, {
    onProgress: (progress: CzkawkaScanProgress) => {
      const signature = `${progress.stage}:${progress.stageIndex}:${progress.entriesChecked}:${progress.bytesChecked}`
      if (signature === lastProgress) return
      lastProgress = signature
      onProgress?.(normalizeProgress(progress))
    },
    shouldCancel: () => runtime.isCancelled?.() ?? false,
  })
}

async function runNativeVideoOptimizerCandidate(item: Parameters<KisakiRuntime["createVideoOptimizerCandidate"]>[0], input: NormalizedInput, runtime: KisakiRuntime) {
  const scanId = randomUUID()
  const options: VideoOptimizerCandidateOptions = {
    sourcePath: item.path,
    mode: input.videoOptimizerMode,
    targetCodec: input.videoOptimizerTargetCodec,
    quality: input.videoOptimizerQuality,
    failIfNotSmaller: input.videoOptimizerFailIfNotSmaller,
    limitVideoSize: input.videoOptimizerLimitVideoSize,
    maximumWidth: input.videoOptimizerMaximumWidth,
    maximumHeight: input.videoOptimizerMaximumHeight,
    noiseReduction: input.videoOptimizerNoiseReduction,
    noiseReductionStrength: input.videoOptimizerNoiseReductionStrength,
    cropLeft: item.cropRect?.left,
    cropTop: item.cropRect?.top,
    cropRight: item.cropRect?.right,
    cropBottom: item.cropRect?.bottom,
    cropTranscode: input.videoOptimizerCropTranscode,
    currentCodec: item.codec,
    scanId,
  }
  return createVideoOptimizerCandidate(options, { shouldCancel: () => runtime.isCancelled?.() ?? false })
}

export function configureKisakiCacheEnvironment(input: { cacheFolderPath?: string; configFolderPath?: string }): void {
  const cacheFolderPath = input.cacheFolderPath?.trim() ?? ""
  const configFolderPath = input.configFolderPath?.trim() ?? ""
  const signature = `${cacheFolderPath}\n${configFolderPath}`
  if (cacheEnvironmentSignature !== undefined && cacheEnvironmentSignature !== signature) throw new Error("Czkawka cache/config folders are initialized by the first native scan; restart the desktop backend after changing them.")
  if (cacheEnvironmentSignature !== undefined) return
  if (cacheFolderPath) process.env.CZKAWKA_CACHE_PATH = cacheFolderPath
  else delete process.env.CZKAWKA_CACHE_PATH
  if (configFolderPath) process.env.CZKAWKA_CONFIG_PATH = configFolderPath
  else delete process.env.CZKAWKA_CONFIG_PATH
  cacheEnvironmentSignature = signature
}

function normalizeProgress(progress: CzkawkaScanProgress): KisakiNativeProgress { return { stage: progress.stage, stageIndex: Number(progress.stageIndex), stageCount: Number(progress.stageCount), entriesChecked: Number(progress.entriesChecked), entriesTotal: Number(progress.entriesTotal), bytesChecked: Number(progress.bytesChecked), bytesTotal: Number(progress.bytesTotal) } }

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if (errorCode(error) === "ENOENT") return false; throw error }
}

async function listDirectory(path: string): Promise<Array<{ path: string; isDirectory: boolean; isFile: boolean }>> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({ path: join(path, entry.name), isDirectory: entry.isDirectory(), isFile: entry.isFile() }))
}

async function removePath(
  path: string,
  options?: { trash?: boolean; emptyFoldersOnly?: boolean },
  fileOperations?: KisakiRuntimeContext["fileOperations"],
): Promise<void> {
  if (options?.emptyFoldersOnly && !await containsOnlyDirectories(path)) throw new Error("Folder contains files and is no longer empty.")
  if (fileOperations) {
    await executeSingleFileMutation(fileOperations, { kind: options?.trash ? "trash" : "delete", sourcePath: path })
    return
  }
  if (options?.trash) {
    await trashPath(path)
    return
  }
  await rm(path, { force: true, recursive: true })
}

async function containsOnlyDirectories(path: string): Promise<boolean> {
  const item = await lstat(path)
  if (!item.isDirectory()) return false
  for (const child of await readdir(path, { withFileTypes: true })) {
    if (!child.isDirectory() || !await containsOnlyDirectories(join(path, child.name))) return false
  }
  return true
}

async function copyPath(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, force: false, errorOnExist: true })
}

async function movePath(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  try { await rename(source, target) } catch (error) {
    if (errorCode(error) !== "EXDEV") throw error
    await copyPath(source, target)
    await rm(source, { recursive: true, force: true })
  }
}

async function linkPath(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await link(source, target)
}

async function replaceWithCandidate(candidatePath: string, sourcePath: string, fileOperations?: KisakiRuntimeContext["fileOperations"]): Promise<void> {
  if (!fileOperations) {
    await trashPath(sourcePath)
    await movePath(candidatePath, sourcePath)
    return
  }
  const result = await fileOperations.execute({
    operations: [
      { kind: "trash", sourcePath },
      { kind: "move", sourcePath: candidatePath, destinationPath: sourcePath },
    ],
    concurrency: 1,
  })
  const failure = result.results.find((entry) => entry.status !== "succeeded")
  if (failure) throw new Error(failure.error ?? `File operation failed: ${failure.operation.kind}`)
}

function errorCode(error: unknown): string | undefined { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined }
