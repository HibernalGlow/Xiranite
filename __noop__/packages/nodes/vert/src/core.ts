import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type VertAction = "status" | "plan" | "convert"
export type VertEnginePreference = "auto" | "cli" | "wasm"
export type VertConverter = "ffmpeg" | "magick" | "pandoc"
export type VertFormatCategory = "image" | "audio" | "video" | "document" | "unknown"

export interface VertInput {
  action?: VertAction
  paths?: string[]
  targetFormat?: string
  outputDirectory?: string
  engine?: VertEnginePreference
  overwrite?: boolean
  quality?: number
  deleteSourceAfterSuccess?: boolean
}

export interface VertCommandPlan {
  converter: VertConverter
  command: string
  args: string[]
  inputPath: string
  outputPath: string
}

export interface VertCommandResult {
  code: number
  stdout: string
  stderr: string
  durationMs: number
  outputPath?: string
}

export interface VertCapabilities {
  ffmpeg?: string
  magick?: string
  pandoc?: string
  wasm: true
}

export interface VertData {
  capabilities: VertCapabilities
  commands: VertCommandPlan[]
  commandResults: VertCommandResult[]
  selectedPaths: string[]
  outputPaths: string[]
  errors: string[]
  engineUsed?: "cli" | "wasm"
  wasmFallbackRequired: boolean
}

export interface VertRuntime {
  discoverCommands: () => Promise<VertCapabilities>
  runCommand: (plan: VertCommandPlan) => Promise<VertCommandResult>
  pathExists: (path: string) => Promise<boolean>
  removeFile?: (path: string) => Promise<void>
}

export type VertResult = NodeRunResult<VertData>

export const VERT_IMAGE_FORMATS = [
  "png", "jpeg", "jpg", "jpe", "jfif", "webp", "gif", "svg", "jxl", "avif", "ico", "bmp", "cur", "hdr", "tif", "tiff", "psd", "psb", "qoi", "dds", "exr", "jp2", "tga", "ppm", "pgm", "pbm", "pfm", "pnm", "pam", "mat", "fit", "fits", "eps",
] as const
export const VERT_IMAGE_INPUT_FORMATS = [
  ...VERT_IMAGE_FORMATS, "heic", "heif", "ani", "icns", "nef", "cr2", "cr3", "crw", "arw", "dng", "xcf", "rw2", "raf", "orf", "pef", "mos", "raw", "dcr", "3fr", "erf", "mrw", "mef", "nrw", "srw", "sr2", "srf",
] as const
export const VERT_AUDIO_FORMATS = [
  "mp3", "wav", "flac", "ogg", "oga", "opus", "aac", "alac", "m4a", "wma", "amr", "ac3", "aiff", "aifc", "aif", "mp2", "au", "m4b", "voc", "weba",
] as const
export const VERT_AUDIO_INPUT_FORMATS = [...VERT_AUDIO_FORMATS, "mogg", "caf", "mp1", "mpc", "dsd", "dsf", "dff", "mqa"] as const
export const VERT_VIDEO_FORMATS = [
  "mkv", "mp4", "avi", "mov", "webm", "ts", "mts", "m2ts", "wmv", "mpg", "mpeg", "flv", "f4v", "vob", "m4v", "3gp", "3g2", "mxf", "ogv", "rm", "rmvb", "divx",
] as const
export const VERT_DOCUMENT_FORMATS = ["docx", "doc", "md", "markdown", "html", "rtf", "csv", "tsv", "json", "rst", "epub", "odt", "docbook"] as const
export const VERT_FORMAT_GROUPS = {
  image: VERT_IMAGE_FORMATS,
  audio: VERT_AUDIO_FORMATS,
  video: VERT_VIDEO_FORMATS,
  document: VERT_DOCUMENT_FORMATS,
} as const
export const VERT_INPUT_FORMAT_GROUPS = {
  image: VERT_IMAGE_INPUT_FORMATS,
  audio: VERT_AUDIO_INPUT_FORMATS,
  video: VERT_VIDEO_FORMATS,
  document: VERT_DOCUMENT_FORMATS,
} as const

