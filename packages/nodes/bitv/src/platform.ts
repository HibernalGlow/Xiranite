import { execFile } from "node:child_process"
import { constants } from "node:fs"
import {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, extname, join, relative, resolve } from "node:path"

import {
  isBitvVideoPath,
  type BitvDiscoveryResult,
  type BitvRuntime,
  type BitvSourceFile,
  type BitvTransferMode,
} from "./core.js"

export interface NodeBitvRuntimeOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  now?: () => Date
}

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export function createNodeBitvRuntime(options: NodeBitvRuntimeOptions = {}): BitvRuntime {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env

  return {
    findFfprobe: () => findFfprobe(cwd, env),
    discoverVideos: (paths, recursive) => discoverVideos(paths, recursive, cwd),
    async statFile(path) {
      const file = await stat(resolveFrom(cwd, path))
      if (!file.isFile()) throw new Error("Path is not a file.")
      return { sizeBytes: file.size }
    },
    async runFfprobeJson(ffprobePath, path) {
      const result = await exec(ffprobePath, [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        resolveFrom(cwd, path),
      ], cwd, env)
      if (result.code !== 0) throw new Error(shortProcessError(result, "ffprobe failed"))
      try {
        return JSON.parse(result.stdout) as unknown
      } catch (error) {
        throw new Error(`ffprobe returned invalid JSON: ${errorMessage(error)}`)
      }
    },
    async readJson(path) {
      return JSON.parse(await readFile(resolveFrom(cwd, path), "utf8")) as unknown
    },
    writeJson: (desiredPath, value) => writeJsonExclusive(resolveFrom(cwd, desiredPath), value),
    resolveAvailablePath: (desiredPath) => findAvailablePath(resolveFrom(cwd, desiredPath)),
    transferFile: (sourcePath, desiredPath, mode) => transferFileExclusive(
      resolveFrom(cwd, sourcePath),
      resolveFrom(cwd, desiredPath),
      mode,
    ),
    now: options.now ?? (() => new Date()),
    dirname,
  }
}

export async function findFfprobe(
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const configured = env.BITV_FFPROBE_PATH?.trim()
  if (configured) {
    const path = resolveFrom(cwd, configured)
    if (await isFile(path)) return path
  }

  const locator = process.platform === "win32" ? "where.exe" : "which"
  const result = await exec(locator, ["ffprobe"], cwd, env)
  if (result.code !== 0) return null
  for (const line of result.stdout.split(/\r?\n/)) {
    const candidate = line.trim()
    if (candidate && await isFile(candidate)) return candidate
  }
  return null
}

export async function discoverVideos(paths: string[], recursive: boolean, cwd = process.cwd()): Promise<BitvDiscoveryResult> {
  const files: BitvSourceFile[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  for (const input of paths) {
    const path = resolveFrom(cwd, input)
    let info
    try {
      info = await lstat(path)
    } catch (error) {
      errors.push(`${input}: ${errorMessage(error)}`)
      continue
    }

    if (info.isFile()) {
      if (!isBitvVideoPath(path)) {
        errors.push(`${input}: unsupported video extension`)
        continue
      }
      addDiscoveredFile(files, seen, {
        path,
        basePath: dirname(path),
        relativePath: basename(path),
      })
      continue
    }

    if (!info.isDirectory()) {
      errors.push(`${input}: path is not a regular file or directory`)
      continue
    }

    await walkVideoDirectory(path, path, recursive, files, seen, errors)
  }

  files.sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }))
  return { files, errors }
}

export async function findAvailablePath(desiredPath: string): Promise<string> {
  for (let index = 0; ; index += 1) {
    const candidate = collisionCandidate(desiredPath, index)
    if (!await pathExists(candidate)) return candidate
  }
}

export async function transferFileExclusive(
  sourcePath: string,
  desiredPath: string,
  mode: BitvTransferMode,
): Promise<string> {
  await mkdir(dirname(desiredPath), { recursive: true })
  for (let index = 0; ; index += 1) {
    const candidate = collisionCandidate(desiredPath, index)
    try {
      if (mode === "copy") {
        await copyFile(sourcePath, candidate, constants.COPYFILE_EXCL)
      } else {
        await moveFileWithoutOverwrite(sourcePath, candidate)
      }
      return candidate
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) continue
      throw error
    }
  }
}

async function walkVideoDirectory(
  basePath: string,
  directory: string,
  recursive: boolean,
  files: BitvSourceFile[],
  seen: Set<string>,
  errors: string[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    errors.push(`${directory}: ${errorMessage(error)}`)
    return
  }

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (recursive) await walkVideoDirectory(basePath, path, recursive, files, seen, errors)
      continue
    }
    if (!entry.isFile() || !isBitvVideoPath(path)) continue
    addDiscoveredFile(files, seen, {
      path,
      basePath,
      relativePath: relative(basePath, path),
    })
  }
}

function addDiscoveredFile(files: BitvSourceFile[], seen: Set<string>, file: BitvSourceFile): void {
  const key = process.platform === "win32" ? file.path.toLowerCase() : file.path
  if (seen.has(key)) return
  seen.add(key)
  files.push(file)
}

async function writeJsonExclusive(desiredPath: string, value: unknown): Promise<string> {
  await mkdir(dirname(desiredPath), { recursive: true })
  const json = `${JSON.stringify(value, null, 2)}\n`
  for (let index = 0; ; index += 1) {
    const candidate = collisionCandidate(desiredPath, index)
    try {
      await writeFile(candidate, json, { encoding: "utf8", flag: "wx" })
      return candidate
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) continue
      throw error
    }
  }
}

async function moveFileWithoutOverwrite(sourcePath: string, targetPath: string): Promise<void> {
  try {
    // A hard link is atomic and cannot replace an existing destination. It is
    // safer than rename(), which overwrites on POSIX.
    await link(sourcePath, targetPath)
    await unlink(sourcePath)
    return
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) throw error
    if (!isCrossDeviceOrUnsupported(error)) throw error
  }

  await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL)
  await unlink(sourcePath)
}

function collisionCandidate(path: string, index: number): string {
  if (index === 0) return path
  const extension = extname(path)
  const filename = basename(path, extension)
  return join(dirname(path), `${filename} (${index})${extension}`)
}

function resolveFrom(cwd: string, path: string): string {
  return resolve(cwd, path)
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function exec(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<ExecResult> {
  return new Promise((resolveResult) => {
    execFile(command, args, {
      cwd,
      env: env as NodeJS.ProcessEnv,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 32,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number"
        ? (error as { code: number }).code
        : error ? 1 : 0
      resolveResult({
        code,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? (error instanceof Error ? error.message : "")),
      })
    })
  })
}

function shortProcessError(result: ExecResult, fallback: string): string {
  const message = (result.stderr || result.stdout || fallback).trim()
  return message.length > 500 ? `${message.slice(0, 497)}...` : message
}

function isCrossDeviceOrUnsupported(error: unknown): boolean {
  return ["EXDEV", "EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"].some((code) => isErrorCode(error, code))
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
