import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { parse } from "smol-toml"

export type ScoolpAction =
  | "status"
  | "init"
  | "list_packages"
  | "package_info"
  | "install"
  | "show_config"
  | "sync"
  | "cache_list"
  | "cache_backup"
  | "cache_delete"

export interface ScoolpInput {
  action?: ScoolpAction
  path?: string
  configPath?: string
  configText?: string
  bucketPath?: string
  packageName?: string
  packages?: string[]
  scoopDir?: string
  scoopRoot?: string
  cachePath?: string
  dryRun?: boolean
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface CommandPlan {
  label: string
  command: string
  args: string[]
}

export interface CommandExecution extends CommandPlan, CommandResult {}

export interface ScoolpManifest {
  name: string
  path?: string
  version?: string
  description?: string
  homepage?: string
  license?: unknown
  bin?: unknown
}

export interface ScoolpBucket {
  name: string
  url?: string
}

export interface ScoolpSyncOptions {
  removeAllBeforeAdd: boolean
  resetCoreRepo: boolean
  runUpdate: boolean
  setEnv: boolean
  tryFixOwnership: boolean
  dryRun: boolean
}

export interface ScoolpSyncConfig {
  root: string
  repo?: string
  buckets: ScoolpBucket[]
  options: ScoolpSyncOptions
}

export interface CacheFile {
  name: string
  path: string
  size: number
}

export interface CachePackage {
  name: string
  version: string
  size: number
  filename: string
  path: string
}

export interface CacheScan {
  path: string
  fileCount: number
  softwareCount: number
  obsoleteCount: number
  obsoleteSize: number
  obsoletePackages: CachePackage[]
  backupPath?: string
}

export interface ScoolpData {
  scoopInstalled: boolean
  installedPackages: string[]
  buckets: string[]
  availablePackages: ScoolpManifest[]
  packageInfo?: ScoolpManifest
  syncConfig?: ScoolpSyncConfig
  syncPlan: CommandPlan[]
  commandResults: CommandExecution[]
  cache?: CacheScan
  installedCount: number
  failedCount: number
  cleanedCount: number
  cleanedSizeBytes: number
  errors: string[]
}

export interface ScoolpRuntime {
  commandExists: (command: string) => Promise<boolean>
  runCommand: (command: string, args: string[], options?: { cwd?: string }) => Promise<CommandResult>
  runPowerShell: (script: string) => Promise<CommandResult>
  readText: (path: string) => Promise<string>
  listBucketManifests: (bucketPath: string) => Promise<ScoolpManifest[]>
  readManifest: (bucketPath: string, packageName: string) => Promise<ScoolpManifest | null>
  scanCache: (cachePath: string) => Promise<CacheFile[]>
  ensureDir: (path: string) => Promise<void>
  moveFile: (source: string, target: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  env: (name: string) => string | undefined
  now: () => Date
}

export type ScoolpResult = NodeRunResult<ScoolpData>

export const DEFAULT_SCOOLP_SYNC_TOML = `
[scoop]
root = "D:/scoop"

[options]
remove_all_before_add = true
reset_core_repo = true
run_update = true
set_env = false
try_fix_ownership = true
dry_run = false

[[bucket]]
name = "main"

[[bucket]]
name = "extras"
`

export function normalizeScoolpInput(input: ScoolpInput): Required<ScoolpInput> {
  return {
    action: input.action ?? "status",
    path: clean(input.path),
    configPath: clean(input.configPath),
    configText: input.configText ?? "",
    bucketPath: clean(input.bucketPath),
    packageName: clean(input.packageName),
    packages: input.packages ?? [],
    scoopDir: clean(input.scoopDir),
    scoopRoot: clean(input.scoopRoot),
    cachePath: clean(input.cachePath),
    dryRun: input.dryRun ?? false,
  }
}

export function parseScoolpSyncConfig(content: string): ScoolpSyncConfig {
  const data = asRecord(parse(stripBom(content)))
  const scoop = asRecord(data.scoop)
  const options = asRecord(data.options)
  const buckets = arrayValue(data.bucket).map((item) => {
    const record = asRecord(item)
    return { name: stringValue(record.name), url: optionalString(record.url) }
  }).filter((bucket) => bucket.name)

  return {
    root: stringValue(scoop.root) || "D:/scoop",
    ...(optionalString(scoop.repo) ? { repo: optionalString(scoop.repo) } : {}),
    buckets,
    options: {
      removeAllBeforeAdd: boolValue(options.remove_all_before_add, true),
      resetCoreRepo: boolValue(options.reset_core_repo, true),
      runUpdate: boolValue(options.run_update, true),
      setEnv: boolValue(options.set_env, false),
      tryFixOwnership: boolValue(options.try_fix_ownership, true),
      dryRun: boolValue(options.dry_run, false),
    },
  }
}

export function planScoolpSyncCommands(config: ScoolpSyncConfig, dryRun = false): CommandPlan[] {
  const plan: CommandPlan[] = []
  const root = stripTrailingSlash(config.root)
  const effectiveDryRun = dryRun || config.options.dryRun
  void effectiveDryRun

  if (config.options.tryFixOwnership) {
    plan.push({ label: "git safe.directory core", command: "git", args: ["config", "--global", "--add", "safe.directory", `${root}/apps/scoop/current`] })
    for (const bucket of config.buckets) {
      plan.push({ label: `git safe.directory ${bucket.name}`, command: "git", args: ["config", "--global", "--add", "safe.directory", `${root}/buckets/${bucket.name}`] })
    }
  }

  if (config.options.removeAllBeforeAdd) {
    plan.push({
      label: "remove existing buckets",
      command: "powershell",
      args: ["$ErrorActionPreference='SilentlyContinue'; $names = scoop bucket list | Select-String -NotMatch '^Name|^----|^$' | ForEach-Object { ($_ -split ' +')[0] } | Sort-Object -Unique; foreach ($n in $names) { scoop bucket rm $n }"],
    })
  }

  if (config.options.resetCoreRepo) {
    plan.push({ label: "reset scoop core", command: "git", args: ["-C", `${root}/apps/scoop/current`, "reset", "--hard", "HEAD"] })
    plan.push({ label: "clean scoop core", command: "git", args: ["-C", `${root}/apps/scoop/current`, "clean", "-fd"] })
  }

  if (config.options.setEnv) {
    plan.push({ label: "set SCOOP env", command: "powershell", args: [`[Environment]::SetEnvironmentVariable('SCOOP','${root}','User')`] })
  }

  if (config.repo) {
    plan.push({ label: "set scoop repo mirror", command: "scoop", args: ["config", "SCOOP_REPO", config.repo] })
  }

  for (const bucket of config.buckets) {
    plan.push({
      label: `add bucket ${bucket.name}`,
      command: "scoop",
      args: bucket.url ? ["bucket", "add", bucket.name, bucket.url] : ["bucket", "add", bucket.name],
    })
  }

  if (config.options.runUpdate) {
    plan.push({ label: "scoop update", command: "scoop", args: ["update"] })
  }

  return plan
}

export function parseScoopListOutput(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Installed|^Name|^-+/.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean)
}

export function parseBucketListOutput(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Name|^-+/.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean)
}

