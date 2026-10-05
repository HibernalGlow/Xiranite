import { basename, dirname, extname, join, resolve } from "node:path"
import { hostCapabilities } from "@xiranite/host-capabilities"
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

/**
 * repacku's machine half, through the host capability surface.
 *
 * One behaviour left with the old `execFile` call: it asked for the transcript as *bytes* and re-decoded
 * them as GBK on Windows. `proc.exec` answers text, so the decoder had nothing to decode and is gone —
 * the host now owns that conversion.
 */
export function createNodeRepackuRuntime(): RepackuRuntime {
  const { fs } = hostCapabilities
  return {
    pathInfo,
    listDir,
    readText: readTextOrThrow,
    writeText: (path, content) => fs.writeText(path, content),
    ensureDir: (path) => fs.ensureDir(path),
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
  const { platform } = await hostCapabilities.os.platform()
  if (platform === "win32") {
    const result = await runCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw"])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  if (platform === "darwin") {
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
  const info = await hostCapabilities.fs.stat(resolved)
  if (!info) return { path: resolved, exists: false, isFile: false, isDirectory: false, size: 0 }
  return {
    path: resolved,
    exists: true,
    isFile: info.kind === "file",
    isDirectory: info.kind === "dir",
    size: info.sizeBytes ?? 0,
  }
}

async function listDir(path: string): Promise<RepackuDirEntry[]> {
  const { fs } = hostCapabilities
  const resolved = resolve(path)
  const entries = await fs.list(resolved)
  return Promise.all(entries.map(async (entry) => {
    const info = await fs.stat(entry.path)
    return {
      name: entry.name,
      path: entry.path,
      isFile: entry.kind === "file",
      isDirectory: entry.kind === "dir",
      size: info?.kind === "file" ? (info.sizeBytes ?? 0) : 0,
    }
  }))
}

async function compressWholeFolder(sourcePath: string, targetPath: string, options: { deleteSource?: boolean }): Promise<RepackuCompressionResult> {
  const { fs } = hostCapabilities
  const resolvedSource = resolve(sourcePath)
  const resolvedTarget = resolve(targetPath)
  const source = await fs.stat(resolvedSource)
  if (source?.kind !== "dir") return { success: false, originalSize: 0, compressedSize: 0, error: `Source is not a directory: ${sourcePath}` }

  const originalSize = await folderSize(resolvedSource)
  await fs.ensureDir(dirname(resolvedTarget))
  const compressor = await findCompressor()
  if (!compressor) return { success: false, originalSize, compressedSize: 0, error: "No compressor found. Install 7-Zip or use Windows PowerShell Compress-Archive." }

  const result = compressor.kind === "7z"
    ? await run7zWithList(compressor.command, resolvedTarget, [basename(resolvedSource)], { cwd: dirname(resolvedSource), recursive: true })
    : await runPowerShellCompressArchive(compressor.command, [resolvedSource], resolvedTarget)

  if (result.code !== 0) return { success: false, originalSize, compressedSize: 0, error: shortError(result), command: formatCommand(compressor.command, resultCommandArgs(result)) }
  const after = await fs.stat(resolvedTarget)
  const compressedSize = after?.kind === "file" ? (after.sizeBytes ?? 0) : 0

  if (options.deleteSource) await fs.remove(resolvedSource, { recursive: true })
  return {
    success: true,
    originalSize,
    compressedSize,
    command: compressor.kind,
  }
}

async function compressFiles(sourcePath: string, targetPath: string, extensions: string[], options: { deleteSource?: boolean }): Promise<RepackuCompressionResult> {
  const { fs } = hostCapabilities
  const resolvedSource = resolve(sourcePath)
  const resolvedTarget = resolve(targetPath)
  const source = await fs.stat(resolvedSource)
  if (source?.kind !== "dir") return { success: false, originalSize: 0, compressedSize: 0, error: `Source is not a directory: ${sourcePath}` }

  const files = await matchingDirectFiles(resolvedSource, extensions, resolvedTarget)
  if (!files.length) return { success: false, originalSize: 0, compressedSize: 0, error: "No matching files found." }

  const originalSize = files.reduce((sum, item) => sum + item.size, 0)
  await fs.ensureDir(dirname(resolvedTarget))
  const compressor = await findCompressor()
  if (!compressor) return { success: false, originalSize, compressedSize: 0, error: "No compressor found. Install 7-Zip or use Windows PowerShell Compress-Archive." }

  const result = compressor.kind === "7z"
    ? await run7zWithList(compressor.command, resolvedTarget, files.map((file) => basename(file.path)), { cwd: resolvedSource })
    : await runPowerShellCompressArchive(compressor.command, files.map((file) => file.path), resolvedTarget)

  if (result.code !== 0) return { success: false, originalSize, compressedSize: 0, error: shortError(result), command: compressor.kind }
  const after = await fs.stat(resolvedTarget)
  const compressedSize = after?.kind === "file" ? (after.sizeBytes ?? 0) : 0

  if (options.deleteSource) {
    await Promise.all(files.map((file) => fs.remove(file.path).catch(() => undefined)))
  }
  return {
    success: true,
    originalSize,
    compressedSize,
    command: compressor.kind,
  }
}

async function matchingDirectFiles(sourcePath: string, extensions: string[], targetPath: string): Promise<Array<{ path: string; size: number }>> {
  const { fs } = hostCapabilities
  const normalizedExtensions = new Set(extensions.map((item) => item.toLowerCase()))
  const target = resolve(targetPath).toLowerCase()
  const entries = await fs.list(sourcePath)
  const files: Array<{ path: string; size: number }> = []
  for (const entry of entries) {
    if (entry.kind !== "file") continue
    if (resolve(entry.path).toLowerCase() === target) continue
    if (normalizedExtensions.size && !normalizedExtensions.has(extname(entry.name).toLowerCase())) continue
    const info = await fs.stat(entry.path)
    if (info?.kind === "file") files.push({ path: entry.path, size: info.sizeBytes ?? 0 })
  }
  return files
}

async function findCompressor(): Promise<Compressor | null> {
  const { env, platform } = await hostCapabilities.os.platform()
  const configured = env.REPACKU_7Z_PATH || env.SEVEN_ZIP_PATH || env["7ZIP_PATH"]
  if (configured) {
    const fromEnv = await resolveCompressorPath(configured)
    if (fromEnv) return { kind: "7z", command: fromEnv }
  }

  for (const name of SEVEN_ZIP_NAMES) {
    const fromPath = await findOnPath(name)
    if (fromPath) return { kind: "7z", command: fromPath }
  }

  if (platform === "win32") {
    const ps = await findOnPath("powershell.exe")
    if (ps) return { kind: "powershell", command: ps }
  }
  return null
}

async function resolveCompressorPath(value: string): Promise<string | null> {
  const { fs } = hostCapabilities
  const info = await fs.stat(value)
  if (info?.kind === "file") return value
  if (info?.kind === "dir") {
    for (const name of SEVEN_ZIP_NAMES) {
      const candidate = join(value, name)
      if ((await fs.stat(candidate))?.kind === "file") return candidate
    }
  }
  return null
}

async function findOnPath(command: string): Promise<string | null> {
  const { platform } = await hostCapabilities.os.platform()
  const locator = platform === "win32" ? "where.exe" : "which"
  const result = await runCommand(locator, [command])
  if (result.code !== 0) return null
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

async function run7z(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult> {
  return runCommand(command, ["-sccUTF-8", "-scsUTF-8", ...args], options)
}

async function run7zWithList(command: string, targetPath: string, entries: string[], options: { cwd: string; recursive?: boolean }): Promise<CommandResult> {
  const { fs } = hostCapabilities
  const dir = await fs.createTemp("xiranite-repacku-")
  const listPath = join(dir, "files.txt")
  try {
    await fs.writeText(listPath, `\uFEFF${entries.join("\n")}\n`)
    const { env } = await hostCapabilities.os.platform()
    return await run7z(command, [
      "a",
      "-tzip",
      targetPath,
      `@${listPath}`,
      options.recursive ? "-r" : "",
      `-mx=${compressionLevel(env)}`,
      "-mmt=on",
      "-aou",
    ].filter(Boolean), { cwd: options.cwd })
  } finally {
    await fs.remove(dir, { recursive: true })
  }
}

async function runPowerShellCompressArchive(command: string, literalPaths: string[], targetPath: string): Promise<CommandResult> {
  const pathList = literalPaths.map(quotePowerShell).join(", ")
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$paths = @(${pathList})`,
    `Compress-Archive -LiteralPath $paths -DestinationPath ${quotePowerShell(targetPath)} -Force`,
  ].join("; ")
  return runCommand(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
}

async function runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult> {
  const result = await hostCapabilities.proc.exec(command, args, options?.cwd ? { cwd: options.cwd } : undefined)
  return { code: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr }
}

async function folderSize(path: string): Promise<number> {
  let total = 0
  for (const entry of await listDir(path)) {
    if (entry.isFile) total += entry.size
    else if (entry.isDirectory) total += await folderSize(entry.path)
  }
  return total
}

function compressionLevel(env: Record<string, string>): number {
  const parsed = Number(env.REPACKU_COMPRESSION_LEVEL ?? 7)
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

/**
 * `fs.readText` answers `null` for an absent document; this adapter's `readText` threw, and `core.ts` turns
 * that rejection into the run's error rather than a parsed-empty answer.
 */
async function readTextOrThrow(path: string): Promise<string> {
  const text = await hostCapabilities.fs.readText(path)
  if (text === null) throw new Error(`ENOENT: no such file or directory, open '${path}'`)
  return text
}
