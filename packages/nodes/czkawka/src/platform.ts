import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { cp, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, parse, relative } from "node:path"
import { promisify } from "node:util"
import { cancelCzkawkaScan, createExifCandidate, getCzkawkaInfo, getCzkawkaScanProgress, scanBasicFiles, scanDuplicateFiles, scanExifFiles, scanMediaFiles, trashPath, type BasicScanOptions, type CzkawkaScanProgress, type DuplicateScanOptions, type ExifScanOptions, type MediaScanOptions } from "@xiranite/czkawka-native"
import { executeSingleFileMutation, type FileOperationExecutor } from "@xiranite/file-operations"
import { toNativeVideoCropDetect } from "./similar-video-crop.js"
import type { CzkawkaNativeProgress, CzkawkaNormalizedInput, CzkawkaRuntime, CzkawkaRuntimeInfo } from "./core.js"

type NormalizedInput = CzkawkaNormalizedInput
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

export interface CzkawkaRuntimeContext {
  fileOperations?: FileOperationExecutor
}

export function getNodeRuntimeInfo(): CzkawkaRuntimeInfo {
  const info = getCzkawkaInfo()
  return { apiVersion: info.apiVersion, sourceVersion: info.sourceVersion, capabilities: [...info.capabilities] }
}

export function createNodeCzkawkaRuntime(context: CzkawkaRuntimeContext = {}): CzkawkaRuntime {
  const nativeInfo = getNodeRuntimeInfo()
  const runtime: CzkawkaRuntime = {
    capabilities: nativeInfo.capabilities,
    scanDuplicates: (input, onProgress) => { configureCzkawkaCacheEnvironment(input); return runNativeScan(toDuplicateScanOptions(input), input.threadCount, runtime, onProgress, scanDuplicateFiles) },
    scanBasic: (input, onProgress) => { configureCzkawkaCacheEnvironment(input); return runNativeScan(toBasicScanOptions(input), input.threadCount, runtime, onProgress, scanBasicFiles) },
    scanExif: (input, onProgress) => { configureCzkawkaCacheEnvironment(input); return runNativeScan(toExifScanOptions(input), input.threadCount, runtime, onProgress, scanExifFiles) },
    scanMedia: (input, onProgress) => { configureCzkawkaCacheEnvironment(input); return runNativeScan(toMediaScanOptions(input), input.threadCount, runtime, onProgress, scanMediaFiles) },
    createExifCandidate: (sourcePath, tags) => createExifCandidate({ sourcePath, tags }),
    replaceWithCandidate: (candidatePath, sourcePath) => replaceWithCandidate(candidatePath, sourcePath, context.fileOperations),
    pathExists,
    removePath: (path, options) => removePath(path, options, context.fileOperations),
    copyPath,
    movePath,
    writeText: async (path, content) => { await writeFile(path, content, "utf8") },
    ensureDirectory: async (path) => { if (path) await mkdir(path, { recursive: true }) },
    join,
    dirname,
    basename,
    relativeDirectoryFromRoot: (path) => relative(parse(path).root, dirname(path)),
  }
  return runtime
}

export async function openCzkawkaPath(path: string): Promise<void> {
  const entry = await lstat(path)
  if (process.platform === "win32") {
    if (entry.isDirectory()) await execFileAsync("explorer.exe", [path])
    else await execFileAsync("rundll32.exe", ["url.dll,FileProtocolHandler", path])
    return
  }
  await execFileAsync(process.platform === "darwin" ? "open" : "xdg-open", [path])
}

async function runNativeScan<TOptions extends object, TResult>(options: TOptions, threadCount: number, runtime: CzkawkaRuntime, onProgress: ((progress: CzkawkaNativeProgress) => void) | undefined, scan: (options: TOptions & { scanId: string; threadCount: number }) => Promise<TResult>): Promise<TResult> {
  const scanId = randomUUID()
  let lastProgress = ""
  const publish = () => { const progress = getCzkawkaScanProgress(scanId); if (!progress) return; const signature = `${progress.stage}:${progress.stageIndex}:${progress.entriesChecked}:${progress.bytesChecked}`; if (signature === lastProgress) return; lastProgress = signature; onProgress?.(normalizeProgress(progress)) }
  const timer = setInterval(() => { if (runtime.isCancelled?.()) cancelCzkawkaScan(scanId); publish() }, 100)
  timer.unref()
  try {
    const pending = scan({ ...options, scanId, threadCount })
    if (runtime.isCancelled?.()) cancelCzkawkaScan(scanId)
    return await pending
  } finally { publish(); clearInterval(timer) }
}

export function configureCzkawkaCacheEnvironment(input: { cacheFolderPath?: string; configFolderPath?: string }): void {
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

function normalizeProgress(progress: CzkawkaScanProgress): CzkawkaNativeProgress { return { stage: progress.stage, stageIndex: Number(progress.stageIndex), stageCount: Number(progress.stageCount), entriesChecked: Number(progress.entriesChecked), entriesTotal: Number(progress.entriesTotal), bytesChecked: Number(progress.bytesChecked), bytesTotal: Number(progress.bytesTotal) } }

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if (errorCode(error) === "ENOENT") return false; throw error }
}

async function removePath(
  path: string,
  options?: { trash?: boolean; emptyFoldersOnly?: boolean },
  fileOperations?: CzkawkaRuntimeContext["fileOperations"],
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

async function replaceWithCandidate(candidatePath: string, sourcePath: string, fileOperations?: CzkawkaRuntimeContext["fileOperations"]): Promise<void> {
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
