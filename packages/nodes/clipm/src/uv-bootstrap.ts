import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface ClipmUvArtifact {
  version: string
  archiveUrl: string
  archiveSha256: string
  executableSha256: string
}

export interface ClipmUvBootstrapOptions {
  runtimeRoot: string
  configuredCommand?: string
  platform?: NodeJS.Platform
  arch?: string
  artifact?: ClipmUvArtifact
}

export interface ClipmUvBootstrapDependencies {
  commandAvailable(command: string): Promise<boolean>
  download(url: string): Promise<Uint8Array>
  extract(archivePath: string, destination: string): Promise<void>
}

export const WINDOWS_X64_UV_ARTIFACT: ClipmUvArtifact = {
  version: "0.11.3",
  archiveUrl: "https://github.com/astral-sh/uv/releases/download/0.11.3/uv-x86_64-pc-windows-msvc.zip",
  archiveSha256: "ae681c0aaec7cc96af184648cb88d73f8393ed60fa5880abdd6bdb910f9b227c",
  executableSha256: "07876908e19cf9a875a01d3b702c89b25ded154cc736079feeb4ef78a8f4ca64",
}

const resolutions = new Map<string, Promise<string>>()

export async function resolveClipmUvCommand(
  options: ClipmUvBootstrapOptions,
  dependencies: ClipmUvBootstrapDependencies = defaultDependencies,
): Promise<string> {
  if (options.configuredCommand?.trim()) return options.configuredCommand.trim()
  if (await dependencies.commandAvailable("uv")) return "uv"
  if ((options.platform ?? process.platform) !== "win32" || (options.arch ?? process.arch) !== "x64") {
    throw new Error("ClipM could not find UV. Configure nodes.clipm.uv_command for this platform.")
  }
  const key = resolve(options.runtimeRoot)
  const pending = resolutions.get(key) ?? bootstrapWindowsUv(key, options.artifact ?? WINDOWS_X64_UV_ARTIFACT, dependencies)
  resolutions.set(key, pending)
  try {
    return await pending
  } catch (error) {
    resolutions.delete(key)
    throw error
  }
}

async function bootstrapWindowsUv(
  runtimeRoot: string,
  artifact: ClipmUvArtifact,
  dependencies: ClipmUvBootstrapDependencies,
): Promise<string> {
  const toolsRoot = join(runtimeRoot, "tools", `uv-${artifact.version}`)
  const executablePath = join(toolsRoot, "uv.exe")
  if (await matchesSha256(executablePath, artifact.executableSha256)) return executablePath

  await mkdir(toolsRoot, { recursive: true })
  const archivePath = join(toolsRoot, `uv-${artifact.version}-windows-x64.zip`)
  if (!await matchesSha256(archivePath, artifact.archiveSha256)) {
    const payload = await dependencies.download(artifact.archiveUrl)
    requireSha256(payload, artifact.archiveSha256, "downloaded UV archive")
    const temporaryPath = `${archivePath}.${randomUUID()}.partial`
    await writeFile(temporaryPath, payload)
    try {
      await unlinkIfPresent(archivePath)
      await rename(temporaryPath, archivePath)
    } finally {
      await unlinkIfPresent(temporaryPath)
    }
  }
  await dependencies.extract(archivePath, toolsRoot)
  if (!await matchesSha256(executablePath, artifact.executableSha256)) {
    throw new Error(`Extracted UV ${artifact.version} failed SHA-256 verification.`)
  }
  if (!await dependencies.commandAvailable(executablePath)) {
    throw new Error(`Verified UV ${artifact.version} could not start: ${executablePath}`)
  }
  return executablePath
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

async function matchesSha256(path: string, expected: string): Promise<boolean> {
  try {
    return sha256(await readFile(path)) === expected
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function requireSha256(payload: Uint8Array, expected: string, label: string): void {
  const actual = sha256(payload)
  if (actual !== expected) throw new Error(`${label} failed SHA-256 verification: ${actual}`)
}

function sha256(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex")
}

const defaultDependencies: ClipmUvBootstrapDependencies = {
  async commandAvailable(command) {
    try {
      await execFileAsync(command, ["--version"], { windowsHide: true })
      return true
    } catch {
      return false
    }
  },
  async download(url) {
    const response = await fetch(url, { headers: { "user-agent": "Xiranite-ClipM" } })
    if (!response.ok) throw new Error(`Failed to download UV: HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  },
  async extract(archivePath, destination) {
    await execFileAsync("tar", ["-xf", archivePath, "-C", destination], { windowsHide: true })
  },
}
