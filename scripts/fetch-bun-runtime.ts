#!/usr/bin/env bun
/**
 * Stage the official Bun runtime binary that a production host embeds.
 *
 * The Go host looks the runtime up as `build/wails/bun/bun-<GOOS>-<GOARCH>[.exe]`
 * (see bun_runtime.go), so this script is the single place that maps release
 * targets onto Bun's own asset naming.
 */
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { pinnedBunVersion } from "./lib/pinned-bun-version"

const downloadTimeoutMs = 180_000
const commandTimeoutMs = 60_000
const extractTimeoutMs = 180_000

interface Options {
  os: string
  arch: string
  version?: string
  from?: string
  outDir: string
  force: boolean
}

const options = parseArgs(process.argv.slice(2))
// A local binary carries its own release, so --version is only needed when the
// runtime comes from GitHub.
const version = options.version ?? (options.from ? await readBunVersion(options.from) : await pinnedBunVersion())
const bunTarget = resolveBunTarget(options.os, options.arch)
const assetName = bunAssetName(options.os, options.arch)
const output = join(options.outDir, assetName)

if (existsSync(output) && !options.force && stagedAssetMatches(output, options.os, options.arch, version)) {
  console.log(`[bun-runtime] Reusing ${output}`)
} else if (options.from) {
  await stageLocalBunRuntime(options.from, output, options.os)
} else {
  await stageBunRuntime(bunTarget, version, output, options.os)
}

await verifyVersion(output, version, options.os, options.arch)
await recordStagedAsset(output, options.os, options.arch, version)
await pruneOtherPlatformAssets(options.outDir, assetName)
console.log(`[bun-runtime] Staged Bun ${version} for ${options.os}/${options.arch} at ${output}`)

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

