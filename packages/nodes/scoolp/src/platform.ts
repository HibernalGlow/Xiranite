import { execFile } from "node:child_process"
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { CommandResult, ScoolpManifest, ScoolpRuntime } from "./core.js"

export function createNodeScoolpRuntime(): ScoolpRuntime {
  return {
    commandExists,
    runCommand,
    runPowerShell,
    readText: (path: string) => readFile(path, "utf8"),
    listBucketManifests,
    readManifest,
    scanCache,
    ensureDir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
    moveFile: (source: string, target: string) => rename(source, target),
    deleteFile: (path: string) => rm(path, { force: true }),
    env: (name: string) => process.env[name],
    now: () => new Date(),
  }
}

async function commandExists(command: string): Promise<boolean> {
  const result = process.platform === "win32"
    ? await exec("where.exe", [command])
    : await exec("which", [command])
  return result.code === 0
}

async function runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult> {
  if (command === "scoop") {
    return runPowerShell(["scoop", ...args].map(quotePowerShell).join(" "))
  }
  if (command === "powershell") {
    return runPowerShell(args[0] ?? "")
  }
  return exec(command, args, options?.cwd)
}

async function runPowerShell(script: string): Promise<CommandResult> {
  const executable = process.platform === "win32" ? "powershell.exe" : "pwsh"
  return exec(executable, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
}

async function listBucketManifests(bucketPath: string): Promise<ScoolpManifest[]> {
  const bucketDir = join(resolve(bucketPath), "bucket")
  const entries = await readdir(bucketDir, { withFileTypes: true }).catch(() => [])
  const manifests: ScoolpManifest[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "test.json") continue
    const name = entry.name.slice(0, -5)
    const manifest = await readManifest(bucketPath, name)
    if (manifest) manifests.push(manifest)
  }
  return manifests.sort((a, b) => a.name.localeCompare(b.name))
}

async function readManifest(bucketPath: string, packageName: string): Promise<ScoolpManifest | null> {
  const manifestPath = join(resolve(bucketPath), "bucket", `${packageName}.json`)
  try {
    const raw = JSON.parse(stripBom(await readFile(manifestPath, "utf8"))) as Record<string, unknown>
    return {
      name: packageName,
      path: manifestPath,
      version: typeof raw.version === "string" ? raw.version : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
      homepage: typeof raw.homepage === "string" ? raw.homepage : undefined,
      license: raw.license,
      bin: raw.bin,
    }
  } catch {
    return null
  }
}

async function scanCache(cachePath: string) {
  const root = resolve(cachePath)
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(root, entry.name)
    const itemStat = await stat(path)
    files.push({ name: entry.name, path, size: itemStat.size })
  }
  return files
}

async function exec(command: string, args: string[], cwd?: string): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(command, args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 0
      resolveResult({
        code,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? (error instanceof Error ? error.message : "")),
      })
    })
  })
}

function quotePowerShell(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "''")}'`
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}