export function parseCacheFilename(filename: string): { name: string; version: string } | null {
  const parts = filename.split("#")
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null
  return { name: parts[0], version: parts[1] }
}

export function findObsoleteCachePackages(cachePath: string, files: CacheFile[]): CacheScan {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name))
  const newest = new Map<string, string>()
  const obsoletePackages: CachePackage[] = []

  for (const file of [...sorted].reverse()) {
    const parsed = parseCacheFilename(file.name)
    if (!parsed) continue
    if (!newest.has(parsed.name)) {
      newest.set(parsed.name, parsed.version)
      continue
    }
    if (newest.get(parsed.name) !== parsed.version) {
      obsoletePackages.push({ ...parsed, size: file.size, filename: file.name, path: file.path })
    }
  }

  obsoletePackages.sort((a, b) => `${a.name}:${a.version}`.localeCompare(`${b.name}:${b.version}`))
  return {
    path: cachePath,
    fileCount: files.length,
    softwareCount: newest.size,
    obsoleteCount: obsoletePackages.length,
    obsoleteSize: obsoletePackages.reduce((sum, item) => sum + item.size, 0),
    obsoletePackages,
  }
}

export function formatSize(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0 ? `${value.toFixed(0)} ${units[unit]}` : `${value.toFixed(2)} ${units[unit]}`
}