// Bun 1.3's `fetch` + `AbortController` pair can wedge the entire event loop when
// a release download stalls mid-body: reproduced locally with the pinned runtime,
// where neither the awaited `Bun.write(response)` nor a `setTimeout` watchdog
// ever returned, so the CI step hung instead of failing. Everything this script
// runs externally therefore goes through a spawn that kills its own child on a
// deadline — a separate OS process cannot be wedged by the stalled JS side.
async function runBounded(command: string[], timeoutMs: number): Promise<CommandResult> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<CommandResult>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill("SIGKILL")
      reject(new Error(`${command[0]} did not finish within ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      (async (): Promise<CommandResult> => ({
        exitCode: await proc.exited,
        stdout: await new Response(proc.stdout).text(),
        stderr: await new Response(proc.stderr).text(),
      }))(),
      deadline,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface StagedAssetRecord {
  os: string
  arch: string
  version: string
}

function stagedAssetRecordPath(assetPath: string): string {
  return `${assetPath}.xiranite.json`
}

// The drop directory is embedded verbatim, so a leftover runtime from another
// release or architecture would be shipped without any check on a cross-target
// build. The sidecar makes reuse conditional on matching that metadata.
function stagedAssetMatches(assetPath: string, os: string, arch: string, version: string): boolean {
  const recordPath = stagedAssetRecordPath(assetPath)
  if (!existsSync(recordPath)) return false
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as Partial<StagedAssetRecord>
    return record.os === os && record.arch === arch && record.version === version
  } catch {
    return false
  }
}

async function recordStagedAsset(assetPath: string, os: string, arch: string, version: string): Promise<void> {
  const record: StagedAssetRecord = { os, arch, version }
  await writeFile(stagedAssetRecordPath(assetPath), `${JSON.stringify(record, null, 2)}\n`, "utf8")
}

// The Go host embeds the whole drop directory, so a stale asset from another
// platform would inflate every build on this machine instead of just its own.
async function pruneOtherPlatformAssets(directory: string, keep: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("bun-")) continue
    // The staged asset and its sidecar (`<asset>.xiranite.json`) survive; any
    // other platform's asset or metadata goes, because the Go host embeds the
    // whole directory and a foreign runtime would inflate the build.
    if (entry.name === keep || entry.name.startsWith(`${keep}.`)) continue
    await rm(join(directory, entry.name), { force: true })
    console.log(`[bun-runtime] Removed stale ${entry.name} from ${directory}`)
  }
}

// Developers whose network cannot reach GitHub release assets (or who want the
// exact runtime they just tested) stage a local binary instead.
async function stageLocalBunRuntime(source: string, destination: string, targetOs: string): Promise<void> {
  const sourcePath = resolve(source)
  if (targetOs !== processToGoos(process.platform)) {
    throw new Error(`--from stages a binary for this machine (${processToGoos(process.platform)}), not ${targetOs}.`)
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`Local Bun runtime not found: ${sourcePath}`)
  }
  await mkdir(resolve(destination, ".."), { recursive: true })
  await rm(destination, { force: true })
  await Bun.write(destination, Bun.file(sourcePath))
  await chmod(destination, 0o755)
  console.log(`[bun-runtime] Staged local runtime ${sourcePath}`)
}

async function readBunVersion(runtimePath: string): Promise<string> {
  const stdout = await runBounded([resolve(runtimePath), "--version"], commandTimeoutMs).then(
    (result) => result.stdout.trim(),
    () => "",
  )
  if (!stdout) {
    throw new Error(`Could not read a version from ${runtimePath}; pass --version explicitly.`)
  }
  return stdout
}

async function stageBunRuntime(target: string, version: string, destination: string, targetOs: string): Promise<void> {
  const archive = `bun-${target}.zip`
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${archive}`
  const workDir = join(tmpdir(), `xiranite-bun-runtime-${Date.now()}`)
  await mkdir(workDir, { recursive: true })
  try {
    console.log(`[bun-runtime] Downloading ${url}`)
    await downloadArchive(url, join(workDir, archive))
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

// GitHub release downloads stall intermittently on both developer machines and
// runners, so the transfer is bounded and retried instead of leaving the whole
// build waiting on one connection until the CI job times out. curl ships on all
// three runner images and honours its own transfer deadlines when the peer goes
// quiet mid-stream, which is exactly what the JS fetch failed to do.
async function downloadArchive(url: string, destination: string): Promise<void> {
  const attempts = 3
  const argv = [
    "curl",
    "--fail",
    "--silent",
    "--show-error",
    "--location",
    "--max-time",
    String(Math.round(downloadTimeoutMs / 1000)),
    // Treat anything under 1 KiB/s held for 30s as a dead edge, so a connection
    // that keeps trickling metadata cannot occupy the step indefinitely.
    "--speed-limit",
    "1024",
    "--speed-time",
    "30",
    "--output",
    destination,
    url,
  ]
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let result: CommandResult | undefined
    try {
      result = await runBounded(argv, downloadTimeoutMs + 15_000)
    } catch (error) {
      lastError = error
    }
    if (result && result.exitCode === 0) return
    lastError = result
      ? new Error(`curl exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`)
      : lastError
    console.warn(`[bun-runtime] Download attempt ${attempt}/${attempts} failed: ${String(lastError)}`)
    await rm(destination, { force: true })
    if (attempt < attempts) await Bun.sleep(attempt * 5_000)
  }
  throw new Error(`Bun runtime download failed after ${attempts} attempts: ${String(lastError)}`)
}

// macOS and Windows ship bsdtar, which reads zip; Ubuntu runners carry unzip.
async function extractArchive(archivePath: string, target: string, destination: string): Promise<void> {
  const command = process.platform === "linux"
    ? ["unzip", "-q", "-o", archivePath, "-d", destination]
    : [archiveExtractor(), "-xf", archivePath, "-C", destination]
  const result = await runBounded(command, extractTimeoutMs)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to extract ${target} Bun runtime (exit ${result.exitCode}): ${result.stderr.trim() || "no stderr"}`)
  }
}

// A Windows job may resolve the bare name `tar` to the MSYS build that a Git Bash
// install puts on PATH. GNU tar reads the absolute `C:\...` paths this script is
// handed as a remote `host:path` and fails with "Cannot connect to C: resolve
// failed", so ask for the System32 bsdtar by absolute path instead of trusting
// PATH: it takes Windows paths literally.
function archiveExtractor(): string {
  if (process.platform !== "win32") return "tar"
  return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
}

async function verifyVersion(runtimePath: string, version: string, os: string, arch: string): Promise<void> {
  if (os !== processToGoos(process.platform) || arch !== processToGoarch(process.arch)) {
    return
  }
  const probe = await runBounded([runtimePath, "--version"], commandTimeoutMs)
  const stdout = probe.exitCode === 0 ? probe.stdout.trim() : ""
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
    else if (arg === "--from") parsed.from = value
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
