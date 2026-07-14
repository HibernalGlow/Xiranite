import { spawn } from "node:child_process"

const MAX_PROBE_OUTPUT_BYTES = 128 * 1024
const DEFAULT_CANDIDATES = ["7zz", "7z", "7za"] as const

export interface SevenZipExecutable {
  path: string
  version: string
  majorVersion: number
}

export interface SevenZipExecutableResolverOptions {
  executablePath?: string
  environment?: Readonly<Record<string, string | undefined>>
  which?: (name: string) => string | undefined | Promise<string | undefined>
  probe?: (path: string, signal?: AbortSignal) => Promise<string>
  signal?: AbortSignal
}

export interface SevenZipTextCommandOptions {
  signal?: AbortSignal
  maxOutputBytes?: number
  maxErrorBytes?: number
}

export async function resolveSevenZipExecutable(
  options: SevenZipExecutableResolverOptions = {},
): Promise<SevenZipExecutable> {
  const environment = options.environment ?? process.env
  const configured = options.executablePath ?? environment.XIRANITE_7ZIP_PATH
  const probe = options.probe ?? probeSevenZipExecutable
  const candidates = configured
    ? [configured]
    : await resolvePathCandidates(options.which ?? defaultWhich)
  if (candidates.length === 0) {
    throw new Error("7-Zip executable was not found. Install 7zz/7z or set XIRANITE_7ZIP_PATH.")
  }

  const failures: string[] = []
  for (const path of candidates) {
    options.signal?.throwIfAborted()
    try {
      const output = await probe(path, options.signal)
      const version = parseSevenZipVersion(output)
      return { path, version, majorVersion: Number(version.split(".", 1)[0]) }
    } catch (error) {
      failures.push(`${path}: ${errorMessage(error)}`)
    }
  }
  throw new Error(`No usable 7-Zip executable was found. ${failures.join("; ")}`)
}

export function parseSevenZipVersion(output: string): string {
  const match = /(?:^|\r?\n)7-Zip\s+(\d+(?:\.\d+)+)(?:\s|$)/.exec(output)
  if (!match) throw new Error("Command output does not contain a 7-Zip version banner.")
  return match[1]!
}

async function resolvePathCandidates(
  which: NonNullable<SevenZipExecutableResolverOptions["which"]>,
): Promise<string[]> {
  const paths = await Promise.all(DEFAULT_CANDIDATES.map((candidate) => which(candidate)))
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}

async function defaultWhich(name: string): Promise<string | undefined> {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path")
  const pathValue = pathKey ? process.env[pathKey] : undefined
  if (!pathValue) return undefined
  const { delimiter, extname, join } = await import("node:path")
  const { access } = await import("node:fs/promises")
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""]
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, extname(name) ? name : `${name}${extension.toLowerCase()}`)
      if (await access(candidate).then(() => true, () => false)) return candidate
    }
  }
  return undefined
}

async function probeSevenZipExecutable(path: string, signal?: AbortSignal): Promise<string> {
  const result = await runSevenZipTextCommand(path, [], {
    signal,
    maxOutputBytes: MAX_PROBE_OUTPUT_BYTES,
    maxErrorBytes: MAX_PROBE_OUTPUT_BYTES,
  })
  return result.stdout
}

export async function runSevenZipTextCommand(
  path: string,
  args: readonly string[],
  options: SevenZipTextCommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024 * 1024
  const maxErrorBytes = options.maxErrorBytes ?? 256 * 1024
  const signal = options.signal
  signal?.throwIfAborted()
  const child = spawn(path, [...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  const onAbort = () => child.kill()
  signal?.addEventListener("abort", onAbort, { once: true })
  try {
    const [stdout, stderr, exit] = await Promise.all([
      readBoundedText(child.stdout, maxOutputBytes, child),
      readBoundedText(child.stderr, maxErrorBytes, child),
      new Promise<{ code: number | null; error?: Error }>((resolve) => {
        child.once("error", (error) => resolve({ code: null, error }))
        child.once("close", (code) => resolve({ code }))
      }),
    ])
    signal?.throwIfAborted()
    if (exit.error) throw exit.error
    if (exit.code !== 0) throw new Error(stderr.trim() || `7-Zip exited with code ${exit.code}.`)
    return { stdout, stderr }
  } finally {
    signal?.removeEventListener("abort", onAbort)
  }
}

async function readBoundedText(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
  child: ReturnType<typeof spawn>,
): Promise<string> {
  const decoder = new TextDecoder()
  let bytes = 0
  let output = ""
  for await (const chunk of stream) {
    const data = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk as Uint8Array
    bytes += data.byteLength
    if (bytes > maxBytes) {
      child.kill()
      throw new Error(`7-Zip command output exceeded ${maxBytes} bytes.`)
    }
    output += decoder.decode(data, { stream: true })
  }
  return output + decoder.decode()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
