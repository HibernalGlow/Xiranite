#!/usr/bin/env bun
/**
 * Stage the official Bun runtime binary that a production host embeds.
 *
 * The Go host looks the runtime up as `build/wails/bun/bun-<GOOS>-<GOARCH>[.exe]`
 * (see bun_runtime.go), so this script is the single place that maps release
 * targets onto Bun's own asset naming.
 */
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { pinnedBunVersion } from "./lib/pinned-bun-version"

interface Options {
  os: string
  arch: string
  version?: string
  outDir: string
  force: boolean
}

const options = parseArgs(process.argv.slice(2))
const version = options.version ?? await pinnedBunVersion()
const bunTarget = resolveBunTarget(options.os, options.arch)
const assetName = bunAssetName(options.os, options.arch)
const output = join(options.outDir, assetName)

if (existsSync(output) && !options.force) {
  console.log(`[bun-runtime] Reusing ${output}`)
} else {
  await stageBunRuntime(bunTarget, version, output, options.os)
}

await verifyVersion(output, version, options.os, options.arch)
await pruneOtherPlatformAssets(options.outDir, assetName)
console.log(`[bun-runtime] Staged Bun ${version} for ${options.os}/${options.arch} at ${output}`)

// The Go host embeds the whole drop directory, so a stale asset from another
// platform would inflate every build on this machine instead of just its own.
async function pruneOtherPlatformAssets(directory: string, keep: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith("bun-") && entry.name !== keep) {
      await rm(join(directory, entry.name), { force: true })
      console.log(`[bun-runtime] Removed stale ${entry.name} from ${directory}`)
    }
  }
}

async function stageBunRuntime(target: string, version: string, destination: string, targetOs: string): Promise<void> {
  const archive = `bun-${target}.zip`
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${archive}`
  const workDir = join(tmpdir(), `xiranite-bun-runtime-${Date.now()}`)
  await mkdir(workDir, { recursive: true })
  try {
    console.log(`[bun-runtime] Downloading ${url}`)
    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok) {
      throw new Error(`Bun runtime download failed: HTTP ${response.status} for ${url}`)
    }
    await writeFile(join(workDir, archive), new Uint8Array(await response.arrayBuffer()))
    await extractArchive(join(workDir, archive), target, workDir)

    // The archive member follows the target OS, not the machine running the build.
    const inner = join(workDir, `bun-${target}`, targetOs === "windows" ? "bun.exe" : "bun")
    if (!existsSync(inner)) {
      throw new Error(`Bun archive did not contain ${inner}`)
    }
    await mkdir(resolve(destination, ".."), { recursive: true })
    await rm(destination, { force: true })
    await Bun.write(destination, Bun.file(inner))
    await chmod(destination, 0o755)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

// macOS and Windows ship bsdtar, which reads zip; Ubuntu runners carry unzip.
async function extractArchive(archivePath: string, target: string, destination: string): Promise<void> {
  const command = process.platform === "linux"
    ? ["unzip", "-q", "-o", archivePath, "-d", destination]
    : ["tar", "-xf", archivePath, "-C", destination]
  const proc = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`Failed to extract ${target} Bun runtime (exit ${code})`)
  }
}

async function verifyVersion(runtimePath: string, version: string, os: string, arch: string): Promise<void> {
  if (os !== processToGoos(process.platform) || arch !== processToGoarch(process.arch)) {
    return
  }
  const proc = Bun.spawn([runtimePath, "--version"], { stdout: "pipe", stderr: "pipe" })
  const stdout = (await proc.exited === 0) ? (await new Response(proc.stdout).text()).trim() : ""
  if (stdout !== version) {
    throw new Error(`Staged Bun runtime reports ${stdout || "no version"}, expected ${version}`)
  }
}

function parseArgs(args: string[]): Options {
  const parsed: Options = {
    os: processToGoos(process.platform),
    arch: processToGoarch(process.arch),
    outDir: "build/wails/bun",
    force: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--force") {
      parsed.force = true
      continue
    }
    const value = args[index + 1]
    if (!arg.startsWith("--") || !value) {
      throw new Error(`Unknown argument: ${arg}. Usage: --os <goos> --arch <goarch> --version <x.y.z> [--out <dir>] [--force]`)
    }
    index += 1
    if (arg === "--os") parsed.os = value
    else if (arg === "--arch") parsed.arch = value
    else if (arg === "--version") parsed.version = value
    else if (arg === "--out") parsed.outDir = value
    else throw new Error(`Unknown option: ${arg}`)
  }
  return parsed
}

function resolveBunTarget(os: string, arch: string): string {
  const platform = os === "windows" ? "windows" : os === "darwin" ? "darwin" : os === "linux" ? "linux" : ""
  if (!platform) throw new Error(`Unsupported Bun runtime target OS: ${os}`)
  const cpu = arch === "amd64" ? "x64" : arch === "arm64" ? "aarch64" : ""
  if (!cpu) throw new Error(`Unsupported Bun runtime target architecture: ${arch}`)
  return `${platform}-${cpu}`
}

function bunAssetName(os: string, arch: string): string {
  const name = `bun-${os}-${arch}`
  return os === "windows" ? `${name}.exe` : name
}

function processToGoos(platform: NodeJS.Platform): string {
  return platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux"
}

function processToGoarch(arch: string): string {
  return arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : arch
}
