import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { DEFAULT_RAM_OPTIMIZER_RULES, isRamOptimizerNecessary, optimizedEncoderThreads, parseRamOptimizationRules } from "./ram-optimizer.js"
export { DEFAULT_RAM_OPTIMIZER_RULES } from "./ram-optimizer.js"

export type XlchemyAction = "plan" | "convert" | "diagnose"
export type XlchemyFormat = "JPEG XL" | "AVIF" | "WebP" | "PNG" | "TIFF" | "JPEG" | "Lossless JPEG Transcoding" | "JPEG Reconstruction" | "Smallest Lossless"
export type XlchemyOutputMode = "source" | "directory"
export type XlchemyExistingPolicy = "replace" | "skip" | "rename"
export type XlchemyDownscaleMode = "resolution" | "percent" | "file-size" | "shortest-side" | "longest-side" | "megapixels"
export interface XlchemyDownscaleSettings { enabled: boolean; mode: XlchemyDownscaleMode; width: number; height: number; percent: number; fileSizeKb: number; shortestSide: number; longestSide: number; megapixels: number; resample: string }

export interface XlchemyInput {
  action?: XlchemyAction
  paths: string[]
  format: XlchemyFormat
  lossless: boolean
  quality: number
  effort: number
  maxCompression?: boolean
  threads: number
  outputMode: XlchemyOutputMode
  outputDir?: string
  preserveMetadata: boolean
  preserveStructure: boolean
  preserveTimestamps?: boolean
  overwrite: boolean
  existingPolicy?: XlchemyExistingPolicy
  recursive: boolean
  deleteOriginal?: boolean
  deleteOriginalMode?: "trash" | "permanent"
  intelligentEffort?: boolean
  jxlModular?: boolean
  jxlVerify?: boolean
  jxlPngFallback?: boolean
  jxlNormalize?: boolean
  jxlNormalizeWhen?: "on-fail" | "always"
  chromaSubsampling?: string
  metadataMode?: "encoder-wipe" | "encoder-preserve" | "exiftool-wipe" | "exiftool-preserve" | "exiftool-unsafe-wipe" | "exiftool-custom"
  keepIfLarger?: boolean
  copyIfLarger?: boolean
  smallestFormatPool?: { png?: boolean; webp?: boolean; jxl?: boolean }
  jpegEncoder?: "jpegli" | "libjpeg"
  avifEncoder?: "aom" | "svt" | "slimg"
  avifBitDepth?: "auto" | "8" | "10" | "12"
  avifAomIqTune?: boolean
  disableProgressiveJpegli?: boolean
  autoLosslessJpeg?: boolean
  enableCustomArgs?: boolean
  cjxlArgs?: string
  avifencArgs?: string
  cjpegliArgs?: string
  imageMagickArgs?: string
  ramOptimizer?: "dynamic" | "static" | "disabled"
  ramOptimizerRules?: string
  exiftoolWipeArgs?: string
  exiftoolPreserveArgs?: string
  exiftoolUnsafeWipeArgs?: string
  exiftoolCustomArgs?: string
  processingOrder?: "original" | "path-asc" | "path-desc" | "size-asc" | "size-desc" | "random" | "sequential"
  excludedFormats?: string[]
  downscale?: XlchemyDownscaleSettings
}

export interface XlchemyFileResult {
  sourcePath: string
  outputPath: string
  sourceBytes?: number
  outputBytes?: number
  status: "planned" | "converted" | "skipped" | "error"
  error?: string
}

export interface XlchemyToolStatus {
  id: string
  label: string
  purpose: string
  path?: string
  available: boolean
  runnable: boolean
  version?: string
  detail?: string
}

export interface XlchemyData {
  files: XlchemyFileResult[]
  inputCount: number
  convertedCount: number
  skippedCount: number
  errorCount: number
  inputBytes: number
  outputBytes: number
  elapsedMs?: number
  errors: string[]
  environment?: XlchemyToolStatus[]
}

export interface XlchemyPathInfo { path: string; exists: boolean; isFile: boolean; isDirectory: boolean; size: number; atimeMs: number; mtimeMs: number }
export interface XlchemyDirEntry { path: string; name: string; isFile: boolean; isDirectory: boolean }
export interface XlchemyCommandResult { exitCode: number; stdout: string; stderr: string }
export interface XlchemyRuntime {
  pathInfo: (path: string) => Promise<XlchemyPathInfo>
  listDir: (path: string) => Promise<XlchemyDirEntry[]>
  ensureDir: (path: string) => Promise<void>
  copyFile: (source: string, target: string) => Promise<void>
  removeFile: (path: string) => Promise<void>
  trashFile?: (path: string) => Promise<void>
  renameFile: (source: string, target: string) => Promise<void>
  setTimes: (path: string, atimeMs: number, mtimeMs: number) => Promise<void>
  hashFile?: (path: string) => Promise<string>
  runCommand: (command: string, args: string[], isCancelled?: () => boolean) => Promise<XlchemyCommandResult>
  isCancelled?: () => boolean
  waitWhilePaused?: () => Promise<void>
  resolveCommand: (candidates: string[]) => Promise<string | undefined>
  probeSlimg?: () => Promise<XlchemyToolStatus>
  convertWithSlimg?: (source: string, target: string, quality: number) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
  relative: (from: string, to: string) => string
}

export type XlchemyResult = NodeRunResult<XlchemyData>
export const XL_IMAGE_EXTENSIONS = new Set([".jxl", ".jpg", ".jpeg", ".jfif", ".jif", ".jpe", ".png", ".apng", ".gif", ".webp", ".jp2", ".bmp", ".ico", ".tiff", ".tif", ".avif"])
const FORMAT_EXTENSIONS: Record<XlchemyFormat, string> = { "JPEG XL": ".jxl", AVIF: ".avif", WebP: ".webp", PNG: ".png", TIFF: ".tiff", JPEG: ".jpg", "Lossless JPEG Transcoding": ".jxl", "JPEG Reconstruction": ".jpg", "Smallest Lossless": ".smallest" }

