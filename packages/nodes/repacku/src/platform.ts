import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, extname, join, resolve } from "node:path"
import type { RepackuCompressionResult, RepackuDirEntry, RepackuPathInfo, RepackuRuntime } from "./core.js"

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface Compressor {
  kind: "7z" | "powershell"
  command: string
}

const SEVEN_ZIP_NAMES = ["7z", "7zz", "7za", "7z.exe", "7zz.exe", "7za.exe"]

export function createNodeRepackuRuntime(): RepackuRuntime {
  return {
    pathInfo,
    listDir,
    readText: (path) => Bun.file(path).text(),
    writeText: (path, content) => Bun.write(path, content).then(() => undefined),
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    compressWholeFolder,
    compressFiles,
    join,
    dirname,
    basename,
    extname,
    resolve,
    now: () => new Date(),
  }
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", "Get-Clipboard -Raw"])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  if (process.platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0], command.slice(1))
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  return ""
}

async function pathInfo(path: string): Promise<RepackuPathInfo> {
  const resolved = resolve(path)
  try {
    const item = await stat(resolved)
    return {
      path: resolved,
      exists: true,
      isFile: item.isFile(),
      isDirectory: item.isDirectory(),
      size: item.size,
    }
  } catch {
    return { path: resolved, exists: false, isFile: false, isDirectory: false, size: 0 }
  }
}

async function listDir(path: string): Promise<RepackuDirEntry[]> {
  const resolved = resolve(path)
  const entries = await readdir(resolved, { withFileTypes: true })
  return Promise.all(entries.map(async (entry) => {
    const entryPath = join(resolved, entry.name)
    const item = await safeStat(entryPath)
    return {
      name: entry.name,
      path: entryPath,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      size: item?.isFile() ? item.size : 0,
    }
  }))
}

async function compressWholeFolder(sourcePath: string, targetPath: string, options: { deleteSource?: boolean }): Promise<RepackuCompressionResult> {
  const resolvedSource = resolve(sourcePath)
  const resolvedTarget = resolve(targetPath)
  const source = await safeStat(resolvedSource)
  if (!source?.isDirectory()) return { success: false, originalSize: 0, compressedSize: 0, error: `Source is not a directory: ${sourcePath}` }

  const originalSize = await folderSize(resolvedSource)
  await mkdir(dirname(resolvedTarget), { recursive: true })
  const compressor = await findCompressor()
  if (!compressor) return { success: false, originalSize, compressedSize: 0, error: "No compressor found. Install 7-Zip or use Windows PowerShell Compress-Archive." }

  const result = compressor.kind === "7z"
    ? await run7zWithList(compressor.command, resolvedTarget, [basename(resolvedSource)], { cwd: dirname(resolvedSource), recursive: true })
    : await runPowerShellCompressArchive(compressor.command, [resolvedSource], resolvedTarget)

  if (result.code !== 0) return { success: false, originalSize, compressedSize: 0, error: shortError(result), command: formatCommand(compressor.command, resultCommandArgs(result)) }
  const compressedSize = (await safeStat(resolvedTarget))?.size ?? 0

  if (options.deleteSource) await rm(resolvedSource, { recursive: true, force: true })
  return {
    success: true,
    originalSize,
    compressedSize,
    command: compressor.kind,
  }
}

async function compressFiles(sourcePath: string, targetPath: string, extensions: string[], options: { deleteSource?: boolean }): Promise<RepackuCompressionResult> {
  const resolvedSource = resolve(sourcePath)
  const resolvedTarget = resolve(targetPath)
  const source = await safeStat(resolvedSource)
  if (!source?.isDirectory()) return { success: false, originalSize: 0, compressedSize: 0, error: `Source is not a directory: ${sourcePath}` }

  const files = await matchingDirectFiles(resolvedSource, extensions, resolvedTarget)
  if (!files.length) return { success: false, originalSize: 0, compressedSize: 0, error: "No matching files found." }

  const originalSize = files.reduce((sum, item) => sum + item.size, 0)
  await mkdir(dirname(resolvedTarget), { recursive: true })
  const compressor = await findCompressor()
  if (!compressor) return { success: false, originalSize, compressedSize: 0, error: "No compressor found. Install 7-Zip or use Windows PowerShell Compress-Archive." }

  const result = compressor.kind === "7z"
    ? await run7zWithList(compressor.command, resolvedTarget, files.map((file) => basename(file.path)), { cwd: resolvedSource })
    : await runPowerShellCompressArchive(compressor.command, files.map((file) => file.path), resolvedTarget)

  if (result.code !== 0) return { success: false, originalSize, compressedSize: 0, error: shortError(result), command: compressor.kind }
  const compressedSize = (await safeStat(resolvedTarget))?.size ?? 0

  if (options.deleteSource) {
    await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)))
  }
  return {
    success: true,
    originalSize,
    compressedSize,
    command: compressor.kind,
  }
}

