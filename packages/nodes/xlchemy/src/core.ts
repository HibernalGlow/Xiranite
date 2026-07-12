import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type XlchemyAction = "plan" | "convert"
export type XlchemyFormat = "JPEG XL" | "AVIF" | "WebP" | "PNG" | "TIFF" | "JPEG"
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
  metadataMode?: "encoder-wipe" | "encoder-preserve" | "exiftool-wipe" | "exiftool-preserve" | "exiftool-unsafe-wipe"
  keepIfLarger?: boolean
  copyIfLarger?: boolean
  jpegEncoder?: "jpegli" | "libjpeg"
  avifEncoder?: "aom" | "svt"
  avifBitDepth?: "auto" | "8" | "10" | "12"
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
  renameFile: (source: string, target: string) => Promise<void>
  setTimes: (path: string, atimeMs: number, mtimeMs: number) => Promise<void>
  runCommand: (command: string, args: string[]) => Promise<XlchemyCommandResult>
  resolveCommand: (candidates: string[]) => Promise<string | undefined>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
  relative: (from: string, to: string) => string
}

export type XlchemyResult = NodeRunResult<XlchemyData>
export const XL_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".jxl", ".tif", ".tiff", ".bmp"])
const FORMAT_EXTENSIONS: Record<XlchemyFormat, string> = { "JPEG XL": ".jxl", AVIF: ".avif", WebP: ".webp", PNG: ".png", TIFF: ".tiff", JPEG: ".jpg" }

export function normalizeXlchemyInput(input: Partial<XlchemyInput>): XlchemyInput {
  return {
    action: input.action ?? "plan",
    paths: [...new Set((input.paths ?? []).map((path) => path.trim()).filter(Boolean))],
    format: input.format ?? "JPEG XL",
    lossless: input.lossless ?? false,
    quality: clamp(input.quality ?? 90, 1, 100),
    effort: clamp(input.effort ?? 7, 1, 10),
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
    jpegEncoder: input.jpegEncoder ?? "jpegli",
    avifEncoder: input.avifEncoder ?? "aom",
    avifBitDepth: input.avifBitDepth ?? "auto",
    processingOrder: input.processingOrder ?? "original",
    excludedFormats: input.excludedFormats ?? ["avif", "jxl", "webp", "gif"],
    downscale: { enabled: input.downscale?.enabled ?? false, mode: input.downscale?.mode ?? "resolution", width: input.downscale?.width ?? 1920, height: input.downscale?.height ?? 1080, percent: input.downscale?.percent ?? 50, fileSizeKb: input.downscale?.fileSizeKb ?? 500, shortestSide: input.downscale?.shortestSide ?? 1080, longestSide: input.downscale?.longestSide ?? 1920, megapixels: input.downscale?.megapixels ?? 2.1, resample: input.downscale?.resample ?? "default" },
  }
}

