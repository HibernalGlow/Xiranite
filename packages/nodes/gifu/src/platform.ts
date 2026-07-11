import { execFile } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { access, appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path"
import type {
  CommandResult,
  GifuArchiveImageEntry,
  GifuConversionOutcome,
  GifuConversionTask,
  GifuRuntime,
} from "./core.js"
import { isGifuImage } from "./core.js"

const SEVEN_ZIP_NAMES = ["7z", "7zz", "7za", "7z.exe", "7zz.exe", "7za.exe"]
const FFMPEG_NAMES = ["ffmpeg", "ffmpeg.exe"]
const FFPROBE_NAMES = ["ffprobe", "ffprobe.exe"]

export function createNodeGifuRuntime(): GifuRuntime {
  const children = new Set<ChildProcess>()
  let cancelled = false
  let sevenZipPromise: Promise<string | null> | undefined
  let ffmpegPromise: Promise<string | null> | undefined
  let ffprobePromise: Promise<string | null> | undefined

  const trackedCommand = (command: string, args: string[], options: RunOptions = {}) => runCommand(command, args, { ...options, children })

  return {
    readText: (path) => readFile(path, "utf8"),
    appendRecord,
    pathInfo,
    listDir,
    async listArchiveImages(path) {
      cancelled = false
      sevenZipPromise ??= findSevenZip()
      const sevenZip = await sevenZipPromise
      if (!sevenZip) throw new Error("7-Zip was not found. Install 7-Zip or add 7z to PATH.")
      const result = await trackedCommand(sevenZip, ["l", "-slt", "-ba", path], { maxBuffer: 64 * 1024 * 1024 })
      if (result.code !== 0) throw new Error(result.stderr || result.stdout || `7-Zip exited with code ${result.code}.`)
      return parse7zImageEntries(result.stdout)
    },
    async convertArchive(task) {
      if (cancelled) throw new Error("Conversion cancelled.")
      sevenZipPromise ??= findSevenZip()
      ffmpegPromise ??= findFfmpeg()
      ffprobePromise ??= findFfprobe(await ffmpegPromise)
      const [sevenZip, ffmpeg, ffprobe] = await Promise.all([sevenZipPromise, ffmpegPromise, ffprobePromise])
      if (!sevenZip) throw new Error("7-Zip was not found. Install 7-Zip or add 7z to PATH.")
      if (!ffmpeg) throw new Error("ffmpeg was not found. Install ffmpeg or add it to PATH.")
      if (!ffprobe) throw new Error("ffprobe was not found next to ffmpeg or on PATH.")
      return convertArchive(task, { sevenZip, ffmpeg, ffprobe, run: trackedCommand, isCancelled: () => cancelled })
    },
    cancel() {
      cancelled = true
      for (const child of children) child.kill()
    },
    isCancelled: () => cancelled,
    join,
    dirname,
    basename,
    extname,
    relative,
  }
}

export function parse7zImageEntries(text: string): GifuArchiveImageEntry[] {
  const entries: GifuArchiveImageEntry[] = []
  let record: Record<string, string> = {}

  function flush() {
    const path = record.Path?.trim()
    const folder = record.Folder === "+" || /D/.test(record.Attributes ?? "") || path?.endsWith("/") || path?.endsWith("\\")
    if (path && !folder && isGifuImage(path)) {
      entries.push({
        path: path.replace(/\\/g, "/"),
        extension: extname(path).toLowerCase(),
        size: numberOrUndefined(record.Size),
      })
    }
    record = {}
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const match = /^([^=]+?)\s*=\s*(.*)$/.exec(line)
    if (match) record[match[1]!.trim()] = match[2]!
  }
  flush()
  return entries
}

async function convertArchive(
  task: GifuConversionTask,
  tools: {
    sevenZip: string
    ffmpeg: string
    ffprobe: string
    run: (command: string, args: string[], options?: RunOptions) => Promise<CommandResult>
    isCancelled: () => boolean
  },
): Promise<GifuConversionOutcome> {
  const workspace = await mkdtemp(join(tmpdir(), "xiranite-gifu-"))
  const extractedRoot = join(workspace, "archive")
  const framesRoot = join(workspace, "frames")
  try {
    await mkdir(extractedRoot, { recursive: true })
    const extraction = await tools.run(tools.sevenZip, ["x", "-y", `-o${extractedRoot}`, task.archivePath], { maxBuffer: 64 * 1024 * 1024 })
    if (extraction.code !== 0) throw new Error(extraction.stderr || extraction.stdout || `7-Zip extraction exited with code ${extraction.code}.`)
    if (tools.isCancelled()) throw new Error("Conversion cancelled.")

    const extractedImages: Array<{ entry: GifuArchiveImageEntry; path: string }> = []
    for (const entry of task.images) {
      const candidate = safeExtractedPath(extractedRoot, entry.path)
      if (candidate && await isFile(candidate)) extractedImages.push({ entry, path: candidate })
    }

    if (extractedImages.length === 1 && task.extractSingle) {
      const outputPath = replaceExtension(task.outputPath, extractedImages[0]!.entry.extension)
      await assertWritableOutput(outputPath, task.overwrite)
      await mkdir(dirname(outputPath), { recursive: true })
      await copyFile(extractedImages[0]!.path, outputPath)
      return {
        status: "extracted",
        outputPath,
        decodedFrames: 1,
        skippedFrames: 0,
        encoder: "7z-copy",
        message: "Extracted the single image without re-encoding it.",
      }
    }
    if (extractedImages.length < 2) {
      return {
        status: "skipped",
        outputPath: task.outputPath,
        decodedFrames: extractedImages.length,
        skippedFrames: Math.max(0, task.images.length - extractedImages.length),
        encoder: "none",
        message: "Fewer than two extractable image entries remain.",
      }
    }

    const probed: Array<{ path: string; width: number; height: number }> = []
    let skippedFrames = task.images.length - extractedImages.length
    for (const image of extractedImages) {
      if (tools.isCancelled()) throw new Error("Conversion cancelled.")
      const dimensions = await probeImage(tools.ffprobe, image.path, tools.run)
      if (dimensions) probed.push({ path: image.path, ...dimensions })
      else skippedFrames += 1
    }
    if (probed.length < 2) {
      return {
        status: "skipped",
        outputPath: task.outputPath,
        decodedFrames: probed.length,
        skippedFrames,
        encoder: "none",
        message: "Fewer than two decodable image frames remain.",
      }
    }

    let width = Math.max(...probed.map((item) => item.width))
    let height = Math.max(...probed.map((item) => item.height))
    if (task.format === "webm" || task.format === "mp4") {
      if (width % 2) width += 1
      if (height % 2) height += 1
    }
    await mkdir(framesRoot, { recursive: true })
    const resizeFlags = task.format === "webm" || task.format === "mp4" ? "bilinear" : "lanczos"
    let decodedFrames = 0
    for (const image of probed) {
      if (tools.isCancelled()) throw new Error("Conversion cancelled.")
      const framePath = join(framesRoot, `frame-${String(decodedFrames).padStart(8, "0")}.png`)
      const result = await tools.run(tools.ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", image.path,
        "-map", "0:v:0", "-frames:v", "1", "-vf", `scale=${width}:${height}:flags=${resizeFlags},format=rgba`,
        framePath,
      ])
      if (result.code === 0 && await isNonEmptyFile(framePath)) decodedFrames += 1
      else skippedFrames += 1
    }
    if (decodedFrames < 2) {
      return {
        status: "skipped",
        outputPath: task.outputPath,
        decodedFrames,
        skippedFrames,
        encoder: "none",
        message: "Fewer than two frames could be normalized.",
      }
    }

    await assertWritableOutput(task.outputPath, task.overwrite)
    await mkdir(dirname(task.outputPath), { recursive: true })
    const encode = await encodeAnimation(task, tools.ffmpeg, framesRoot, decodedFrames, tools.run)
    if (encode.result.code !== 0) {
      await rm(task.outputPath, { force: true }).catch(() => undefined)
      throw new Error(encode.result.stderr || encode.result.stdout || `${encode.encoder} exited with code ${encode.result.code}.`)
    }
    if (!await isNonEmptyFile(task.outputPath)) throw new Error(`Encoder created an empty output: ${task.outputPath}`)
    return {
      status: "converted",
      outputPath: task.outputPath,
      decodedFrames,
      skippedFrames,
      encoder: encode.encoder,
      message: `Encoded ${decodedFrames} frame(s) with ${encode.encoder}.`,
    }
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function encodeAnimation(
  task: GifuConversionTask,
  ffmpeg: string,
  framesRoot: string,
  frameCount: number,
  run: (command: string, args: string[], options?: RunOptions) => Promise<CommandResult>,
): Promise<{ encoder: string; result: CommandResult }> {
  const fps = (1000 / task.durationMs).toFixed(6)
  const input = [
    "-hide_banner", "-loglevel", "error", "-y",
    ...(task.ffmpegThreads > 0 ? ["-threads", String(task.ffmpegThreads)] : []),
    "-framerate", fps, "-start_number", "0", "-i", join(framesRoot, "frame-%08d.png"),
    "-frames:v", String(frameCount), "-an",
  ]

  if (task.format === "gif") {
    const args = [...input,
      "-filter_complex", "[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a",
      "-loop", String(task.loop), task.outputPath,
    ]
    return { encoder: "ffmpeg-gif", result: await run(ffmpeg, args) }
  }
  if (task.format === "webp") {
    const args = [...input, "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(task.quality),
      "-compression_level", String(task.webpMethod), "-loop", String(task.loop), task.outputPath]
    return { encoder: "libwebp_anim", result: await run(ffmpeg, args) }
  }
  if (task.format === "apng") {
    const args = [...input, "-plays", String(task.loop), "-f", "apng", task.outputPath]
    return { encoder: "ffmpeg-apng", result: await run(ffmpeg, args) }
  }
  if (task.format === "webm") {
    const args = [...input, "-vsync", "0", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "0",
      "-crf", String(task.webmCrf), "-deadline", "realtime", "-cpu-used", String(task.webmCpuUsed), "-row-mt", "1", task.outputPath]
    return { encoder: "libvpx-vp9", result: await run(ffmpeg, args) }
  }

  const nvencArgs = [...input, "-vsync", "0", "-c:v", "av1_nvenc", "-rc", "vbr", "-b:v", "0", "-pix_fmt", "yuv420p",
    "-preset", task.mp4Preset, "-cq:v", String(task.mp4Cq), task.outputPath]
  const nvenc = await run(ffmpeg, nvencArgs)
  if (nvenc.code === 0) return { encoder: "av1_nvenc", result: nvenc }

  await rm(task.outputPath, { force: true }).catch(() => undefined)
  const softwareArgs = [...input, "-vsync", "0", "-c:v", "libaom-av1", "-b:v", "0", "-crf", String(task.mp4Cq),
    "-cpu-used", "6", "-pix_fmt", "yuv420p", task.outputPath]
  return { encoder: "libaom-av1", result: await run(ffmpeg, softwareArgs) }
}

async function probeImage(
  ffprobe: string,
  path: string,
  run: (command: string, args: string[], options?: RunOptions) => Promise<CommandResult>,
): Promise<{ width: number; height: number } | null> {
  const result = await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path])
  if (result.code !== 0) return null
  try {
    const parsed = JSON.parse(result.stdout) as { streams?: Array<{ width?: number; height?: number }> }
    const stream = parsed.streams?.[0]
    return stream && Number(stream.width) > 0 && Number(stream.height) > 0
      ? { width: Number(stream.width), height: Number(stream.height) }
      : null
  } catch {
    return null
  }
}