async function matchingDirectFiles(sourcePath: string, extensions: string[], targetPath: string): Promise<Array<{ path: string; size: number }>> {
  const normalizedExtensions = new Set(extensions.map((item) => item.toLowerCase()))
  const target = resolve(targetPath).toLowerCase()
  const entries = await readdir(sourcePath, { withFileTypes: true })
  const files: Array<{ path: string; size: number }> = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(sourcePath, entry.name)
    if (resolve(path).toLowerCase() === target) continue
    if (normalizedExtensions.size && !normalizedExtensions.has(extname(entry.name).toLowerCase())) continue
    const item = await safeStat(path)
    if (item?.isFile()) files.push({ path, size: item.size })
  }
  return files
}

async function findCompressor(): Promise<Compressor | null> {
  const env = process.env.REPACKU_7Z_PATH || process.env.SEVEN_ZIP_PATH || process.env["7ZIP_PATH"]
  if (env) {
    const fromEnv = await resolveCompressorPath(env)
    if (fromEnv) return { kind: "7z", command: fromEnv }
  }

  for (const name of SEVEN_ZIP_NAMES) {
    const fromPath = await findOnPath(name)
    if (fromPath) return { kind: "7z", command: fromPath }
  }

  if (process.platform === "win32") {
    const ps = await findOnPath("powershell.exe")
    if (ps) return { kind: "powershell", command: ps }
  }
  return null
}

async function resolveCompressorPath(value: string): Promise<string | null> {
  const info = await safeStat(value)
  if (info?.isFile()) return value
  if (info?.isDirectory()) {
    for (const name of SEVEN_ZIP_NAMES) {
      const candidate = join(value, name)
      const candidateInfo = await safeStat(candidate)
      if (candidateInfo?.isFile()) return candidate
    }
  }
  return null
}

async function findOnPath(command: string): Promise<string | null> {
  const locator = process.platform === "win32" ? "where.exe" : "which"
  const result = await runCommand(locator, [command])
  if (result.code !== 0) return null
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

async function run7z(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult> {
  return runCommand(command, ["-sccUTF-8", "-scsUTF-8", ...args], options)
}

async function run7zWithList(command: string, targetPath: string, entries: string[], options: { cwd: string; recursive?: boolean }): Promise<CommandResult> {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-repacku-"))
  const listPath = join(dir, "files.txt")
  try {
    await writeFile(listPath, `\uFEFF${entries.join("\n")}\n`, "utf8")
    return await run7z(command, [
      "a",
      "-tzip",
      targetPath,
      `@${listPath}`,
      options.recursive ? "-r" : "",
      `-mx=${compressionLevel()}`,
      "-mmt=on",
      "-aou",
    ].filter(Boolean), { cwd: options.cwd })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function runPowerShellCompressArchive(command: string, literalPaths: string[], targetPath: string): Promise<CommandResult> {
  const pathList = literalPaths.map(quotePowerShell).join(", ")
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$paths = @(${pathList})`,
    `Compress-Archive -LiteralPath $paths -DestinationPath ${quotePowerShell(targetPath)} -Force`,
  ].join("; ")
  return runCommand(command, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
}

async function runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(command, args, { cwd: options?.cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 32, encoding: "buffer" }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0
      resolveResult({
        code,
        stdout: decodeProcessOutput(stdout),
        stderr: decodeProcessOutput(stderr) || (error instanceof Error ? error.message : ""),
      })
    })
  })
}

async function safeStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

async function folderSize(path: string): Promise<number> {
  let total = 0
  for (const entry of await listDir(path)) {
    if (entry.isFile) total += entry.size
    else if (entry.isDirectory) total += await folderSize(entry.path)
  }
  return total
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function compressionLevel(): number {
  const parsed = Number(process.env.REPACKU_COMPRESSION_LEVEL ?? 7)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(9, Math.floor(parsed))) : 7
}

function shortError(result: CommandResult): string {
  const text = (result.stderr || result.stdout || `exit code ${result.code}`).trim()
  return text.length > 800 ? `...${text.slice(-797)}` : text
}

function resultCommandArgs(_result: CommandResult): string[] {
  return []
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => /\s/.test(part) ? `"${part.replace(/"/g, "\\\"")}"` : part).join(" ")
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function decodeProcessOutput(value: Buffer | string | null | undefined): string {
  if (!value) return ""
  if (typeof value === "string") return value
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(value)
  if (process.platform !== "win32" || !utf8.includes("\uFFFD")) return utf8
  try {
    return new TextDecoder("gbk").decode(value)
  } catch {
    return utf8
  }
}
