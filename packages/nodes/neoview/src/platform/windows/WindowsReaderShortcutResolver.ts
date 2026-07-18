import { execFile } from "node:child_process"
import { realpath, stat } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"
import { promisify } from "node:util"

import type { ReaderShortcutResolution, ReaderShortcutResolver } from "../../ports/ReaderShortcutResolver.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"

const execFileAsync = promisify(execFile)
const MAX_OUTPUT_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 5_000
const SHORTCUT_EXTENSION = ".lnk"

export interface WindowsReaderShortcutResolverOptions {
  platform?: NodeJS.Platform
  timeoutMs?: number
  resourceScheduler?: ResourceScheduler
  ownerId?: string
  runPowerShell?: (encodedCommand: string, options: { shortcutPath: string; signal?: AbortSignal; timeoutMs: number; maxOutputBytes: number }) => Promise<string>
}

export class WindowsReaderShortcutResolver implements ReaderShortcutResolver {
  readonly #platform: NodeJS.Platform
  readonly #timeoutMs: number
  readonly #resourceScheduler?: ResourceScheduler
  readonly #ownerId: string
  readonly #runPowerShell: NonNullable<WindowsReaderShortcutResolverOptions["runPowerShell"]>

  constructor(options: WindowsReaderShortcutResolverOptions = {}) {
    this.#platform = options.platform ?? process.platform
    this.#timeoutMs = boundedTimeout(options.timeoutMs)
    this.#resourceScheduler = options.resourceScheduler
    this.#ownerId = options.ownerId ?? "neoview:shortcut-resolver"
    this.#runPowerShell = options.runPowerShell ?? runPowerShell
  }

  async resolve(shortcutPath: string, signal?: AbortSignal): Promise<ReaderShortcutResolution> {
    const normalizedPath = resolve(shortcutPath)
    if (this.#platform !== "win32") return unavailable(normalizedPath, "Shortcut resolution is only available on Windows.")
    if (!normalizedPath.toLocaleLowerCase().endsWith(SHORTCUT_EXTENSION)) {
      return invalid(normalizedPath, "Reader shortcut resolver only accepts .lnk files.")
    }
    signal?.throwIfAborted()
    const lease = await this.#resourceScheduler?.acquire({
      resource: "io",
      kind: "reader.shortcut.resolve",
      priority: "view",
      ownerId: this.#ownerId,
    }, signal)
    try {
      const shortcutStats = await stat(normalizedPath)
      if (!shortcutStats.isFile()) return invalid(normalizedPath, "Shortcut path is not a file.")
      const encodedCommand = encodePowerShellCommand(normalizedPath)
      const output = await this.#runPowerShell(encodedCommand, {
        shortcutPath: normalizedPath,
        signal,
        timeoutMs: this.#timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })
      signal?.throwIfAborted()
      const record = parsePowerShellOutput(output)
      const rawTarget = record.targetPath || record.relativePath
      if (!rawTarget) return invalid(normalizedPath, "Shortcut does not contain a target path.")
      if (isDisallowedTarget(rawTarget)) return invalid(normalizedPath, "Shortcut target is not a local filesystem path.")
      const targetPath = isAbsolute(rawTarget) ? rawTarget : resolve(dirname(normalizedPath), rawTarget)
      const canonicalTarget = await realpath(targetPath)
      signal?.throwIfAborted()
      const targetStats = await stat(canonicalTarget)
      if (!targetStats.isFile() && !targetStats.isDirectory()) return invalid(normalizedPath, "Shortcut target is not a file or directory.")
      return {
        status: "resolved",
        shortcutPath: normalizedPath,
        targetPath: canonicalTarget,
        targetKind: targetStats.isDirectory() ? "directory" : "file",
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      return invalid(normalizedPath, error instanceof Error ? error.message : String(error))
    } finally {
      lease?.release()
    }
  }
}

export async function resolveReaderShortcutChain(
  path: string,
  resolver: ReaderShortcutResolver,
  signal?: AbortSignal,
  maximumDepth = 8,
): Promise<{ path: string; kind?: "file" | "directory" }> {
  let currentPath = resolve(path)
  const visited = new Set<string>()
  for (let depth = 0; depth < maximumDepth; depth += 1) {
    signal?.throwIfAborted()
    if (!currentPath.toLocaleLowerCase().endsWith(SHORTCUT_EXTENSION)) return { path: currentPath }
    const identity = currentPath.toLocaleLowerCase()
    if (visited.has(identity)) throw new Error(`Shortcut resolution cycle detected: ${path}`)
    visited.add(identity)
    const result = await resolver.resolve(currentPath, signal)
    if (result.status !== "resolved" || !result.targetPath) {
      throw new Error(result.reason ?? `Unable to resolve reader shortcut: ${currentPath}`)
    }
    currentPath = result.targetPath
    if (!currentPath.toLocaleLowerCase().endsWith(SHORTCUT_EXTENSION)) {
      return { path: currentPath, kind: result.targetKind }
    }
  }
  throw new Error(`Shortcut resolution exceeds the ${maximumDepth}-link limit: ${path}`)
}

export function encodePowerShellCommand(shortcutPath: string): string {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$shortcutPath = [Environment]::GetEnvironmentVariable('XIRANITE_READER_SHORTCUT_PATH')",
    "if ([string]::IsNullOrWhiteSpace($shortcutPath)) { throw 'Missing shortcut path.' }",
    "$shell = New-Object -ComObject WScript.Shell",
    "$shortcut = $shell.CreateShortcut($shortcutPath)",
    "[pscustomobject]@{ targetPath = [string]$shortcut.TargetPath; relativePath = [string]$shortcut.RelativePath } | ConvertTo-Json -Compress",
  ].join("; ")
  void shortcutPath
  return Buffer.from(script, "utf16le").toString("base64")
}

function parsePowerShellOutput(output: string): { targetPath?: string; relativePath?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(output.trim())
  } catch {
    throw new Error("Shortcut resolver returned invalid JSON.")
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Shortcut resolver returned an invalid record.")
  return {
    targetPath: stringValue((parsed as Record<string, unknown>).targetPath),
    relativePath: stringValue((parsed as Record<string, unknown>).relativePath),
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function isDisallowedTarget(value: string): boolean {
  const target = value.trim()
  if (!target || target.startsWith("shell:")) return true
  return /^[a-z][a-z0-9+.-]*:/iu.test(target) && !/^[a-z]:[\\/]/iu.test(target)
}

async function runPowerShell(
  encodedCommand: string,
  options: { shortcutPath: string; signal?: AbortSignal; timeoutMs: number; maxOutputBytes: number },
): Promise<string> {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener("abort", abort, { once: true })
  try {
    const result = await execFileAsync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-STA",
      "-EncodedCommand",
      encodedCommand,
    ], {
      windowsHide: true,
      encoding: "utf8",
      timeout: options.timeoutMs,
      maxBuffer: options.maxOutputBytes,
      signal: controller.signal,
      env: { ...process.env, XIRANITE_READER_SHORTCUT_PATH: options.shortcutPath },
    })
    return result.stdout
  } finally {
    options.signal?.removeEventListener("abort", abort)
  }
}

function boundedTimeout(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? DEFAULT_TIMEOUT_MS : Math.min(Math.max(Math.trunc(value), 100), 30_000)
}

function invalid(shortcutPath: string, reason: string): ReaderShortcutResolution {
  return { status: "invalid", shortcutPath, reason }
}

function unavailable(shortcutPath: string, reason: string): ReaderShortcutResolution {
  return { status: "unavailable", shortcutPath, reason }
}