async function pathInfo(path: string) {
  try {
    const info = await stat(path)
    return { path: resolve(path), exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() }
  } catch {
    return { path, exists: false, isFile: false, isDirectory: false }
  }
}

async function listDir(path: string) {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({ name: entry.name, path: join(path, entry.name), isFile: entry.isFile(), isDirectory: entry.isDirectory() }))
}

async function appendRecord(path: string, record: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8")
}

async function findSevenZip(): Promise<string | null> {
  const configured = process.env.GIFU_7Z?.trim()
  if (configured && await exists(configured)) return configured
  const found = await findExecutable(SEVEN_ZIP_NAMES)
  if (found) return found
  for (const candidate of [
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    join(process.env.LOCALAPPDATA ?? "", "7-Zip", "7z.exe"),
  ]) if (candidate && await exists(candidate)) return candidate
  return null
}

async function findFfmpeg(): Promise<string | null> {
  const configured = process.env.GIFU_FFMPEG?.trim()
  if (configured && await exists(configured)) return configured
  return findExecutable(FFMPEG_NAMES)
}

async function findFfprobe(ffmpeg: string | null): Promise<string | null> {
  const configured = process.env.GIFU_FFPROBE?.trim()
  if (configured && await exists(configured)) return configured
  if (ffmpeg) {
    const sibling = join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    if (await exists(sibling)) return sibling
  }
  return findExecutable(FFPROBE_NAMES)
}

async function findExecutable(names: readonly string[]): Promise<string | null> {
  const locator = process.platform === "win32" ? "where.exe" : "which"
  for (const name of names) {
    const result = await runCommand(locator, [name])
    if (result.code === 0) {
      const found = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      if (found) return found
    }
  }
  return null
}

interface RunOptions {
  cwd?: string
  maxBuffer?: number
  children?: Set<ChildProcess>
}

async function runCommand(command: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = execFile(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      options.children?.delete(child)
      const rawCode = (error as NodeJS.ErrnoException | null)?.code
      const code = typeof rawCode === "number" ? rawCode : error ? 1 : 0
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error instanceof Error ? error.message : "")) })
    })
    options.children?.add(child)
  })
}

function safeExtractedPath(root: string, entryPath: string): string | null {
  const candidate = resolve(root, entryPath.replace(/[\\/]/g, sep))
  const rel = relative(root, candidate)
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(rel) === rel) return null
  return candidate
}

function replaceExtension(path: string, extension: string): string {
  const normalized = extension.startsWith(".") ? extension : `.${extension}`
  return path.slice(0, path.length - extname(path).length) + normalized
}

async function assertWritableOutput(path: string, overwrite: boolean): Promise<void> {
  if (!overwrite && await exists(path)) throw new Error(`Output already exists: ${path}`)
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function numberOrUndefined(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

// Exported only for deterministic platform tests without invoking host tools.
export const __gifuPlatformTest = {
  encodeAnimation,
  safeExtractedPath,
}