export function normalizeXlchemyInput(input: Partial<XlchemyInput>): XlchemyInput {
  return {
    action: input.action ?? "plan",
    paths: [...new Set((input.paths ?? []).map((path) => path.trim()).filter(Boolean))],
    format: input.format ?? "JPEG XL",
    lossless: input.lossless ?? false,
    quality: clamp(input.quality ?? 60, 1, 100),
    effort: clamp(input.effort ?? 7, 1, 10),
    maxCompression: input.maxCompression ?? false,
    threads: clamp(input.threads ?? 4, 1, 64),
    outputMode: input.outputMode ?? "source",
    outputDir: input.outputDir?.trim() || undefined,
    preserveMetadata: input.preserveMetadata ?? true,
    preserveStructure: input.preserveStructure ?? true,
    preserveTimestamps: input.preserveTimestamps ?? false,
    overwrite: input.overwrite ?? false,
    existingPolicy: input.existingPolicy ?? (input.overwrite ? "replace" : "skip"),
    recursive: input.recursive ?? true,
    deleteOriginal: input.deleteOriginal ?? false,
    deleteOriginalMode: input.deleteOriginalMode ?? "trash",
    intelligentEffort: input.intelligentEffort ?? false,
    jxlModular: input.jxlModular ?? false,
    jxlVerify: input.jxlVerify ?? false,
    jxlPngFallback: input.jxlPngFallback ?? true,
    jxlNormalize: input.jxlNormalize ?? false,
    jxlNormalizeWhen: input.jxlNormalizeWhen ?? "on-fail",
    chromaSubsampling: input.chromaSubsampling ?? "default",
    metadataMode: input.metadataMode ?? (input.preserveMetadata === false ? "encoder-wipe" : "encoder-preserve"),
    keepIfLarger: input.keepIfLarger ?? false,
    copyIfLarger: input.copyIfLarger ?? false,
    smallestFormatPool: { png: input.smallestFormatPool?.png ?? true, webp: input.smallestFormatPool?.webp ?? true, jxl: input.smallestFormatPool?.jxl ?? true },
    jpegEncoder: input.jpegEncoder ?? "jpegli",
    avifEncoder: input.avifEncoder ?? "aom",
    avifBitDepth: input.avifBitDepth ?? "auto",
    avifAomIqTune: input.avifAomIqTune ?? false,
    disableProgressiveJpegli: input.disableProgressiveJpegli ?? false,
    autoLosslessJpeg: input.autoLosslessJpeg ?? true,
    enableCustomArgs: input.enableCustomArgs ?? false,
    cjxlArgs: input.cjxlArgs?.trim() ?? "",
    avifencArgs: input.avifencArgs?.trim() ?? "",
    cjpegliArgs: input.cjpegliArgs?.trim() ?? "",
    imageMagickArgs: input.imageMagickArgs?.trim() ?? "",
    ramOptimizer: input.ramOptimizer ?? "dynamic",
    ramOptimizerRules: input.ramOptimizerRules?.trim() || DEFAULT_RAM_OPTIMIZER_RULES,
    exiftoolWipeArgs: input.exiftoolWipeArgs?.trim() ?? "",
    exiftoolPreserveArgs: input.exiftoolPreserveArgs?.trim() ?? "",
    exiftoolUnsafeWipeArgs: input.exiftoolUnsafeWipeArgs?.trim() ?? "",
    exiftoolCustomArgs: input.exiftoolCustomArgs?.trim() ?? "",
    processingOrder: input.processingOrder ?? "original",
    excludedFormats: input.excludedFormats ?? ["avif", "jxl", "webp", "gif"],
    downscale: { enabled: input.downscale?.enabled ?? false, mode: input.downscale?.mode ?? "resolution", width: input.downscale?.width ?? 1920, height: input.downscale?.height ?? 1080, percent: input.downscale?.percent ?? 50, fileSizeKb: input.downscale?.fileSizeKb ?? 500, shortestSide: input.downscale?.shortestSide ?? 1080, longestSide: input.downscale?.longestSide ?? 1920, megapixels: input.downscale?.megapixels ?? 2.1, resample: input.downscale?.resample ?? "default" },
  }
}

