import { writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, relative, resolve } from "node:path"

import { hostCapabilities, type ExecResult } from "@xiranite/host-capabilities"
import {
  isBitvVideoPath,
  type BitvDiscoveryResult,
  type BitvRuntime,
  type BitvSourceFile,
  type BitvTransferMode,
} from "./core.js"

/**
 * bitv's machine half, through the host capability surface (ADR-0078).
 *
 * ffprobe is reached through `proc.exec`, so a probe is one host operation the node's manifest can gate;
 * the discovery walk is `fs.stat` + `fs.list` with the paths the host computed for each entry.
 *
 * `node:fs/promises` stays for exactly one call: the report write below, which is `writeFile` with `flag: "wx"`.
 * That is create-if-absent, and `fs.writeText` truncates an existing file instead — the collision loop that
 * numbers a second `analysis.json` depends on the refusal, so the operation has no equivalent to be mapped to.
 */
const { fs, proc, os } = hostCapabilities

export interface NodeBitvRuntimeOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  now?: () => Date
}

export function createNodeBitvRuntime(options: NodeBitvRuntimeOptions = {}): BitvRuntime {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env

  return {
    findFfprobe: () => findFfprobe(cwd, env),
    discoverVideos: (paths, recursive) => discoverVideos(paths, recursive, cwd),
    async statFile(path) {
      const resolved = resolveFrom(cwd, path)
      const info = await fs.stat(resolved)
      if (info === null) throw enoent(resolved, "stat")
      if (info.kind !== "file") throw new Error("Path is not a file.")
      return { sizeBytes: info.sizeBytes ?? 0 }
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
      if (result.exitCode !== 0) throw new Error(shortProcessError(result, "ffprobe failed"))
      try {
        return JSON.parse(result.stdout) as unknown
      } catch (error) {
        throw new Error(`ffprobe returned invalid JSON: ${errorMessage(error)}`)
      }
    },
    async readJson(path) {
      const resolved = resolveFrom(cwd, path)
      // `fs.readText` answers `null` for a document that is not there; `report` shows the message it throws.
      const text = await fs.readText(resolved)
      if (text === null) throw enoent(resolved, "open")
      return JSON.parse(text) as unknown
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

  const { platform } = await os.platform()
  const locator = platform === "win32" ? "where.exe" : "which"
  const result = await exec(locator, ["ffprobe"], cwd, env)
  if (result.exitCode !== 0) return null
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
  const { platform } = await os.platform()

  for (const input of paths) {
    const path = resolveFrom(cwd, input)
    let info
    try {
      info = await fs.stat(path)
    } catch (error) {
      errors.push(`${input}: ${errorMessage(error)}`)
      continue
    }
    if (info === null) {
      errors.push(`${input}: ${enoentMessage(path, "lstat")}`)
      continue
    }

    if (info.kind === "file") {
      if (!isBitvVideoPath(path)) {
        errors.push(`${input}: unsupported video extension`)
        continue
      }
      addDiscoveredFile(files, seen, {
        path,
        basePath: dirname(path),
        relativePath: basename(path),
      }, platform)
      continue
    }

    if (info.kind !== "dir") {
      errors.push(`${input}: path is not a regular file or directory`)
      continue
    }

    await walkVideoDirectory(path, path, recursive, files, seen, errors, platform)
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
  await fs.ensureDir(dirname(desiredPath))
  for (let index = 0; ; index += 1) {
    const candidate = collisionCandidate(desiredPath, index)
    try {
      if (mode === "copy") {
        // `force: false` is the host's `COPYFILE_EXCL`: an existing destination is refused rather than
        // overwritten. It is refused under a different code in each world — see `isAlreadyExists`.
        await fs.copy(sourcePath, candidate, { force: false })
      } else {
        await moveFileWithoutOverwrite(sourcePath, candidate)
      }
      return candidate
    } catch (error) {
      if (isAlreadyExists(error)) continue
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
  platform: string,
): Promise<void> {
  let entries
  try {
    entries = await fs.list(directory)
  } catch (error) {
    errors.push(`${directory}: ${errorMessage(error)}`)
    return
  }

  for (const entry of entries) {
    if (entry.kind === "dir") {
      if (recursive) await walkVideoDirectory(basePath, entry.path, recursive, files, seen, errors, platform)
      continue
    }
    if (entry.kind !== "file" || !isBitvVideoPath(entry.path)) continue
    addDiscoveredFile(files, seen, {
      path: entry.path,
      basePath,
      relativePath: relative(basePath, entry.path),
    }, platform)
  }
}

function addDiscoveredFile(
  files: BitvSourceFile[],
  seen: Set<string>,
  file: BitvSourceFile,
  platform: string,
): void {
  const key = platform === "win32" ? file.path.toLowerCase() : file.path
  if (seen.has(key)) return
  seen.add(key)
  files.push(file)
}

async function writeJsonExclusive(desiredPath: string, value: unknown): Promise<string> {
  await fs.ensureDir(dirname(desiredPath))
  const json = `${JSON.stringify(value, null, 2)}\n`
  for (let index = 0; ; index += 1) {
    const candidate = collisionCandidate(desiredPath, index)
    try {
      // Left on `node:fs/promises` on purpose: `flag: "wx"` is the create-if-absent answer this numbering
      // loop turns into `analysis (1).json`, and the surface has no exclusive-write arm to ask for it.
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
    // safer than `fs.move`, which overwrites on POSIX.
    await fs.hardLink(sourcePath, targetPath)
    await fs.remove(sourcePath)
    return
  } catch (error) {
    if (isAlreadyExists(error)) throw error
    if (!isCrossDeviceOrUnsupported(error)) throw error
  }

  await fs.copy(sourcePath, targetPath, { force: false })
  await fs.remove(sourcePath)
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
  return (await fs.stat(path))?.kind === "file"
}

async function pathExists(path: string): Promise<boolean> {
  return (await fs.stat(path)) !== null
}

/** Node's wording, kept because the run report shows it: the surface answers `null`, the callers want a throw. */
function enoentMessage(path: string, member: "stat" | "lstat" | "open"): string {
  return `ENOENT: no such file or directory, ${member} '${path}'`
}

function enoent(path: string, member: "stat" | "lstat" | "open"): Error & { code: string } {
  return Object.assign(new Error(enoentMessage(path, member)), { code: "ENOENT" })
}

/**
 * `proc.exec` already answers a non-zero exit as a value. It rejects only when the child could not be started,
 * which is the case Node's `execFile` callback had reported as `code 1` — and `findFfprobe` reads that as "no
 * ffprobe here", so a missing `which`/`where.exe` must stay an answer rather than become a thrown run.
 */
async function exec(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<ExecResult> {
  try {
    return await proc.exec(command, args, { cwd, env: definedEnv(env) })
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: errorMessage(error), truncated: false }
  }
}

/** The host's `proc.exec` takes a closed map; `process.env` allows `undefined` values that mean "unset". */
function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const defined: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) if (value !== undefined) defined[key] = value
  return defined
}

function shortProcessError(result: ExecResult, fallback: string): string {
  const message = (result.stderr || result.stdout || fallback).trim()
  return message.length > 500 ? `${message.slice(0, 497)}...` : message
}

function isCrossDeviceOrUnsupported(error: unknown): boolean {
  return ["EXDEV", "EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"].some((code) => isErrorCode(error, code))
}

/**
 * "The destination was already there", under the two spellings this surface can produce: plain `EEXIST` from
 * `link` and from the host's refusal (the realm bridge re-maps `fs.copy`'s "destination already exists" onto
 * it), and Node's `ERR_FS_CP_EEXIST`, which is what the transport's `cp` arm answers with when `force` is off.
 * Both mean "take the next numbered candidate"; anything else is a real failure and rethrows.
 */
function isAlreadyExists(error: unknown): boolean {
  return isErrorCode(error, "EEXIST") || isErrorCode(error, "ERR_FS_CP_EEXIST")
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
