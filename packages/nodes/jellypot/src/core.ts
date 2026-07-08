import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type JellyPotAction = "status" | "launch_media" | "open_jellyfin" | "apply_registry"

export interface JellyPotInput {
  action?: JellyPotAction
  configPath?: string
  configText?: string
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

export interface JellyPotData {
  config?: JellyPotConfig
  checks: JellyPotCheck[]
  normalizedMediaPath: string
  commands: JellyPotCommandPlan[]
  commandResults: Array<JellyPotCommandPlan & CommandResult>
  errors: string[]
}

export interface JellyPotRuntime {
  readText: (path: string) => Promise<string>
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
    const missing = checks.filter((check) => !check.exists)
    if (normalized.action === "status") {
      return success(`JellyPot status: ${checks.length - missing.length}/${checks.length} dependency path(s) found.`, { config, checks })
    }

    const commands = buildCommandPlans(config, normalized, runtime)
    if (normalized.dryRun) return success(`JellyPot dry-run: ${commands.length} command(s).`, { config, checks, commands, normalizedMediaPath: normalizeMediaPath(normalized.mediaPath) })

    const commandResults = []
    for (const command of commands) {
      onEvent({ type: "progress", progress: 70, message: command.label })
      commandResults.push({ ...command, ...(await runtime.runCommand(command)) })
    }
    const failed = commandResults.filter((result) => result.code !== 0)
    return {
      success: failed.length === 0,
      message: `JellyPot completed: ${commandResults.length - failed.length} success, ${failed.length} failed.`,
      data: data({ config, checks, commands, commandResults, normalizedMediaPath: normalizeMediaPath(normalized.mediaPath), errors: failed.map((item) => item.stderr || item.stdout) }),
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