const imageFormats = new Set<string>(VERT_IMAGE_INPUT_FORMATS)
const audioFormats = new Set<string>(VERT_AUDIO_INPUT_FORMATS)
const videoFormats = new Set<string>(VERT_VIDEO_FORMATS)
const mediaFormats = new Set<string>([...VERT_AUDIO_FORMATS, ...VERT_VIDEO_FORMATS])
const documentFormats = new Set<string>(VERT_DOCUMENT_FORMATS)

export function normalizeFormat(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/^\./, "")
}

export function detectVertCategory(pathOrFormat: string): VertFormatCategory {
  const clean = pathOrFormat.includes("/") || pathOrFormat.includes("\\") || pathOrFormat.includes(".") ? extension(pathOrFormat) || normalizeFormat(pathOrFormat) : normalizeFormat(pathOrFormat)
  if (imageFormats.has(clean)) return "image"
  if (audioFormats.has(clean)) return "audio"
  if (videoFormats.has(clean)) return "video"
  if (documentFormats.has(clean)) return "document"
  return "unknown"
}

export function chooseConverter(inputPath: string, targetFormat: string): VertConverter {
  const target = normalizeFormat(targetFormat)
  const source = extension(inputPath)
  if (documentFormats.has(target) || documentFormats.has(source)) return "pandoc"
  if (imageFormats.has(target) && !mediaFormats.has(source)) return "magick"
  if (mediaFormats.has(target) || mediaFormats.has(source)) return "ffmpeg"
  if (imageFormats.has(target)) return "magick"
  throw new Error(`Unsupported target format: .${target || "?"}`)
}

export function createVertPlans(input: VertInput, capabilities: VertCapabilities): VertCommandPlan[] {
  const target = normalizeFormat(input.targetFormat)
  if (!target) throw new Error("Choose a target format.")
  return uniquePaths(input.paths).map((inputPath) => {
    const converter = chooseConverter(inputPath, target)
    const command = capabilities[converter] ?? converterCommand(converter)
    const outputPath = deriveOutputPath(inputPath, target === "alac" ? "m4a" : target, input.outputDirectory)
    const args = converter === "ffmpeg"
      ? createFfmpegArgs(inputPath, outputPath, input.overwrite ?? false, target)
      : converter === "magick"
        ? [inputPath, ...(Number.isFinite(input.quality) ? ["-quality", String(clampQuality(input.quality))] : []), ...(target === "ico" ? ["-resize", "256x256>"] : []), outputPath]
        : [inputPath, "-o", outputPath, "--extract-media=."]
    return { converter, command, args, inputPath, outputPath }
  })
}

export function createFfmpegArgs(inputPath: string, outputPath: string, overwrite = false, requestedTarget?: string): string[] {
  const sourceCategory = detectVertCategory(inputPath)
  const outputContainer = extension(outputPath)
  const target = normalizeFormat(requestedTarget) || extension(outputPath)
  const targetCategory = detectVertCategory(target)
  const codecs = ffmpegCodecs(target)
  const overwriteArgs = [overwrite ? "-y" : "-n"]
  if (sourceCategory === "video" && targetCategory === "audio") return [...overwriteArgs, "-i", inputPath, "-map", "0:a:0", "-vn", "-c:a", codecs.audio, ...(target === "opus" ? ["-ar", "48000"] : []), outputPath]
  if (sourceCategory === "audio" && targetCategory === "video") return [...overwriteArgs, "-f", "lavfi", "-i", "color=c=black:s=512x512:rate=1", "-i", inputPath, "-shortest", "-pix_fmt", "yuv420p", "-r", "1", "-c:v", codecs.video, "-c:a", codecs.audio, ...ffmpegContainerArgs(target), outputPath]
  if (targetCategory === "video") return [...overwriteArgs, "-i", inputPath, "-c:v", codecs.video, "-c:a", codecs.audio, ...ffmpegContainerArgs(target), outputPath]
  return [...overwriteArgs, "-i", inputPath, ...(outputContainer === "m4a" ? ["-map", "0:a:0", "-map", "0:v?", "-c:v", "copy"] : []), "-c:a", codecs.audio, ...(target === "opus" ? ["-ar", "48000"] : []), outputPath]
}