export async function runXlchemy(input: XlchemyInput, runtime: XlchemyRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<XlchemyResult> {
  const options = normalizeXlchemyInput(input)
  const started = Date.now()
  try {
    if (!options.paths.length) return failure("At least one image or folder path is required.")
    if (options.outputMode === "directory" && !options.outputDir) return failure("An output directory is required in directory mode.")
    onEvent({ type: "progress", progress: 5, message: "Discovering image inputs." })
    let sources = await discoverImages(options.paths, options.recursive, runtime)
    const excluded = new Set(options.excludedFormats?.map((value) => value.replace(/^\./, "").toLowerCase()) ?? [])
    sources = sources.filter((path) => !excluded.has(runtime.extname(path).slice(1).toLowerCase()))
    if (options.processingOrder === "size-asc" || options.processingOrder === "size-desc") { const sizes = await Promise.all(sources.map(async (path) => ({ path, size: (await runtime.pathInfo(path)).size }))); sources = sizes.sort((a, b) => (a.size - b.size) * (options.processingOrder === "size-desc" ? -1 : 1)).map((item) => item.path) }
    else if (options.processingOrder === "path-asc" || options.processingOrder === "path-desc") sources.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) * (options.processingOrder === "path-desc" ? -1 : 1))
    else if (options.processingOrder === "random") sources = shuffle(sources)
    if (!sources.length) return failure("No supported images were found.")
    const roots = await sourceRoots(options.paths, runtime)
    const planned = await Promise.all(sources.map((source) => planFile(source, roots, options, runtime)))
    if (options.action !== "convert") return success(`Xlchemy planned ${planned.length} image(s).`, summarize(planned, Date.now() - started))

    const files: XlchemyFileResult[] = []
    for (let index = 0; index < planned.length; index += 1) {
      const item = planned[index]!
      if (item.status === "skipped") { files.push(item); continue }
      onEvent({ type: "progress", progress: Math.round(10 + index / planned.length * 85), message: `Converting ${runtime.basename(item.sourcePath)}.` })
      files.push(await convertFile(item, options, runtime))
    }
    const data = summarize(files, Date.now() - started)
    onEvent({ type: "progress", progress: 100, message: `Converted ${data.convertedCount} image(s).` })
    return success(`Xlchemy converted ${data.convertedCount} of ${data.inputCount} image(s).`, data)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
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
  const extension = FORMAT_EXTENSIONS[input.format]
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

async function convertFile(plan: XlchemyFileResult, input: XlchemyInput, runtime: XlchemyRuntime): Promise<XlchemyFileResult> {
  try {
    await runtime.ensureDir(runtime.dirname(plan.outputPath))
    let encoderSource = plan.sourcePath
    const temporarySource = `${plan.outputPath}.xlchemy-input.png`
    if (input.downscale?.enabled) {
      const magick = await runtime.resolveCommand(["magick"])
      if (!magick) throw new Error("ImageMagick is required for downscaling.")
      const resized = await runtime.runCommand(magick, [plan.sourcePath, ...downscaleArgs(input.downscale), temporarySource])
      if (resized.exitCode !== 0) throw new Error(resized.stderr.trim() || "ImageMagick downscaling failed.")
      encoderSource = temporarySource
    }
    const invocation = await encoderInvocation(encoderSource, plan.outputPath, input, runtime)
    const result = await runtime.runCommand(invocation.command, invocation.args)
    if (encoderSource === temporarySource) await runtime.removeFile(temporarySource)
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `${invocation.command} exited with ${result.exitCode}`)
    if (input.format === "JPEG XL" && input.jxlVerify) {
      const decoder = await runtime.resolveCommand(["djxl"])
      if (!decoder) throw new Error("djxl is required for JPEG XL integrity verification.")
      const verificationPath = `${plan.outputPath}.verify.png`
      const verification = await runtime.runCommand(decoder, [plan.outputPath, verificationPath])
      await runtime.removeFile(verificationPath)
      if (verification.exitCode !== 0) throw new Error(verification.stderr.trim() || "JPEG XL integrity verification failed.")
    }
    if (input.preserveMetadata) await copyMetadata(plan.sourcePath, plan.outputPath, runtime)
    const sourceInfo = await runtime.pathInfo(plan.sourcePath)
    if (input.preserveTimestamps) await runtime.setTimes(plan.outputPath, sourceInfo.atimeMs, sourceInfo.mtimeMs)
    const outputInfo = await runtime.pathInfo(plan.outputPath)
    if (input.keepIfLarger && outputInfo.size >= sourceInfo.size) {
      await runtime.removeFile(plan.outputPath)
      if (input.copyIfLarger) await runtime.copyFile(plan.sourcePath, plan.outputPath)
      return { ...plan, status: "skipped", outputBytes: input.copyIfLarger ? sourceInfo.size : 0, error: "output_not_smaller" }
    }
    if (input.deleteOriginal && plan.sourcePath !== plan.outputPath) await runtime.removeFile(plan.sourcePath)
    return { ...plan, status: "converted", outputBytes: outputInfo.size, error: undefined }
  } catch (error) { return { ...plan, status: "error", error: error instanceof Error ? error.message : String(error) } }
}

function downscaleArgs(settings: XlchemyDownscaleSettings): string[] {
  const filter = settings.resample !== "default" ? ["-filter", settings.resample] : []
  if (settings.mode === "resolution") return [...filter, "-resize", `${settings.width}x${settings.height}>`]
  if (settings.mode === "percent") return [...filter, "-resize", `${settings.percent}%`]
  if (settings.mode === "shortest-side") return [...filter, "-resize", `${settings.shortestSide}x${settings.shortestSide}^>`]
  if (settings.mode === "longest-side") return [...filter, "-resize", `${settings.longestSide}x${settings.longestSide}>`]
  if (settings.mode === "megapixels") return [...filter, "-resize", `${Math.round(settings.megapixels * 1_000_000)}@>`]
  return [...filter, "-define", `jpeg:extent=${settings.fileSizeKb}kb`]
}

