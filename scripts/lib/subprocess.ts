/**
 * The subprocess layer for repo scripts — the standard-Node replacement for `Bun.spawn` / `Bun.spawnSync` /
 * `Bun.which` (ADR-0075: the runner may stay Bun, the code may not use Bun APIs).
 *
 * Three shapes cover what the scripts actually do:
 * - `runSync` — capture stdout/stderr and the exit code for a command that must finish before the next line;
 * - `runInherit` — hand the terminal to the child (the old `Bun.spawn([...], { stdin/stdout/stderr: "inherit" })`
 *   plus `await child.exited`), so progress output stays live;
 * - `which` — resolve an executable on `PATH`, which is what `Bun.which` was used for.
 *
 * `shell` is never enabled: every call site passes an argv array, and a shell would reintroduce the quoting bugs
 * the array form exists to avoid.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { delimiter, join } from "node:path"

export type RunOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Written to the child's stdin (sync path only; the inherit path leaves the terminal alone). */
  input?: string
  /** Cap on captured output, in bytes. The old call sites used a 1 MiB ceiling. */
  maxOutputBytes?: number
}

export type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
  /** True when the child could not be started at all (ENOENT), which is not an exit code. */
  failedToStart: boolean
}

const DEFAULT_OUTPUT_CEILING = 1024 * 1024

function toResult(result: ReturnType<typeof spawnSync>): RunResult {
  const error = result.error as (NodeJS.ErrnoException | undefined)
  return {
    exitCode: typeof result.status === "number" ? result.status : error === undefined ? 1 : 127,
    stdout: result.stdout === null || result.stdout === undefined ? "" : String(result.stdout),
    stderr: result.stderr === null || result.stderr === undefined ? (error?.message ?? "") : String(result.stderr),
    failedToStart: error !== undefined,
  }
}

export function runSync(command: readonly string[], options: RunOptions = {}): RunResult {
  const [binary, ...args] = command
  if (binary === undefined) throw new Error("runSync: empty command")
  const result = spawnSync(binary, args, {
    cwd: options.cwd,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    input: options.input,
    encoding: "utf8",
    maxBuffer: options.maxOutputBytes ?? DEFAULT_OUTPUT_CEILING,
  })
  return toResult(result)
}

/** Runs the child with the terminal attached and resolves with its exit code (or 127 when it cannot start). */
export function runInherit(command: readonly string[], options: RunOptions = {}): Promise<number> {
  const [binary, ...args] = command
  if (binary === undefined) return Promise.reject(new Error("runInherit: empty command"))
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: "inherit",
    })
    child.on("error", (error) => reject(error))
    child.on("close", (code, signal) => resolve(code ?? (signal === null ? 1 : 128)))
  })
}

/** Captures the child's output, the shape most build scripts need. */
export function run(command: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const [binary, ...args] = command
  if (binary === undefined) return Promise.reject(new Error("run: empty command"))
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const ceiling = options.maxOutputBytes ?? DEFAULT_OUTPUT_CEILING
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { if (stdout.length < ceiling) stdout += chunk })
    child.stderr.on("data", (chunk: string) => { if (stderr.length < ceiling) stderr += chunk })
    if (options.input !== undefined && child.stdin !== null) child.stdin.end(options.input)
    child.on("error", (error) => reject(error))
    child.on("close", (code, signal) => resolve({
      exitCode: code ?? (signal === null ? 1 : 128),
      stdout,
      stderr,
      failedToStart: false,
    }))
  })
}

/** The `Bun.which` replacement: the first executable on `PATH` for this name, or null. */
export function which(binary: string): string | null {
  const pathValue = process.env["PATH"] ?? ""
  const candidates = pathValue.split(delimiter).filter((entry) => entry.length > 0)
  const extensions = process.platform === "win32" ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";") : [""]
  for (const directory of candidates) {
    for (const extension of extensions) {
      const candidate = join(directory, binary + extension)
      if (!existsSync(candidate)) continue
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        /* A PATH entry may name a file or a protected directory; skipping it is the standard behaviour. */
      }
    }
  }
  return null
}