export async function runXlchemy(input: XlchemyInput, runtime: XlchemyRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<XlchemyResult> {
  const options = normalizeXlchemyInput(input)
  const started = Date.now()
  try {
    if (options.action === "diagnose") return await diagnoseXlchemyEnvironment(runtime, onEvent)
    if (runtime.isCancelled?.()) return cancelled([], started)
    if (!options.paths.length) return failure("At least one image or folder path is required.")
    if (options.outputMode === "directory" && !options.outputDir) return failure("An output directory is required in directory mode.")
    onEvent({ type: "progress", progress: 5, message: "Discovering image inputs." })
    let sources = await discoverImages(options.paths, options.recursive, runtime)
    const excluded = new Set(options.excludedFormats?.map((value) => value.replace(/^\./, "").toLowerCase()) ?? [])
    sources = sources.filter((path) => {
      const extension = runtime.extname(path).slice(1).toLowerCase()
      if (options.format === "JPEG Reconstruction") return extension === "jxl"
      if (options.format === "Lossless JPEG Transcoding") return ["jpg", "jpeg", "jfif", "jif", "jpe"].includes(extension)
      return !excluded.has(extension)
    })
    if (options.processingOrder === "size-asc" || options.processingOrder === "size-desc") { const sizes = await Promise.all(sources.map(async (path) => ({ path, size: (await runtime.pathInfo(path)).size }))); sources = sizes.sort((a, b) => (a.size - b.size) * (options.processingOrder === "size-desc" ? -1 : 1)).map((item) => item.path) }
    else if (options.processingOrder === "path-asc" || options.processingOrder === "path-desc") sources.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) * (options.processingOrder === "path-desc" ? -1 : 1))
    else if (options.processingOrder === "random") sources = shuffle(sources)
    if (!sources.length) return failure("No supported images were found.")
    const roots = await sourceRoots(options.paths, runtime)
    const planned = await Promise.all(sources.map((source) => planFile(source, roots, options, runtime)))
    if (options.action !== "convert") return success(`Xlchemy planned ${planned.length} image(s).`, summarize(planned, Date.now() - started))

    const files: XlchemyFileResult[] = []
    for (let index = 0; index < planned.length; index += 1) {
      await runtime.waitWhilePaused?.()
      if (runtime.isCancelled?.()) return cancelled(files, started)
      const item = planned[index]!
      if (item.status === "skipped") { files.push(item); continue }
      onEvent({ type: "progress", progress: Math.round(10 + index / planned.length * 85), message: `Converting ${runtime.basename(item.sourcePath)}.` })
      files.push(await convertFile(item, options, runtime))
      if (runtime.isCancelled?.()) return cancelled(files, started)
    }
    const data = summarize(files, Date.now() - started)
    onEvent({ type: "progress", progress: 100, message: `Converted ${data.convertedCount} image(s).` })
    return success(`Xlchemy converted ${data.convertedCount} of ${data.inputCount} image(s).`, data)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

const XLCHEMY_TOOLS: Array<{ id: string; label: string; purpose: string; versionArgs: string[] }> = [
  { id: "cjxl", label: "cjxl", purpose: "JPEG XL 编码", versionArgs: ["--version"] },
  { id: "djxl", label: "djxl", purpose: "JPEG XL 解码与校验", versionArgs: ["--version"] },
  { id: "jxlinfo", label: "jxlinfo", purpose: "JPEG XL 信息检查", versionArgs: ["--help"] },
  { id: "cjpegli", label: "cjpegli", purpose: "JPEGli 编码", versionArgs: ["--version"] },
  { id: "magick", label: "ImageMagick", purpose: "PNG/TIFF、缩小与格式回退", versionArgs: ["-version"] },
  { id: "avifenc", label: "avifenc", purpose: "AVIF 编码", versionArgs: ["--version"] },
  { id: "avifdec", label: "avifdec", purpose: "AVIF 解码", versionArgs: ["--version"] },
  { id: "ffmpeg", label: "FFmpeg / SVT-AV1", purpose: "SVT-AV1 AVIF 编码", versionArgs: ["-version"] },
  { id: "cwebp", label: "cwebp", purpose: "WebP 编码", versionArgs: ["-version"] },
  { id: "oxipng", label: "oxipng", purpose: "PNG 无损优化", versionArgs: ["--version"] },
  { id: "exiftool", label: "ExifTool", purpose: "元数据复制与清理", versionArgs: ["-ver"] },
  { id: "jpegtran", label: "jpegtran", purpose: "JPEG 无损变换与重建", versionArgs: ["-version"] },
]

export async function diagnoseXlchemyEnvironment(runtime: XlchemyRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<XlchemyResult> {
  const environment: XlchemyToolStatus[] = []
  for (let index = 0; index < XLCHEMY_TOOLS.length; index += 1) {
    const tool = XLCHEMY_TOOLS[index]!
    onEvent({ type: "progress", progress: Math.round(index / XLCHEMY_TOOLS.length * 100), message: `Checking ${tool.label}.` })
    const path = await runtime.resolveCommand([tool.id])
    if (!path) { environment.push({ id: tool.id, label: tool.label, purpose: tool.purpose, available: false, runnable: false, detail: "PATH 中未找到" }); continue }
    try {
      const check = await runtime.runCommand(path, tool.versionArgs)
      const output = `${check.stdout}\n${check.stderr}`.trim()
      const version = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 160)
      environment.push({ id: tool.id, label: tool.label, purpose: tool.purpose, path, available: true, runnable: check.exitCode === 0 || Boolean(version), version, detail: check.exitCode === 0 ? "命令可执行" : version ? `命令已启动，版本检查退出码 ${check.exitCode}` : `版本检查失败，退出码 ${check.exitCode}` })
    } catch (error) {
      environment.push({ id: tool.id, label: tool.label, purpose: tool.purpose, path, available: true, runnable: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }
  if (runtime.probeSlimg) environment.push(await runtime.probeSlimg())
  else environment.push({ id: "slimg-cffi", label: "slimg CFFI", purpose: "slimg DLL AVIF 编码", available: false, runnable: false, detail: "当前运行时不支持 DLL 检测" })
  onEvent({ type: "progress", progress: 100, message: "Toolchain check complete." })
  const runnable = environment.filter((tool) => tool.runnable).length
  return { success: true, message: `Xlchemy toolchain: ${runnable}/${environment.length} commands runnable.`, data: { files: [], inputCount: 0, convertedCount: 0, skippedCount: 0, errorCount: 0, inputBytes: 0, outputBytes: 0, errors: [], environment } }
}

export async function discoverImages(paths: string[], recursive: boolean, runtime: XlchemyRuntime): Promise<string[]> {
  const output: string[] = []
  for (const path of paths) {
    const info = await runtime.pathInfo(path)
    if (!info.exists) continue
    if (info.isFile && XL_IMAGE_EXTENSIONS.has(runtime.extname(info.path).toLowerCase())) output.push(info.path)
    if (info.isDirectory) {
      const entries = await runtime.listDir(info.path)
      for (const entry of entries) {
        if (entry.isFile && XL_IMAGE_EXTENSIONS.has(runtime.extname(entry.path).toLowerCase())) output.push(entry.path)
        else if (recursive && entry.isDirectory) output.push(...await discoverImages([entry.path], true, runtime))
      }
    }
  }
  return [...new Set(output)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
}

async function sourceRoots(paths: string[], runtime: XlchemyRuntime): Promise<string[]> {
  const roots: string[] = []
  for (const path of paths) { const info = await runtime.pathInfo(path); if (info.exists) roots.push(info.isDirectory ? info.path : runtime.dirname(info.path)) }
  return roots
}

async function planFile(sourcePath: string, roots: string[], input: XlchemyInput, runtime: XlchemyRuntime): Promise<XlchemyFileResult> {
  const source = await runtime.pathInfo(sourcePath)
  const root = roots.find((candidate) => source.path === candidate || source.path.startsWith(`${candidate}\\`) || source.path.startsWith(`${candidate}/`)) ?? runtime.dirname(source.path)
  const targetRoot = input.outputMode === "directory" ? input.outputDir! : runtime.dirname(source.path)
  const relativeDir = input.outputMode === "directory" && input.preserveStructure ? runtime.dirname(runtime.relative(root, source.path)) : ""
  let extension = FORMAT_EXTENSIONS[input.format]
  if (input.format === "JPEG Reconstruction") extension = await jpegReconstructionExtension(source.path, input, runtime)
  const sourceExtension = runtime.extname(source.path)
  const stem = runtime.basename(source.path).slice(0, -sourceExtension.length)
  let outputPath = runtime.join(targetRoot, relativeDir === "." ? "" : relativeDir, `${stem}${extension}`)
  const existing = await runtime.pathInfo(outputPath)
  if (existing.exists && input.existingPolicy === "skip") return { sourcePath: source.path, outputPath, sourceBytes: source.size, status: "skipped", error: "target_exists" }
  if (existing.exists && input.existingPolicy === "rename") outputPath = await uniqueTarget(outputPath, runtime)
  return { sourcePath: source.path, outputPath, sourceBytes: source.size, status: "planned" }
}

async function uniqueTarget(path: string, runtime: XlchemyRuntime): Promise<string> {
  const ext = runtime.extname(path), stem = path.slice(0, -ext.length)
  for (let index = 1; index < 10_000; index += 1) { const candidate = `${stem}_${index}${ext}`; if (!(await runtime.pathInfo(candidate)).exists) return candidate }
  throw new Error(`Unable to allocate a unique output path for ${path}`)
}

async function jpegReconstructionExtension(source: string, input: XlchemyInput, runtime: XlchemyRuntime): Promise<".jpg" | ".png"> {
  const jxlinfo = await runtime.resolveCommand(["jxlinfo"])
  if (!jxlinfo) throw new Error("jxlinfo is required to inspect JPEG reconstruction data.")
  const info = await runRuntimeCommand(runtime, jxlinfo, [source])
  if (info.exitCode !== 0) throw new Error(info.stderr.trim() || "Unable to inspect JPEG XL reconstruction data.")
  if (`${info.stdout}\n${info.stderr}`.includes("JPEG bitstream reconstruction data available")) return ".jpg"
  if (input.jxlPngFallback) return ".png"
  throw new Error("JPEG reconstruction data was not found. Enable PNG fallback to decode this JPEG XL image.")
}

async function convertFile(plan: XlchemyFileResult, input: XlchemyInput, runtime: XlchemyRuntime): Promise<XlchemyFileResult> {
  try {
    await runtime.ensureDir(runtime.dirname(plan.outputPath))
    if (input.format === "Smallest Lossless") return await convertSmallestLossless(plan, input, runtime)
    let encoderSource = plan.sourcePath
    const temporarySource = `${plan.outputPath}.xlchemy-input.png`
    const normalizedJpeg = `${plan.outputPath}.xlchemy-normalized.jpg`
    if (input.downscale?.enabled && input.downscale.mode !== "file-size") {
      const magick = await runtime.resolveCommand(["magick"])
      if (!magick) throw new Error("ImageMagick is required for downscaling.")
      const resized = await runRuntimeCommand(runtime, magick, [plan.sourcePath, ...downscaleArgs(input.downscale), temporarySource])
      if (resized.exitCode !== 0) throw new Error(resized.stderr.trim() || "ImageMagick downscaling failed.")
      encoderSource = temporarySource
    }
    const normalizeLosslessJpeg = shouldNormalizeLosslessJpeg(encoderSource, input, runtime)
    if (normalizeLosslessJpeg && input.jxlNormalize && input.jxlNormalizeWhen === "always") encoderSource = await normalizeJpegSource(encoderSource, normalizedJpeg, runtime)
    let result: XlchemyCommandResult
    if (input.downscale?.enabled && input.downscale.mode === "file-size") {
      const sized = await runTargetSizeConversion(plan.sourcePath, plan.outputPath, input, runtime)
      result = sized.result
      encoderSource = sized.encoderSource
    } else result = input.format === "JPEG XL" && input.intelligentEffort && !input.lossless && !input.jxlModular
      ? await runIntelligentJxlComparison(encoderSource, plan.outputPath, input, runtime)
      : await runEncoderConversion(encoderSource, plan.outputPath, input, runtime)
    if (result.exitCode !== 0 && normalizeLosslessJpeg && input.jxlNormalize && input.jxlNormalizeWhen === "on-fail") {
      if ((await runtime.pathInfo(plan.outputPath)).exists) await runtime.removeFile(plan.outputPath)
      encoderSource = await normalizeJpegSource(encoderSource, normalizedJpeg, runtime)
      result = await runEncoderConversion(encoderSource, plan.outputPath, input, runtime)
    }
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `Encoder exited with ${result.exitCode}`)
    if ((input.format === "JPEG XL" || input.format === "Lossless JPEG Transcoding") && input.jxlVerify) await verifyJxlOutput(plan.outputPath, encoderSource, input, runtime)
    if (encoderSource === temporarySource) await runtime.removeFile(temporarySource)
    if ((await runtime.pathInfo(normalizedJpeg)).exists) await runtime.removeFile(normalizedJpeg)
    if (input.metadataMode?.startsWith("exiftool")) await applyExifToolMetadata(plan.sourcePath, plan.outputPath, input, runtime)
    else if (input.metadataMode === "encoder-preserve") await copyMetadata(plan.sourcePath, plan.outputPath, runtime)
    const sourceInfo = await runtime.pathInfo(plan.sourcePath)
    if (input.preserveTimestamps) await runtime.setTimes(plan.outputPath, sourceInfo.atimeMs, sourceInfo.mtimeMs)
    const outputInfo = await runtime.pathInfo(plan.outputPath)
    if (input.keepIfLarger && outputInfo.size >= sourceInfo.size) {
      await runtime.removeFile(plan.outputPath)
      if (input.copyIfLarger) await runtime.copyFile(plan.sourcePath, plan.outputPath)
      return { ...plan, status: "skipped", outputBytes: input.copyIfLarger ? sourceInfo.size : 0, error: "output_not_smaller" }
    }
    if (input.deleteOriginal && plan.sourcePath !== plan.outputPath) {
      if (input.deleteOriginalMode === "trash") {
        if (!runtime.trashFile) throw new Error("The current runtime does not support moving files to the recycle bin.")
        await runtime.trashFile(plan.sourcePath)
      } else await runtime.removeFile(plan.sourcePath)
    }
    return { ...plan, status: "converted", outputBytes: outputInfo.size, error: undefined }
  } catch (error) { return { ...plan, status: "error", error: error instanceof Error ? error.message : String(error) } }
}

async function convertSmallestLossless(plan: XlchemyFileResult, input: XlchemyInput, runtime: XlchemyRuntime): Promise<XlchemyFileResult> {
  const pool = input.smallestFormatPool ?? { png: true, webp: true, jxl: true }
  const enabled = (["png", "webp", "jxl"] as const).filter((format) => pool[format] !== false)
  if (!enabled.length) throw new Error("Smallest Lossless requires at least one format in the comparison pool.")
  const threads = String(await optimizedThreads(plan.sourcePath, input, runtime))
  const effort = String(input.maxCompression ? 9 : Math.min(9, input.effort))
  const candidates: Array<{ format: "png" | "webp" | "jxl"; path: string; size: number }> = []
  try {
    for (const format of enabled) {
      const path = `${plan.outputPath}.${format}`
      let command: string, args: string[]
      if (format === "png") {
        command = await requireCommand(runtime, ["magick"])
        args = [plan.sourcePath, "-define", `png:compression-level=${effort}`, path]
      } else if (format === "webp") {
        command = await requireCommand(runtime, ["cwebp"])
        args = [plan.sourcePath, "-o", path, "-lossless", "-m", "6", "-mt"]
      } else {
        command = await requireCommand(runtime, ["cjxl"])
        const jpegSource = [".jpg", ".jpeg", ".jfif", ".jif", ".jpe"].includes(runtime.extname(plan.sourcePath).toLowerCase())
        args = ["-q", "100", "-e", effort, "--num_threads", threads, `--lossless_jpeg=${jpegSource && input.autoLosslessJpeg ? 1 : 0}`, plan.sourcePath, path]
      }
      const result = await runRuntimeCommand(runtime, command, args)
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `${format} comparison encoder failed.`)
      const info = await runtime.pathInfo(path)
      if (!info.exists || !info.isFile) throw new Error(`${format} comparison encoder did not create an output.`)
      candidates.push({ format, path, size: info.size })
    }
    const winner = candidates.reduce((smallest, candidate) => candidate.size < smallest.size ? candidate : smallest)
    let outputPath = plan.outputPath.slice(0, -".smallest".length) + `.${winner.format}`
    const existing = await runtime.pathInfo(outputPath)
    if (existing.exists && input.existingPolicy === "skip") return { ...plan, outputPath, status: "skipped", error: "target_exists" }
    if (existing.exists && input.existingPolicy === "rename") outputPath = await uniqueTarget(outputPath, runtime)
    else if (existing.exists) await runtime.removeFile(outputPath)
    for (const candidate of candidates) if (candidate.path !== winner.path) await runtime.removeFile(candidate.path)
    await runtime.renameFile(winner.path, outputPath)
    if (input.metadataMode?.startsWith("exiftool")) await applyExifToolMetadata(plan.sourcePath, outputPath, input, runtime)
    else if (input.metadataMode === "encoder-preserve") await copyMetadata(plan.sourcePath, outputPath, runtime)
    const sourceInfo = await runtime.pathInfo(plan.sourcePath)
    if (input.preserveTimestamps) await runtime.setTimes(outputPath, sourceInfo.atimeMs, sourceInfo.mtimeMs)
    if (input.deleteOriginal && plan.sourcePath !== outputPath) {
      if (input.deleteOriginalMode === "trash") {
        if (!runtime.trashFile) throw new Error("The current runtime does not support moving files to the recycle bin.")
        await runtime.trashFile(plan.sourcePath)
      } else await runtime.removeFile(plan.sourcePath)
    }
    return { ...plan, outputPath, status: "converted", outputBytes: winner.size, error: undefined }
  } finally {
    for (const candidate of candidates) {
      if ((await runtime.pathInfo(candidate.path)).exists) await runtime.removeFile(candidate.path)
    }
  }
}

async function requireCommand(runtime: XlchemyRuntime, candidates: string[]) { const command = await runtime.resolveCommand(candidates); if (!command) throw new Error(`Required encoder not found: ${candidates.join(" or ")}`); return command }

function shouldNormalizeLosslessJpeg(source: string, input: XlchemyInput, runtime: XlchemyRuntime): boolean {
  const jpeg = [".jpg", ".jpeg", ".jfif", ".jif", ".jpe"].includes(runtime.extname(source).toLowerCase())
  return jpeg && (input.format === "Lossless JPEG Transcoding" || input.format === "JPEG XL" && input.autoLosslessJpeg !== false)
}

async function normalizeJpegSource(source: string, target: string, runtime: XlchemyRuntime): Promise<string> {
  const jpegtran = await requireCommand(runtime, ["jpegtran"])
  const result = await runRuntimeCommand(runtime, jpegtran, ["-copy", "all", "-optimize", "-outfile", target, source])
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "JPEG normalization failed.")
  const output = await runtime.pathInfo(target)
  if (!output.exists || !output.isFile) throw new Error("JPEG normalization did not create an output file.")
  return target
}

async function verifyJxlOutput(output: string, encodedSource: string, input: XlchemyInput, runtime: XlchemyRuntime): Promise<void> {
  const decoder = await requireCommand(runtime, ["djxl"])
  const reconstructsJpeg = shouldNormalizeLosslessJpeg(encodedSource, input, runtime)
  const verificationPath = `${output}.verify.${reconstructsJpeg ? "jpg" : "png"}`
  const verification = await runRuntimeCommand(runtime, decoder, ["--num_threads", String(input.threads), output, verificationPath])
  if (verification.exitCode !== 0) { if ((await runtime.pathInfo(verificationPath)).exists) await runtime.removeFile(verificationPath); throw new Error(verification.stderr.trim() || "JPEG XL integrity verification failed.") }
  try {
    if (reconstructsJpeg) {
      if (!runtime.hashFile) throw new Error("The current runtime does not support JPEG reconstruction checksum verification.")
      const [sourceHash, reconstructedHash] = await Promise.all([runtime.hashFile(encodedSource), runtime.hashFile(verificationPath)])
      if (sourceHash !== reconstructedHash) throw new Error(`JPEG XL reconstruction checksum mismatch (${sourceHash} != ${reconstructedHash}).`)
    }
  } finally { await runtime.removeFile(verificationPath) }
}

function downscaleArgs(settings: XlchemyDownscaleSettings): string[] {
  const filter = settings.resample !== "default" ? ["-filter", settings.resample] : []
  if (settings.mode === "resolution") return [...filter, "-resize", `${settings.width}x${settings.height}>`]
  if (settings.mode === "percent") return [...filter, "-resize", `${settings.percent}%`]
  if (settings.mode === "shortest-side") return [...filter, "-resize", `${settings.shortestSide}x${settings.shortestSide}^>`]
  if (settings.mode === "longest-side") return [...filter, "-resize", `${settings.longestSide}x${settings.longestSide}>`]
  if (settings.mode === "megapixels") return [...filter, "-resize", `${Math.round(settings.megapixels * 1_000_000)}@>`]
  throw new Error("Target file size downscaling requires encoder feedback.")
}

async function runTargetSizeConversion(source: string, target: string, input: XlchemyInput, runtime: XlchemyRuntime): Promise<{ result: XlchemyCommandResult; encoderSource: string }> {
  const settings = input.downscale!
  const magick = await requireCommand(runtime, ["magick"])
  const proxy = `${target}.xlchemy-input.png`
  const targetBytes = settings.fileSizeKb * 1024
  const toleranceBytes = targetBytes * 1.1
  const samples: Array<[number, number]> = []
  const resizeAndEncode = async (percent: number): Promise<XlchemyCommandResult> => {
    const filter = settings.resample !== "default" ? ["-filter", settings.resample] : []
    const resized = await runRuntimeCommand(runtime, magick, [source, ...filter, "-resize", `${Math.max(1, Math.min(100, Math.round(percent)))}%`, proxy])
    if (resized.exitCode !== 0) return resized
    return runEncoderConversion(proxy, target, input, runtime)
  }
  for (const percent of [66, 33]) {
    const result = await resizeAndEncode(percent)
    if (result.exitCode !== 0) return { result, encoderSource: proxy }
    samples.push([(await runtime.pathInfo(target)).size, percent])
  }
  const [[sizeA, percentA], [sizeB, percentB]] = samples
  const slope = sizeA === sizeB ? 0 : (percentA - percentB) / (sizeA - sizeB)
  let percent = slope === 0 ? (sizeB <= targetBytes ? 100 : 33) : Math.floor(slope * targetBytes + (percentA - slope * sizeA))
  if (percent >= 100) {
    await runtime.removeFile(proxy)
    return { result: await runEncoderConversion(source, target, input, runtime), encoderSource: source }
  }
  percent = Math.max(1, percent)
  let result: XlchemyCommandResult = { exitCode: 1, stdout: "", stderr: "Target-size conversion did not run." }
  while (percent >= 1) {
    result = await resizeAndEncode(percent)
    if (result.exitCode !== 0 || (await runtime.pathInfo(target)).size <= toleranceBytes) break
    percent = Math.max(1, percent - 10)
    if (percent === 1) { result = await resizeAndEncode(percent); break }
  }
  return { result, encoderSource: proxy }
}

async function encoderInvocation(source: string, target: string, input: XlchemyInput, runtime: XlchemyRuntime): Promise<{ command: string; args: string[] }> {
  const quality = String(input.quality), effort = String(input.intelligentEffort && input.format === "JPEG XL" && (input.lossless || input.jxlModular) ? 9 : input.maxCompression ? 10 : input.effort), threads = String(await optimizedThreads(source, input, runtime))
  const custom = (value?: string) => input.enableCustomArgs ? splitCommandArgs(value ?? "") : []
  const sourceExt = runtime.extname(source).toLowerCase(), jpegSource = [".jpg", ".jpeg", ".jfif", ".jif", ".jpe"].includes(sourceExt)
  if (input.format === "Lossless JPEG Transcoding") return resolved(runtime, ["cjxl"], ["--lossless_jpeg=1", "-e", effort, "--num_threads", threads, ...custom(input.cjxlArgs), source, target])
  if (input.format === "JPEG Reconstruction") return resolved(runtime, ["djxl"], ["--num_threads", threads, source, target])
  if (input.format === "JPEG XL") { const losslessJpeg = jpegSource && input.autoLosslessJpeg; return resolved(runtime, ["cjxl"], ["-q", input.lossless || losslessJpeg ? "100" : quality, `--lossless_jpeg=${losslessJpeg ? 1 : 0}`, "-e", effort, "--num_threads", threads, ...(!input.lossless && !losslessJpeg && input.jxlModular ? ["--modular=1"] : []), ...custom(input.cjxlArgs), source, target]) }
  if (input.format === "AVIF" && input.avifEncoder === "svt") {
    const crf = input.lossless ? 0 : Math.round((100 - input.quality) * 0.63)
    const preset = input.maxCompression ? 0 : 13 - Math.round((input.effort - 1) * 13 / 9)
    const pixelFormat = input.avifBitDepth === "10" || input.avifBitDepth === "12" ? "yuv420p10le" : "yuv420p"
    return resolved(runtime, ["ffmpeg"], ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-frames:v", "1", "-c:v", "libsvtav1", "-preset", String(preset), "-crf", String(crf), "-threads", threads, "-pix_fmt", pixelFormat, "-f", "avif", target])
  }
  if (input.format === "AVIF") return resolved(runtime, ["avifenc"], ["-q", input.lossless ? "100" : quality, "-s", effort, "-j", threads, ...(input.avifBitDepth && input.avifBitDepth !== "auto" ? ["--bitdepth", input.avifBitDepth] : []), "-c", "aom", ...(input.avifAomIqTune ? ["-a", "tune=iq"] : []), ...(input.chromaSubsampling && input.chromaSubsampling !== "default" ? ["-y", input.chromaSubsampling] : []), ...custom(input.avifencArgs), source, target])
  if (input.format === "WebP") return resolved(runtime, ["cwebp"], [source, "-o", target, ...(input.lossless ? ["-lossless"] : ["-q", quality]), "-m", String(Math.min(6, input.effort))])
  if (input.format === "PNG") return resolved(runtime, ["magick"], [source, "-define", `png:compression-level=${Math.min(9, input.effort)}`, ...custom(input.imageMagickArgs), target])
  if (input.format === "TIFF") return resolved(runtime, ["magick"], [source, "-compress", input.lossless ? "zip" : "jpeg", "-quality", quality, ...custom(input.imageMagickArgs), target])
  if (input.jpegEncoder === "libjpeg") return resolved(runtime, ["magick"], [source, "-quality", quality, ...(input.chromaSubsampling && input.chromaSubsampling !== "default" ? ["-sampling-factor", input.chromaSubsampling] : []), ...custom(input.imageMagickArgs), target])
  return resolved(runtime, ["cjpegli"], ["-q", quality, ...(input.disableProgressiveJpegli ? ["-p", "0"] : []), ...(input.chromaSubsampling && input.chromaSubsampling !== "default" ? ["--chroma_subsampling", input.chromaSubsampling] : []), ...custom(input.cjpegliArgs), source, target])
}

async function resolved(runtime: XlchemyRuntime, candidates: string[], args: string[]) { const command = await runtime.resolveCommand(candidates); if (!command) throw new Error(`Required encoder not found: ${candidates.join(" or ")}`); return { command, args } }
async function runEncoderConversion(source: string, target: string, input: XlchemyInput, runtime: XlchemyRuntime): Promise<XlchemyCommandResult> { if (input.format === "AVIF" && input.avifEncoder === "slimg") return runSlimgConversion(source, target, input, runtime); const invocation = await encoderInvocation(source, target, input, runtime); return runRuntimeCommand(runtime, invocation.command, invocation.args) }
async function runIntelligentJxlComparison(source: string, target: string, input: XlchemyInput, runtime: XlchemyRuntime): Promise<XlchemyCommandResult> {
  const effort9 = `${target}.effort-9.jxl`
  const effort7Result = await runEncoderConversion(source, target, { ...input, intelligentEffort: false, effort: 7, maxCompression: false }, runtime)
  if (effort7Result.exitCode !== 0 || runtime.isCancelled?.()) return effort7Result
  const effort9Result = await runEncoderConversion(source, effort9, { ...input, intelligentEffort: false, effort: 9, maxCompression: false }, runtime)
  if (effort9Result.exitCode !== 0) { if ((await runtime.pathInfo(effort9)).exists) await runtime.removeFile(effort9); return effort7Result }
  const [effort7Info, effort9Info] = await Promise.all([runtime.pathInfo(target), runtime.pathInfo(effort9)])
  if (effort9Info.exists && effort9Info.size < effort7Info.size) { await runtime.removeFile(target); await runtime.renameFile(effort9, target) }
  else if (effort9Info.exists) await runtime.removeFile(effort9)
  return effort7Result
}
async function runSlimgConversion(source: string, target: string, input: XlchemyInput, runtime: XlchemyRuntime): Promise<XlchemyCommandResult> { if (!runtime.convertWithSlimg) return { exitCode: 1, stdout: "", stderr: "slimg CFFI is not supported by the current runtime." }; try { await runtime.convertWithSlimg(source, target, input.lossless ? 100 : input.quality); return { exitCode: 0, stdout: "slimg CFFI conversion completed.", stderr: "" } } catch (error) { return { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) } } }
async function copyMetadata(source: string, target: string, runtime: XlchemyRuntime) { const exiftool = await runtime.resolveCommand(["exiftool"]); if (!exiftool) return; const result = await runRuntimeCommand(runtime, exiftool, ["-overwrite_original", "-TagsFromFile", source, "-all:all", target]); if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "ExifTool metadata copy failed.") }

async function applyExifToolMetadata(source: string, target: string, input: XlchemyInput, runtime: XlchemyRuntime) {
  const exiftool = await runtime.resolveCommand(["exiftool"])
  if (!exiftool) throw new Error("ExifTool is required by the selected metadata policy.")
  const template = input.metadataMode === "exiftool-preserve" ? input.exiftoolPreserveArgs || '-overwrite_original -TagsFromFile "$src" -all:all "$dst"' : input.metadataMode === "exiftool-unsafe-wipe" ? input.exiftoolUnsafeWipeArgs || '-overwrite_original -all= "$dst"' : input.metadataMode === "exiftool-custom" ? input.exiftoolCustomArgs || '"$dst"' : input.exiftoolWipeArgs || '-overwrite_original -all= --ICC_Profile:all "$dst"'
  const args = splitCommandArgs(template).map((arg) => arg.replaceAll("$src", source).replaceAll("$dst", target))
  const result = await runRuntimeCommand(runtime, exiftool, args)
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "ExifTool metadata operation failed.")
}