async function encoderInvocation(source: string, target: string, input: XlchemyInput, runtime: XlchemyRuntime): Promise<{ command: string; args: string[] }> {
  const quality = String(input.quality), effort = String(input.effort), threads = String(input.threads)
  if (input.format === "JPEG XL") return resolved(runtime, ["cjxl"], ["-q", input.lossless ? "100" : quality, "--lossless_jpeg=0", "-e", effort, "--num_threads", threads, ...(!input.lossless && input.jxlModular ? ["--modular=1"] : []), source, target])
  if (input.format === "AVIF") return resolved(runtime, ["avifenc"], ["-q", input.lossless ? "100" : quality, "-s", effort, "-j", threads, ...(input.avifBitDepth && input.avifBitDepth !== "auto" ? ["--bitdepth", input.avifBitDepth] : []), "-c", input.avifEncoder === "svt" ? "svt" : "aom", ...(input.chromaSubsampling && input.chromaSubsampling !== "default" ? ["-y", input.chromaSubsampling] : []), source, target])
  if (input.format === "WebP") return resolved(runtime, ["cwebp"], [source, "-o", target, ...(input.lossless ? ["-lossless"] : ["-q", quality]), "-m", String(Math.min(6, input.effort))])
  if (input.format === "PNG") return resolved(runtime, ["magick"], [source, "-define", `png:compression-level=${Math.min(9, input.effort)}`, target])
  if (input.format === "TIFF") return resolved(runtime, ["magick"], [source, "-compress", input.lossless ? "zip" : "jpeg", "-quality", quality, target])
  if (input.jpegEncoder === "libjpeg") return resolved(runtime, ["magick"], [source, "-quality", quality, ...(input.chromaSubsampling && input.chromaSubsampling !== "default" ? ["-sampling-factor", input.chromaSubsampling] : []), target])
  return resolved(runtime, ["cjpegli"], ["-q", quality, ...(input.chromaSubsampling && input.chromaSubsampling !== "default" ? ["--chroma_subsampling", input.chromaSubsampling] : []), source, target])
}

async function resolved(runtime: XlchemyRuntime, candidates: string[], args: string[]) { const command = await runtime.resolveCommand(candidates); if (!command) throw new Error(`Required encoder not found: ${candidates.join(" or ")}`); return { command, args } }
async function copyMetadata(source: string, target: string, runtime: XlchemyRuntime) { const exiftool = await runtime.resolveCommand(["exiftool"]); if (!exiftool) return; const result = await runtime.runCommand(exiftool, ["-overwrite_original", "-TagsFromFile", source, "-all:all", target]); if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "ExifTool metadata copy failed.") }

function summarize(files: XlchemyFileResult[], elapsedMs: number): XlchemyData { const errors = files.filter((file) => file.status === "error").map((file) => `${file.sourcePath}: ${file.error ?? "error"}`); return { files, inputCount: files.length, convertedCount: files.filter((file) => file.status === "converted").length, skippedCount: files.filter((file) => file.status === "skipped").length, errorCount: errors.length, inputBytes: files.reduce((sum, file) => sum + (file.sourceBytes ?? 0), 0), outputBytes: files.reduce((sum, file) => sum + (file.outputBytes ?? 0), 0), elapsedMs, errors } }
function success(message: string, data: XlchemyData): XlchemyResult { return { success: data.errorCount === 0, message, data } }
function failure(message: string): XlchemyResult { return { success: false, message, data: { files: [], inputCount: 0, convertedCount: 0, skippedCount: 0, errorCount: 1, inputBytes: 0, outputBytes: 0, errors: [message] } } }
export function compressionRatio(data: Pick<XlchemyData, "inputBytes" | "outputBytes">): number { if (data.inputBytes <= 0) return 0; return Math.max(0, Math.min(100, Math.round((1 - data.outputBytes / data.inputBytes) * 1000) / 10)) }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, Math.round(value))) }
function shuffle<T>(values: T[]): T[] { const output = [...values]; for (let index = output.length - 1; index > 0; index -= 1) { const target = Math.floor(Math.random() * (index + 1)); [output[index], output[target]] = [output[target]!, output[index]!] } return output }