export function withFfmpegCoverArt(args: string[], coverPath: string): string[] {
  const colorIndex = args.indexOf("color=c=black:s=512x512:rate=1")
  if (colorIndex < 0 || args[colorIndex - 1] !== "-i") return args
  const inputFlagIndex = colorIndex + 1
  if (args[inputFlagIndex] !== "-i" || !args[inputFlagIndex + 1]) return args
  return [
    ...args.slice(0, colorIndex - 3),
    "-loop", "1", "-i", coverPath,
    "-i", args[inputFlagIndex + 1],
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    ...args.slice(inputFlagIndex + 2),
  ]
}

function ffmpegCodecs(format: string): { video: string; audio: string } {
  if (["mp4", "mkv", "mov", "mts", "ts", "m2ts", "flv", "f4v", "m4v", "3gp", "3g2"].includes(format)) return { video: "libx264", audio: "aac" }
  if (format === "wmv") return { video: "wmv2", audio: "wmav2" }
  if (format === "webm") return { video: "libvpx-vp9", audio: "libopus" }
  if (format === "ogv") return { video: "libtheora", audio: "libvorbis" }
  if (format === "avi" || format === "divx") return { video: "mpeg4", audio: "libmp3lame" }
  if (["mpg", "mpeg", "vob"].includes(format)) return { video: "mpeg2video", audio: "mp2" }
  if (format === "mxf") return { video: "mpeg2video", audio: "pcm_s16le" }
  const audio = format === "mp3" ? "libmp3lame" : format === "flac" ? "flac" : format === "wav" ? "pcm_s16le" : format === "ogg" || format === "oga" ? "libvorbis" : format === "opus" ? "libopus" : format === "m4a" ? "aac" : format === "wma" ? "wmav2" : format === "alac" ? "alac" : "aac"
  return { video: "libx264", audio }
}
function ffmpegContainerArgs(format: string): string[] { if (format === "mxf") return ["-ar", "48000", "-strict", "unofficial"]; if (format === "divx") return ["-f", "avi"]; return [] }

