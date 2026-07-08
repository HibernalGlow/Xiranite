import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type SmartZipAction = "status" | "extract" | "extract_codepage" | "open" | "archive" | "settings"

export interface SmartZipInput {
  action?: SmartZipAction
  paths?: string[]
  path?: string
  smartZipExe?: string
  smartZipAhk?: string
  autohotkeyExe?: string
  iniPath?: string
  iniText?: string
  dryRun?: boolean
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface SmartZipCommandPlan {
  label: string
  command: string
  args: string[]
  detached?: boolean
}

export interface SmartZipConfig {
  sevenZipDir: string
  passwords: string[]
  archiveExtensions: string[]
  contextMenu: boolean
  sendTo: boolean
}

export interface SmartZipData {
  config: SmartZipConfig
  command?: SmartZipCommandPlan
  commandResult?: CommandResult
  selectedPaths: string[]
  archiveCount: number
  errors: string[]
}

export interface SmartZipRuntime {
  readText: (path: string) => Promise<string>
  pathExists: (path: string) => Promise<boolean>
  runCommand: (plan: SmartZipCommandPlan) => Promise<CommandResult>
}

export type SmartZipResult = NodeRunResult<SmartZipData>

export const SMARTZIP_ARCHIVE_EXTENSIONS = ["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "cbz", "cbr", "iso"]

export function normalizeSmartZipInput(input: SmartZipInput): Required<SmartZipInput> {
  return {
    action: input.action ?? "status",
    paths: uniqueClean([input.path, ...(input.paths ?? [])]),
    path: clean(input.path),
    smartZipExe: clean(input.smartZipExe),
    smartZipAhk: clean(input.smartZipAhk),
    autohotkeyExe: clean(input.autohotkeyExe) || "AutoHotkey.exe",
    iniPath: clean(input.iniPath),
    iniText: input.iniText ?? "",
    dryRun: input.dryRun ?? false,
  }
}

export async function runSmartZip(
  input: SmartZipInput,
  runtime: SmartZipRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<SmartZipResult> {
  const normalized = normalizeSmartZipInput(input)
  try {
    onEvent({ type: "progress", progress: 20, message: "Loading SmartZip config." })
    const config = parseSmartZipIni(normalized.iniText || (normalized.iniPath ? await runtime.readText(normalized.iniPath) : ""))
    const selectedPaths = normalized.paths
    if (normalized.action === "status") {
      const executable = await resolveSmartZipExecutable(normalized, runtime)
      return success(`SmartZip status loaded: ${config.archiveExtensions.length} archive extension(s).`, {
        config,
        selectedPaths,
        command: executable ? buildSmartZipCommand(normalized, executable) : undefined,
      })
    }
    const executable = await resolveSmartZipExecutable(normalized, runtime)
    if (!executable) return failure("SmartZip executable or AHK script is required.")
    const command = buildSmartZipCommand(normalized, executable)
    if (normalized.dryRun) return success(`SmartZip dry-run: ${command.command} ${command.args.join(" ")}`, { config, selectedPaths, command })

    onEvent({ type: "progress", progress: 75, message: command.label })
    const commandResult = await runtime.runCommand(command)
    return {
      success: commandResult.code === 0,
      message: commandResult.code === 0 ? "SmartZip command launched." : "SmartZip command failed.",
      data: data({ config, selectedPaths, command, commandResult, errors: commandResult.code === 0 ? [] : [commandResult.stderr || commandResult.stdout] }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export function parseSmartZipIni(text: string): SmartZipConfig {
  const sections = parseIni(text)
  const set = sections.set ?? {}
  const menu = sections.menu ?? {}
  return {
    sevenZipDir: set["7zipDir"] ?? "%SmartZipDir%\\7-zip",
    passwords: numberedValues(sections.password),
    archiveExtensions: numberedValues(sections.ext).map((item) => item.replace(/^\./, "").toLowerCase()).filter(Boolean),
    contextMenu: boolValue(menu.contextMenu, true),
    sendTo: boolValue(menu.sendTo, true),
  }
}

export function buildSmartZipCommand(input: Required<SmartZipInput>, executable: SmartZipCommandPlan["command"]): SmartZipCommandPlan {
  const args: string[] = []
  if (input.smartZipAhk && !input.smartZipExe) args.push(input.smartZipAhk)
  const mode = actionMode(input.action)
  if (mode) args.push(mode)
  args.push(...input.paths)
  return { label: `smartzip ${mode || "settings"}`, command: executable, args, detached: input.action === "settings" }
}

export async function resolveSmartZipExecutable(input: Required<SmartZipInput>, runtime: Pick<SmartZipRuntime, "pathExists">): Promise<string> {
  if (input.smartZipExe && await runtime.pathExists(input.smartZipExe)) return input.smartZipExe
  if (input.smartZipAhk && await runtime.pathExists(input.smartZipAhk)) return input.autohotkeyExe
  return input.smartZipExe || (input.smartZipAhk ? input.autohotkeyExe : "")
}

export function actionMode(action: SmartZipAction): string {
  if (action === "extract") return "x"
  if (action === "extract_codepage") return "xc"
  if (action === "open") return "o"
  if (action === "archive") return "a"
  return ""
}

export function isArchivePath(path: string, extensions = SMARTZIP_ARCHIVE_EXTENSIONS): boolean {
  const lower = path.toLowerCase()
  return extensions.some((extension) => lower.endsWith(`.${extension.toLowerCase().replace(/^\./, "")}`))
}

function parseIni(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {}
  let current = "set"
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(";") || line.startsWith("#")) continue
    const section = /^\[([^\]]+)\]$/.exec(line)
    if (section) {
      current = section[1]!.trim()
      sections[current] ??= {}
      continue
    }
    const index = line.indexOf("=")
    if (index < 0) continue
    sections[current] ??= {}
    sections[current]![line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return sections
}

function numberedValues(section?: Record<string, string>): string[] {
  if (!section) return []
  return Object.entries(section)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value)
}

function boolValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === "1" || value.toLowerCase() === "true"
}

function data(partial: Partial<SmartZipData>): SmartZipData {
  const selectedPaths = partial.selectedPaths ?? []
  const config = partial.config ?? parseSmartZipIni("")
  return {
    config,
    selectedPaths,
    archiveCount: selectedPaths.filter((path) => isArchivePath(path, config.archiveExtensions.length ? config.archiveExtensions : SMARTZIP_ARCHIVE_EXTENSIONS)).length,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<SmartZipData>): SmartZipResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): SmartZipResult {
  return { success: false, message, data: data({ errors: [message] }) }
}

function uniqueClean(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}
