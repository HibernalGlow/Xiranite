import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type JellyPotAction = "status" | "launch_media" | "open_jellyfin" | "apply_registry"

export interface JellyPotInput {
  action?: JellyPotAction
  configPath?: string
  configText?: string
  databasePath?: string
  recordRun?: boolean
  mediaPath?: string
  potplayerPath?: string
  browserPath?: string
  dryRun?: boolean
}

export interface JellyPotConfig {
  jellyfin?: { server_url?: string; server_path?: string; service_name?: string }
  potplayer?: { executable_path?: string; reg_file?: string }
  browser?: { executable_path?: string; process_name?: string; type?: string }
  paths?: { script_directory?: string; powershell_script?: string }
  optional_features?: { auto_start_stop_server?: boolean; local_filesystem_links?: boolean }
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface JellyPotCheck {
  name: string
  path: string
  exists: boolean
}

export interface JellyPotCommandPlan {
  label: string
  command: string
  args: string[]
  detached?: boolean
}

export interface JellyPotDatabase {
  path: string
  enabled: boolean
  mode: "jsonl"
  defaultPath: boolean
}

export interface JellyPotData {
  config?: JellyPotConfig
  database?: JellyPotDatabase
  checks: JellyPotCheck[]
  normalizedMediaPath: string
  commands: JellyPotCommandPlan[]
  commandResults: Array<JellyPotCommandPlan & CommandResult>
  errors: string[]
}

export interface JellyPotRuntime {
  readText: (path: string) => Promise<string>
  appendRecord: (path: string, record: unknown) => Promise<void>
  pathExists: (path: string) => Promise<boolean>
  runCommand: (plan: JellyPotCommandPlan) => Promise<CommandResult>
  dirname: (path: string) => string
  join: (...parts: string[]) => string
}

export type JellyPotResult = NodeRunResult<JellyPotData>

export const DEFAULT_POTPLAYER_PATHS = [
  "D:\\scoop\\apps\\potplayer\\current\\PotPlayerMini64.exe",
  "C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe",
  "C:\\Program Files (x86)\\DAUM\\PotPlayer\\PotPlayerMini64.exe",
  "C:\\Program Files\\PotPlayer\\PotPlayerMini64.exe",
  "C:\\Program Files (x86)\\PotPlayer\\PotPlayerMini64.exe",
]

export function normalizeJellyPotInput(input: JellyPotInput): Required<JellyPotInput> {
  return {
    action: input.action ?? "status",
    configPath: clean(input.configPath),
    configText: input.configText ?? "",
    databasePath: clean(input.databasePath),
    recordRun: input.recordRun ?? Boolean(input.databasePath),
    mediaPath: clean(input.mediaPath),
    potplayerPath: clean(input.potplayerPath),
    browserPath: clean(input.browserPath),
    dryRun: input.dryRun ?? false,
  }
}

export async function runJellyPot(
  input: JellyPotInput,
  runtime: JellyPotRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<JellyPotResult> {
  const normalized = normalizeJellyPotInput(input)
  try {
    onEvent({ type: "progress", progress: 20, message: "Loading JellyPot config." })
    const config = await loadJellyPotConfig(normalized, runtime)
    const checks = await buildChecks(config, normalized, runtime)
    const database = buildJellyPotDatabase(normalized, config)
    const missing = checks.filter((check) => !check.exists)
    if (normalized.action === "status") {
      await writeJellyPotRecordIfEnabled("status", normalized, config, checks, [], undefined, database, runtime)
      return success(`JellyPot status: ${checks.length - missing.length}/${checks.length} dependency path(s) found.`, { config, database, checks })
    }

    const commands = buildCommandPlans(config, normalized, runtime)
    if (normalized.dryRun) {
      await writeJellyPotRecordIfEnabled(normalized.action, normalized, config, checks, commands, undefined, database, runtime)
      return success(`JellyPot dry-run: ${commands.length} command(s).`, { config, database, checks, commands, normalizedMediaPath: normalizeMediaPath(normalized.mediaPath) })
    }

    const commandResults = []
    for (const command of commands) {
      onEvent({ type: "progress", progress: 70, message: command.label })
      commandResults.push({ ...command, ...(await runtime.runCommand(command)) })
    }
    const failed = commandResults.filter((result) => result.code !== 0)
    await writeJellyPotRecordIfEnabled(normalized.action, normalized, config, checks, commands, commandResults, database, runtime)
    return {
      success: failed.length === 0,
      message: `JellyPot completed: ${commandResults.length - failed.length} success, ${failed.length} failed.`,
      data: data({ config, database, checks, commands, commandResults, normalizedMediaPath: normalizeMediaPath(normalized.mediaPath), errors: failed.map((item) => item.stderr || item.stdout) }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export const runJellypot = runJellyPot

export async function loadJellyPotConfig(input: Required<JellyPotInput>, runtime: JellyPotRuntime): Promise<JellyPotConfig> {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "")
  if (!text.trim()) return {}
  return JSON.parse(text) as JellyPotConfig
}

export async function buildChecks(config: JellyPotConfig, input: Required<JellyPotInput>, runtime: JellyPotRuntime): Promise<JellyPotCheck[]> {
  const checks: JellyPotCheck[] = []
  const potplayer = input.potplayerPath || config.potplayer?.executable_path || DEFAULT_POTPLAYER_PATHS[0]!
  const browser = input.browserPath || config.browser?.executable_path || ""
  const scriptDir = config.paths?.script_directory || (input.configPath ? runtime.dirname(input.configPath) : "")
  checks.push({ name: "potplayer", path: potplayer, exists: await runtime.pathExists(potplayer) })
  if (browser) checks.push({ name: "browser", path: browser, exists: await runtime.pathExists(browser) })
  if (config.potplayer?.reg_file && scriptDir) {
    const regPath = runtime.join(scriptDir, config.potplayer.reg_file)
    checks.push({ name: "registry", path: regPath, exists: await runtime.pathExists(regPath) })
  }
  return checks
}

export function buildCommandPlans(config: JellyPotConfig, input: Required<JellyPotInput>, runtime: Pick<JellyPotRuntime, "dirname" | "join">): JellyPotCommandPlan[] {
  const potplayer = input.potplayerPath || config.potplayer?.executable_path || DEFAULT_POTPLAYER_PATHS[0]!
  const browser = input.browserPath || config.browser?.executable_path || ""
  const jellyfinUrl = `${(config.jellyfin?.server_url || "http://localhost:8096").replace(/\/$/, "")}/web/index.html#/home.html`
  const scriptDir = config.paths?.script_directory || (input.configPath ? runtime.dirname(input.configPath) : "")
  if (input.action === "launch_media") {
    if (!input.mediaPath) throw new Error("mediaPath is required for launch_media.")
    return [{ label: "launch PotPlayer", command: potplayer, args: [normalizeMediaPath(input.mediaPath)], detached: true }]
  }
  if (input.action === "open_jellyfin") {
    return browser
      ? [{ label: "open Jellyfin browser", command: browser, args: [jellyfinUrl], detached: true }]
      : [{ label: "open Jellyfin URL", command: "cmd.exe", args: ["/c", "start", "", jellyfinUrl], detached: true }]
  }
  if (input.action === "apply_registry") {
    const regFile = config.potplayer?.reg_file
    if (!regFile || !scriptDir) throw new Error("Registry file and script directory are required.")
    return [{ label: "apply PotPlayer registry", command: "regedit.exe", args: ["/s", runtime.join(scriptDir, regFile)] }]
  }
  return []
}

export function normalizeMediaPath(path: string): string {
  let normalized = clean(path).replace(/^potplayer:\/\//i, "")
  try {
    normalized = decodeURIComponent(normalized)
  } catch {
    // keep original
  }
  normalized = normalized.replace(/\/+/g, "\\").replace(/\\+/g, "\\")
  normalized = normalized.replace(/^([A-Za-z])[:\\/]*/, "$1:\\")
  return normalized
}

export function buildJellyPotDatabase(input: Required<JellyPotInput>, config: JellyPotConfig = {}): JellyPotDatabase | undefined {
  const path = input.databasePath || defaultJellyPotDatabasePath(input, config)
  if (!path) return undefined
  return {
    path,
    enabled: input.recordRun,
    mode: "jsonl",
    defaultPath: !input.databasePath,
  }
}

export function defaultJellyPotDatabasePath(input: Pick<Required<JellyPotInput>, "configPath" | "mediaPath">, config: JellyPotConfig = {}): string {
  const base = input.configPath
    ? dirnameLike(input.configPath)
    : config.paths?.script_directory
      ? clean(config.paths.script_directory)
      : input.mediaPath
        ? dirnameLike(normalizeMediaPath(input.mediaPath))
        : ""
  return base ? joinLike(base, ".xiranite", "jellypot-runs.jsonl") : ""
}

export function buildJellyPotRunRecord(
  action: JellyPotAction,
  input: Pick<Required<JellyPotInput>, "configPath" | "mediaPath" | "dryRun">,
  config: JellyPotConfig,
  checks: JellyPotCheck[],
  commands: JellyPotCommandPlan[],
  commandResults?: Array<JellyPotCommandPlan & CommandResult>,
): Record<string, unknown> {
  const failedResults = commandResults?.filter((result) => result.code !== 0) ?? []
  return {
    toolId: "jellypot",
    action,
    configPath: input.configPath || undefined,
    normalizedMediaPath: input.mediaPath ? normalizeMediaPath(input.mediaPath) : undefined,
    dryRun: input.dryRun,
    checks: {
      total: checks.length,
      found: checks.filter((check) => check.exists).length,
      missing: checks.filter((check) => !check.exists).map((check) => ({ name: check.name, path: check.path })),
    },
    config: {
      jellyfinUrl: config.jellyfin?.server_url,
      hasPotplayerPath: Boolean(config.potplayer?.executable_path),
      hasBrowserPath: Boolean(config.browser?.executable_path),
      autoStartStopServer: config.optional_features?.auto_start_stop_server,
      localFilesystemLinks: config.optional_features?.local_filesystem_links,
    },
    commandCount: commands.length,
    commands,
    success: commandResults ? failedResults.length === 0 : true,
    resultCount: commandResults?.length,
    failedCount: commandResults ? failedResults.length : undefined,
    results: commandResults?.map((result) => ({
      label: result.label,
      code: result.code,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    })),
    at: new Date().toISOString(),
  }
}

async function writeJellyPotRecordIfEnabled(
  action: JellyPotAction,
  input: Required<JellyPotInput>,
  config: JellyPotConfig,
  checks: JellyPotCheck[],
  commands: JellyPotCommandPlan[],
  commandResults: Array<JellyPotCommandPlan & CommandResult> | undefined,
  database: JellyPotDatabase | undefined,
  runtime: Pick<JellyPotRuntime, "appendRecord">,
): Promise<void> {
  if (!database?.enabled) return
  await runtime.appendRecord(database.path, buildJellyPotRunRecord(action, input, config, checks, commands, commandResults))
}

function data(partial: Partial<JellyPotData>): JellyPotData {
  return {
    checks: [],
    normalizedMediaPath: "",
    commands: [],
    commandResults: [],
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<JellyPotData>): JellyPotResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): JellyPotResult {
  return { success: false, message, data: data({ errors: [message] }) }
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function dirnameLike(path: string): string {
  const normalized = clean(path).replace(/\\/g, "/")
  const index = normalized.lastIndexOf("/")
  if (index > 0) return normalized.slice(0, index)
  if (index === 0) return "/"
  return "."
}

function joinLike(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const value = index === 0 ? clean(part).replace(/[\\/]+$/g, "") : clean(part).replace(/^[\\/]+|[\\/]+$/g, "")
      return value === "." ? "" : value
    })
    .filter(Boolean)
    .join("/")
}