export async function runVert(
  input: VertInput,
  runtime: VertRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<VertResult> {
  const action = input.action ?? "status"
  const engine = input.engine ?? "auto"
  const paths = uniquePaths(input.paths)
  const capabilities = await runtime.discoverCommands()
  const base = emptyData({ capabilities, selectedPaths: paths })

  if (action === "status") {
    const available = (["ffmpeg", "magick", "pandoc"] as const).filter((name) => capabilities[name])
    return { success: true, message: `CLI: ${available.join(", ") || "none"}; Wasm fallback: ready on the web surface.`, data: base }
  }
  if (!paths.length) return { success: false, message: "Provide at least one input file.", data: { ...base, errors: ["No input files."] } }
  if (!normalizeFormat(input.targetFormat)) return { success: false, message: "Choose a target format.", data: { ...base, errors: ["No target format."] } }

  let commands: VertCommandPlan[]
  try {
    commands = createVertPlans({ ...input, paths }, capabilities)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, message, data: { ...base, errors: [message] } }
  }
  const missing = commands.filter((plan) => !capabilities[plan.converter])
  const wasmFallbackRequired = engine === "wasm" || (engine === "auto" && missing.length > 0)
  const data = { ...base, commands, outputPaths: commands.map((plan) => plan.outputPath), wasmFallbackRequired }
  if (action === "plan") {
    onEvent({ type: "progress", progress: 100, message: `Planned ${commands.length} conversion(s).` })
    return { success: true, message: `Planned ${commands.length} conversion(s); CLI remains preferred.`, data }
  }
  if (engine === "wasm" || (engine === "auto" && missing.length)) {
    const names = [...new Set(missing.map((plan) => plan.converter))]
    return {
      success: false,
      message: engine === "wasm" ? "Continue with the Wasm converter on the VERT GUI." : `CLI unavailable (${names.join(", ")}); continue with the Wasm fallback on the VERT GUI.`,
      data: { ...data, engineUsed: "wasm", errors: [], wasmFallbackRequired: true },
    }
  }
  if (missing.length) {
    const message = `Required CLI command not found: ${[...new Set(missing.map((plan) => plan.converter))].join(", ")}`
    return { success: false, message, data: { ...data, errors: [message] } }
  }

  const commandResults: VertCommandResult[] = []
  const outputPaths: string[] = []
  const errors: string[] = []
  for (let index = 0; index < commands.length; index += 1) {
    const plan = commands[index]!
    onEvent({ type: "progress", progress: Math.round((index / commands.length) * 92), message: `Converting ${fileName(plan.inputPath)} with ${plan.converter}.` })
    if (!await runtime.pathExists(plan.inputPath)) {
      errors.push(`${plan.inputPath}: file not found`)
      continue
    }
    const result = await runtime.runCommand(plan)
    commandResults.push(result)
    if (result.code === 0) {
      const actualOutputPath = result.outputPath ?? plan.outputPath
      outputPaths.push(actualOutputPath)
      if (input.deleteSourceAfterSuccess && plan.inputPath !== actualOutputPath) {
        try { if (!runtime.removeFile) throw new Error("runtime does not support source deletion"); await runtime.removeFile(plan.inputPath) } catch (error) { errors.push(`${fileName(plan.inputPath)}: converted but source deletion failed: ${error instanceof Error ? error.message : String(error)}`) }
      }
    }
    else errors.push(`${fileName(plan.inputPath)}: ${shortError(result)}`)
  }
  onEvent({ type: "progress", progress: 100, message: errors.length ? "Conversion finished with errors." : "Conversion completed." })
  return {
    success: errors.length === 0,
    message: errors.length ? `Converted ${outputPaths.length}; ${errors.length} failed.` : `Converted ${outputPaths.length} file(s) with native CLI tools.`,
    data: { ...data, commandResults, outputPaths, errors, engineUsed: "cli", wasmFallbackRequired: false },
  }
}

export function deriveOutputPath(inputPath: string, targetFormat: string, outputDirectory?: string): string {
  const separator = inputPath.includes("\\") ? "\\" : "/"
  const slash = Math.max(inputPath.lastIndexOf("/"), inputPath.lastIndexOf("\\"))
  const directory = outputDirectory?.trim().replace(/[\\/]+$/, "") || (slash >= 0 ? inputPath.slice(0, slash) : "")
  const filename = slash >= 0 ? inputPath.slice(slash + 1) : inputPath
  const dot = filename.lastIndexOf(".")
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  return `${directory ? `${directory}${separator}` : ""}${stem}.${normalizeFormat(targetFormat)}`
}

function emptyData(overrides: Partial<VertData> = {}): VertData {
  return { capabilities: { wasm: true }, commands: [], commandResults: [], selectedPaths: [], outputPaths: [], errors: [], wasmFallbackRequired: false, ...overrides }
}
function uniquePaths(paths?: string[]): string[] { return [...new Set((paths ?? []).map((path) => path.trim().replace(/^["']|["']$/g, "")).filter(Boolean))] }
function extension(path: string): string { const name = fileName(path); const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1).toLowerCase() : "" }
function fileName(path: string): string { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }
function converterCommand(converter: VertConverter): string { return converter === "magick" ? "magick" : converter }
function clampQuality(value?: number): number { return Math.max(1, Math.min(100, Math.round(value ?? 90))) }
function shortError(result: VertCommandResult): string { const value = (result.stderr || result.stdout || `exit ${result.code}`).trim(); return value.length > 360 ? `${value.slice(0, 357)}...` : value }