export async function runScoolp(
  input: ScoolpInput,
  runtime: ScoolpRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<ScoolpResult> {
  const normalized = normalizeScoolpInput(input)
  try {
    if (normalized.action === "status") return await status(runtime, onEvent)
    if (normalized.action === "init") return await initScoop(normalized, runtime, onEvent)
    if (normalized.action === "list_packages") return await listPackages(normalized, runtime)
    if (normalized.action === "package_info") return await packageInfo(normalized, runtime)
    if (normalized.action === "install") return await installPackages(normalized, runtime, onEvent)
    if (normalized.action === "show_config" || normalized.action === "sync") return await sync(normalized, runtime, onEvent)
    return await cache(normalized, runtime, onEvent)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

async function status(runtime: ScoolpRuntime, onEvent: (event: NodeRunEvent) => void): Promise<ScoolpResult> {
  onEvent({ type: "progress", progress: 20, message: "Checking scoop command." })
  const scoopInstalled = await runtime.commandExists("scoop")
  if (!scoopInstalled) return success("Scoop is not installed.", { scoopInstalled: false })

  onEvent({ type: "progress", progress: 45, message: "Loading installed packages." })
  const list = await runtime.runCommand("scoop", ["list"])
  onEvent({ type: "progress", progress: 75, message: "Loading buckets." })
  const bucketList = await runtime.runCommand("scoop", ["bucket", "list"])
  const installedPackages = list.code === 0 ? parseScoopListOutput(list.stdout) : []
  const buckets = bucketList.code === 0 ? parseBucketListOutput(bucketList.stdout) : []
  onEvent({ type: "progress", progress: 100, message: "Status loaded." })
  return success(`Scoop installed: ${installedPackages.length} package(s), ${buckets.length} bucket(s).`, {
    scoopInstalled,
    installedPackages,
    buckets,
    commandResults: [
      { label: "scoop list", command: "scoop", args: ["list"], ...list },
      { label: "scoop bucket list", command: "scoop", args: ["bucket", "list"], ...bucketList },
    ],
  })
}

async function initScoop(input: Required<ScoolpInput>, runtime: ScoolpRuntime, onEvent: (event: NodeRunEvent) => void): Promise<ScoolpResult> {
  if (await runtime.commandExists("scoop")) return success("Scoop is already installed.", { scoopInstalled: true })
  const envPrefix = input.scoopDir
    ? `$env:SCOOP='${input.scoopDir}'; [Environment]::SetEnvironmentVariable('SCOOP', $env:SCOOP, 'User'); `
    : ""
  const script = `${envPrefix}irm get.scoop.sh | iex`
  if (input.dryRun) {
    return success("Scoop install dry-run.", {
      syncPlan: [{ label: "install scoop", command: "powershell", args: [script] }],
    })
  }

  onEvent({ type: "progress", progress: 40, message: "Installing scoop." })
  const result = await runtime.runPowerShell(script)
  return result.code === 0
    ? success("Scoop installed.", { scoopInstalled: true, commandResults: [{ label: "install scoop", command: "powershell", args: [script], ...result }] })
    : failure(`Scoop install failed: ${result.stderr || result.stdout}`)
}

async function listPackages(input: Required<ScoolpInput>, runtime: ScoolpRuntime): Promise<ScoolpResult> {
  const bucketPath = input.bucketPath || input.path || "."
  const availablePackages = await runtime.listBucketManifests(bucketPath)
  return success(`Found ${availablePackages.length} package manifest(s).`, { availablePackages })
}

async function packageInfo(input: Required<ScoolpInput>, runtime: ScoolpRuntime): Promise<ScoolpResult> {
  if (!input.packageName) return failure("Package name is required.")
  const bucketPath = input.bucketPath || input.path || "."
  const info = await runtime.readManifest(bucketPath, input.packageName)
  if (!info) return failure(`Package manifest not found: ${input.packageName}`)
  return success(`Loaded package info: ${input.packageName}`, { packageInfo: info })
}

async function installPackages(input: Required<ScoolpInput>, runtime: ScoolpRuntime, onEvent: (event: NodeRunEvent) => void): Promise<ScoolpResult> {
  const packages = normalizePackages(input)
  if (!packages.length) return failure("At least one package is required.")
  const bucketPath = input.bucketPath || input.path
  const commandResults: CommandExecution[] = []
  let installedCount = 0
  let failedCount = 0

  for (let index = 0; index < packages.length; index += 1) {
    const packageName = packages[index]
    onEvent({ type: "progress", progress: Math.round((index / packages.length) * 100), message: `Installing ${packageName}` })
    const manifest = bucketPath ? await runtime.readManifest(bucketPath, packageName) : null
    const installTarget = manifest?.path ?? packageName
    const result = input.dryRun ? { code: 0, stdout: `DRYRUN scoop install ${installTarget}`, stderr: "" } : await runtime.runCommand("scoop", ["install", installTarget])
    commandResults.push({ label: `install ${packageName}`, command: "scoop", args: ["install", installTarget], ...result })
    if (result.code === 0 || `${result.stdout}\n${result.stderr}`.toLowerCase().includes("already installed")) installedCount += 1
    else failedCount += 1
  }

  onEvent({ type: "progress", progress: 100, message: "Install completed." })
  return {
    success: failedCount === 0,
    message: `Install completed: ${installedCount} success, ${failedCount} failed.`,
    data: data({ installedCount, failedCount, commandResults }),
  }
}

async function sync(input: Required<ScoolpInput>, runtime: ScoolpRuntime, onEvent: (event: NodeRunEvent) => void): Promise<ScoolpResult> {
  const configText = input.configText || (input.configPath || input.path ? await runtime.readText(input.configPath || input.path) : DEFAULT_SCOOLP_SYNC_TOML)
  const syncConfig = parseScoolpSyncConfig(configText)
  const dryRun = input.dryRun || syncConfig.options.dryRun
  const syncPlan = planScoolpSyncCommands(syncConfig, dryRun)
  if (input.action === "show_config" || dryRun) {
    return success(input.action === "show_config" ? "Sync config loaded." : `Dry-run: ${syncPlan.length} command(s).`, { syncConfig, syncPlan })
  }

  const commandResults: CommandExecution[] = []
  for (let index = 0; index < syncPlan.length; index += 1) {
    const item = syncPlan[index]
    onEvent({ type: "progress", progress: Math.round((index / syncPlan.length) * 100), message: item.label })
    const result = item.command === "powershell"
      ? await runtime.runPowerShell(item.args[0] ?? "")
      : await runtime.runCommand(item.command, item.args)
    commandResults.push({ ...item, ...result })
  }
  const failedCount = commandResults.filter((result) => result.code !== 0).length
  return {
    success: failedCount === 0,
    message: `Sync completed: ${commandResults.length - failedCount} success, ${failedCount} failed.`,
    data: data({ syncConfig, syncPlan, commandResults, failedCount }),
  }
}

async function cache(input: Required<ScoolpInput>, runtime: ScoolpRuntime, onEvent: (event: NodeRunEvent) => void): Promise<ScoolpResult> {
  const cachePath = resolveCachePath(input, runtime)
  if (!cachePath) return failure("Cache path is required. Set --path or the SCOOP environment variable.")
  onEvent({ type: "progress", progress: 30, message: `Scanning ${cachePath}` })
  const scan = findObsoleteCachePackages(cachePath, await runtime.scanCache(cachePath))

  if (input.action === "cache_list" || input.dryRun || scan.obsoleteCount === 0) {
    return success(`Found ${scan.obsoleteCount} obsolete cache file(s), ${formatSize(scan.obsoleteSize)}.`, { cache: scan })
  }

  const backupPath = `${stripTrailingSlash(cachePath)}\\bak_${timestamp(runtime.now())}`
  if (input.action === "cache_backup") await runtime.ensureDir(backupPath)

  let cleanedCount = 0
  for (const item of scan.obsoletePackages) {
    onEvent({ type: "progress", progress: Math.round((cleanedCount / scan.obsoleteCount) * 100), message: item.filename })
    if (input.action === "cache_backup") await runtime.moveFile(item.path, `${backupPath}\\${item.filename}`)
    else await runtime.deleteFile(item.path)
    cleanedCount += 1
  }
  scan.backupPath = input.action === "cache_backup" ? backupPath : undefined
  return success(`${input.action === "cache_backup" ? "Backed up" : "Deleted"} ${cleanedCount} cache file(s).`, {
    cache: scan,
    cleanedCount,
    cleanedSizeBytes: scan.obsoleteSize,
  })
}

function normalizePackages(input: Required<ScoolpInput>): string[] {
  return [...input.packages, ...input.packageName.split(/[;,]/)].map((item) => item.trim()).filter(Boolean)
}

function resolveCachePath(input: Required<ScoolpInput>, runtime: ScoolpRuntime): string {
  if (input.cachePath) return input.cachePath
  if (input.path) return input.path
  const scoop = input.scoopRoot || runtime.env("SCOOP") || ""
  return scoop ? `${stripTrailingSlash(scoop)}\\cache` : ""
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-")
}

function stripTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, "")
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function data(partial: Partial<ScoolpData>): ScoolpData {
  return {
    scoopInstalled: false,
    installedPackages: [],
    buckets: [],
    availablePackages: [],
    syncPlan: [],
    commandResults: [],
    installedCount: 0,
    failedCount: 0,
    cleanedCount: 0,
    cleanedSizeBytes: 0,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<ScoolpData>): ScoolpResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): ScoolpResult {
  return { success: false, message, data: data({ errors: [message], failedCount: 1 }) }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value)
  return text || undefined
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}