async function optimizedThreads(source: string, input: XlchemyInput, runtime: XlchemyRuntime): Promise<number> {
  const mode = input.ramOptimizer ?? "dynamic"
  if (mode === "disabled") return input.threads
  const context = { format: input.format, avifEncoder: input.avifEncoder, jpegXlEffort: input.maxCompression ? 10 : input.effort, jpegXlLossyModular: input.jxlModular ?? false, jpegXlLossless: input.lossless, jpegXlIntelligentEffort: input.intelligentEffort ?? false }
  if (!isRamOptimizerNecessary(context)) return input.threads
  if (mode === "static") return optimizedEncoderThreads(mode, input.threads, 0, context, [])
  const magick = await runtime.resolveCommand(["magick"])
  if (!magick) return input.threads
  const info = await runRuntimeCommand(runtime, magick, ["identify", "-ping", "-format", "%w %h", `${source}[0]`])
  const dimensions = /([0-9]+)\s+([0-9]+)/.exec(info.stdout)
  if (!dimensions) return input.threads
  const megapixels = Number(dimensions[1]) * Number(dimensions[2]) / 1_000_000
  return optimizedEncoderThreads(mode, input.threads, megapixels, context, parseRamOptimizationRules(input.ramOptimizerRules ?? DEFAULT_RAM_OPTIMIZER_RULES))
}
function splitCommandArgs(value: string): string[] {
  const args: string[] = []
  let token = "", quote: "\"" | "'" | undefined, escaped = false
  for (const char of value) {
    if (escaped) { token += char; escaped = false; continue }
    if (char === "\\" && quote === "\"") { escaped = true; continue }
    if (quote) { if (char === quote) quote = undefined; else token += char; continue }
    if (char === "\"" || char === "'") { quote = char; continue }
    if (/\s/.test(char)) { if (token) { args.push(token); token = "" }; continue }
    token += char
  }
  if (escaped) token += "\\"
  if (token) args.push(token)
  return args
}

