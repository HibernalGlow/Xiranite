import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { cp, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, parse, relative } from "node:path"
import { promisify } from "node:util"
import { cancelCzkawkaScan, getCzkawkaScanProgress, scanBasicFiles, scanDuplicateFiles, scanMediaFiles, type BasicScanOptions, type CzkawkaScanProgress, type DuplicateScanOptions, type MediaScanOptions } from "@xiranite/czkawka-native"
import type { CzkawkaInput, CzkawkaNativeProgress, CzkawkaRuntime } from "./core.js"

type NormalizedInput = Required<CzkawkaInput>
const execFileAsync = promisify(execFile)

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
  const runtime: CzkawkaRuntime = {
    scanDuplicates: (input, onProgress) => runNativeScan(toDuplicateScanOptions(input), input.threadCount, runtime, onProgress, scanDuplicateFiles),
    scanBasic: (input, onProgress) => runNativeScan(toBasicScanOptions(input), input.threadCount, runtime, onProgress, scanBasicFiles),
    scanMedia: (input, onProgress) => runNativeScan(toMediaScanOptions(input), input.threadCount, runtime, onProgress, scanMediaFiles),
    pathExists,
    removePath,
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

function normalizeProgress(progress: CzkawkaScanProgress): CzkawkaNativeProgress { return { stage: progress.stage, stageIndex: Number(progress.stageIndex), stageCount: Number(progress.stageCount), entriesChecked: Number(progress.entriesChecked), entriesTotal: Number(progress.entriesTotal), bytesChecked: Number(progress.bytesChecked), bytesTotal: Number(progress.bytesTotal) } }

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if (errorCode(error) === "ENOENT") return false; throw error }
}

async function removePath(path: string, options?: { trash?: boolean; emptyFoldersOnly?: boolean }): Promise<void> {
  if (options?.emptyFoldersOnly && !await containsOnlyDirectories(path)) throw new Error("Folder contains files and is no longer empty.")
  if (options?.trash) {
    if (process.platform !== "win32") throw new Error("Moving files to trash is currently supported only on Windows.")
    const item = await lstat(path)
    await recycleOnWindows(path, item.isDirectory())
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

async function recycleOnWindows(path: string, isDirectory: boolean): Promise<void> {
  const method = isDirectory ? "DeleteDirectory" : "DeleteFile"
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    "Add-Type -AssemblyName Microsoft.VisualBasic",
    `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}(${quotePowerShell(path)}, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`,
  ].join("; ")
  await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true })
}

function quotePowerShell(value: string): string { return `'${value.replaceAll("'", "''")}'` }
function errorCode(error: unknown): string | undefined { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined }
