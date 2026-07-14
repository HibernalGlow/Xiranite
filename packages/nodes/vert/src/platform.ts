import { execFile } from "node:child_process"
import { access, copyFile, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, extname, join, relative } from "node:path"
import { tmpdir } from "node:os"
import { zipSync } from "fflate"
import { withFfmpegCoverArt } from "./core.js"
import type { VertCapabilities, VertCommandPlan, VertCommandResult, VertRuntime } from "./core.js"

export function createNodeVertRuntime(): VertRuntime {
  return { discoverCommands, runCommand, pathExists, removeFile: (path) => unlink(path) }
}

async function discoverCommands(): Promise<VertCapabilities> {
  const [ffmpeg, magick, pandoc] = await Promise.all([
    findCommand("ffmpeg", "VERT_FFMPEG_PATH"),
    findCommand("magick", "VERT_MAGICK_PATH"),
    findCommand("pandoc", "VERT_PANDOC_PATH"),
  ])
  return { wasm: true, ...(ffmpeg ? { ffmpeg } : {}), ...(magick ? { magick } : {}), ...(pandoc ? { pandoc } : {}) }
}

async function findCommand(name: string, envName: string): Promise<string | undefined> {
  const configured = process.env[envName]?.trim()
  if (configured && await pathExists(configured)) return configured
  const locator = process.platform === "win32" ? "where.exe" : "which"
  const result = await execute(locator, [name])
  return result.code === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) : undefined
}

async function runCommand(plan: VertCommandPlan): Promise<VertCommandResult> {
  if (plan.converter === "pandoc") return runPandocCommand(plan)
  if (plan.converter === "magick" && [".ico", ".ani", ".icns"].includes(extname(plan.inputPath).toLowerCase())) return runMagickCollectionCommand(plan)
  if (plan.converter === "ffmpeg" && plan.args.includes("color=c=black:s=512x512:rate=1")) return runFfmpegAudioToVideoCommand(plan)
  const startedAt = Date.now()
  const result = await execute(plan.command, plan.args)
  return { ...result, durationMs: Date.now() - startedAt }
}

async function runFfmpegAudioToVideoCommand(plan: VertCommandPlan): Promise<VertCommandResult> {
  const startedAt = Date.now()
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "xiranite-vert-cover-"))
  const coverPath = join(temporaryDirectory, "cover.jpg")
  try {
    const cover = await execute(plan.command, ["-y", "-i", plan.inputPath, "-map", "0:v:0", "-frames:v", "1", "-update", "1", coverPath])
    const args = cover.code === 0 && await pathExists(coverPath) ? withFfmpegCoverArt(plan.args, coverPath) : plan.args
    const result = await execute(plan.command, args)
    return { ...result, durationMs: Date.now() - startedAt }
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }) }
}

async function runMagickCollectionCommand(plan: VertCommandPlan): Promise<VertCommandResult> {
  const startedAt = Date.now()
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "xiranite-vert-magick-"))
  const targetExtension = extname(plan.outputPath) || ".png"
  const outputPattern = join(temporaryDirectory, `image%d${targetExtension}`)
  try {
    const result = await execute(plan.command, [...plan.args.slice(0, -1), outputPattern])
    if (result.code !== 0) return { ...result, durationMs: Date.now() - startedAt }
    const files = await collectFiles(temporaryDirectory)
    if (!Object.keys(files).length) return { ...result, code: 1, stderr: result.stderr || "ImageMagick produced no ICO frames", durationMs: Date.now() - startedAt }
    const extension = extname(plan.outputPath)
    const stem = extension ? plan.outputPath.slice(0, -extension.length) : plan.outputPath
    const zipPath = `${stem}.zip`
    await writeFile(zipPath, zipSync(files, { level: 6 }))
    return { ...result, durationMs: Date.now() - startedAt, outputPath: zipPath }
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }) }
}

async function runPandocCommand(plan: VertCommandPlan): Promise<VertCommandResult> {
  const startedAt = Date.now()
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "xiranite-vert-pandoc-"))
  const temporaryOutput = join(temporaryDirectory, basename(plan.outputPath))
  try {
    const result = await execute(plan.command, [plan.inputPath, "-o", temporaryOutput, `--extract-media=${temporaryDirectory}`])
    if (result.code !== 0) return { ...result, durationMs: Date.now() - startedAt }
    const files = await collectFiles(temporaryDirectory)
    const outputName = basename(temporaryOutput)
    const extractedNames = Object.keys(files).filter((name) => name !== outputName)
    if (extractedNames.length) {
      const extension = extname(plan.outputPath)
      const stem = extension ? plan.outputPath.slice(0, -extension.length) : plan.outputPath
      const zipPath = `${stem}.zip`
      await writeFile(zipPath, zipSync(files, { level: 6 }))
      return { ...result, durationMs: Date.now() - startedAt, outputPath: zipPath }
    }
    await copyFile(temporaryOutput, plan.outputPath)
    return { ...result, durationMs: Date.now() - startedAt, outputPath: plan.outputPath }
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }) }
}

async function collectFiles(root: string, directory = root): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(files, await collectFiles(root, path))
    else if (entry.isFile()) files[relative(root, path).replaceAll("\\", "/")] = new Uint8Array(await readFile(path))
  }
  return files
}

async function execute(command: string, args: string[]): Promise<Omit<VertCommandResult, "durationMs">> {
  return await new Promise((resolveResult) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 64, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error instanceof Error ? error.message : "")) })
    })
  })
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true } catch { return false }
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"])
    return result.code === 0 ? result.stdout.trim() : ""
  }
  const command = process.platform === "darwin" ? ["pbpaste"] : ["wl-paste"]
  const result = await execute(command[0]!, command.slice(1))
  return result.code === 0 ? result.stdout.trim() : ""
}