function summarize(files: XlchemyFileResult[], elapsedMs: number): XlchemyData { const errors = files.filter((file) => file.status === "error").map((file) => `${file.sourcePath}: ${file.error ?? "error"}`); return { files, inputCount: files.length, convertedCount: files.filter((file) => file.status === "converted").length, skippedCount: files.filter((file) => file.status === "skipped").length, errorCount: errors.length, inputBytes: files.reduce((sum, file) => sum + (file.sourceBytes ?? 0), 0), outputBytes: files.reduce((sum, file) => sum + (file.outputBytes ?? 0), 0), elapsedMs, errors } }
function cancelled(files: XlchemyFileResult[], started: number): XlchemyResult { return { success: false, message: "Xlchemy conversion cancelled.", data: summarize(files, Date.now() - started) } }
function runRuntimeCommand(runtime: XlchemyRuntime, command: string, args: string[]) { return runtime.runCommand(command, args, runtime.isCancelled) }
function success(message: string, data: XlchemyData): XlchemyResult { return { success: data.errorCount === 0, message, data } }
function failure(message: string): XlchemyResult { return { success: false, message, data: { files: [], inputCount: 0, convertedCount: 0, skippedCount: 0, errorCount: 1, inputBytes: 0, outputBytes: 0, errors: [message] } } }
export function compressionRatio(data: Pick<XlchemyData, "inputBytes" | "outputBytes">): number { if (data.inputBytes <= 0) return 0; return Math.max(0, Math.min(100, Math.round((1 - data.outputBytes / data.inputBytes) * 1000) / 10)) }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, Math.round(value))) }
function shuffle<T>(values: T[]): T[] { const output = [...values]; for (let index = output.length - 1; index > 0; index -= 1) { const target = Math.floor(Math.random() * (index + 1)); [output[index], output[target]] = [output[target]!, output[index]!] } return output }
