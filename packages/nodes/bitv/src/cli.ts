#!/usr/bin/env node
import { pathToFileURL } from "node:url"

import {
  nodeCliName,
  readStdinLines,
  runGuidedInteraction,
  writeError,
  writeJson,
  writeLine,
  type CliCommand,
  type CliHost,
} from "@xiranite/cli-runtime"
import {
  requireInteractiveMode,
  resolveCliInvocation,
  resolveInteractionPreferences,
  resolveTerminalUiFlags,
  type CliInteractionPreferencesSource,
  type TerminalInteractionDefinition,
  type TerminalRenderer,
} from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { listTerminalThemes, runTerminalUi } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints } from "@xiranite/config"

import {
  BITV_DEFAULTS,
  runBitv,
  type BitvAction,
  type BitvInput,
  type BitvResult,
  type BitvRuntime,
  type BitvTransferMode,
} from "./core.js"
import { createBitvInteractionSchema } from "./interaction.js"
import { createNodeBitvRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("bitv")

interface BitvNodeConfig extends CliInteractionPreferencesSource {
  paths?: string[] | string
  report_path?: string
  target_path?: string
  output_path?: string
  recursive?: boolean
  bitrate_step_mbps?: number
  max_levels?: number
  transfer_mode?: BitvTransferMode
  dry_run?: boolean
}

interface BitvDefaults {
  interactionMode?: "ui" | "gd" | "pipe"
  interactionRenderer?: TerminalRenderer
  interactionLanguage?: TerminalLanguage
  interactionTheme?: string
  paths?: string[]
  reportPath?: string
  targetPath?: string
  outputPath?: string
  recursive?: boolean
  bitrateStepMbps?: number
  maxLevels?: number
  transferMode?: BitvTransferMode
  dryRun?: boolean
}

export interface BitvCliDependencies {
  createRuntime: (host: CliHost) => BitvRuntime
  runGuide: <Input, Result>(
    definition: TerminalInteractionDefinition<Input, Result>,
    options: { host: CliHost; language: TerminalLanguage },
  ) => Promise<void>
  runUi: typeof runTerminalUi
}

const defaultDependencies: BitvCliDependencies = {
  createRuntime: (host) => createNodeBitvRuntime({ cwd: host.cwd, env: host.env }),
  runGuide: runGuidedInteraction,
  runUi: runTerminalUi,
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Native ffprobe video bitrate analysis and classification.",
  run: (args, host) => runProgram(args, host),
}

export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createDefaultHost(),
  dependencies: BitvCliDependencies = defaultDependencies,
): Promise<void> {
  if (args.length === 0 && (!host.stdin.isTTY || !host.stdout.isTTY)) {
    writeError(host, `No interactive terminal detected. Use \`${CLI_NAME} status --json\` or run \`${CLI_NAME} ui\` in a terminal.`)
    process.exitCode = 2
    return
  }

  const explicitInvocation = resolveCliInvocation(args, host, "ui")
  if (args.length > 0 && explicitInvocation !== "pipe") {
    const ttyError = requireInteractiveMode(host, explicitInvocation)
    if (ttyError) {
      writeError(host, ttyError)
      process.exitCode = 2
      return
    }
  }

  if (explicitInvocation === "pipe") {
    await runPipe(args, host, dependencies)
    return
  }

  const defaults = await resolveBitvDefaults(host, true)
  const invocation = args.length === 0
    ? resolveCliInvocation(args, host, defaults.interactionMode ?? "ui")
    : explicitInvocation
  const flags = resolveTerminalUiFlags(args.slice(1), {
    renderer: defaults.interactionRenderer ?? "opentui",
    language: defaults.interactionLanguage ?? resolveTerminalLanguage(undefined, host.env),
    theme: defaults.interactionTheme,
  })
  if (flags.error || flags.args.length > 0 || !flags.renderer || !flags.language) {
    writeError(host, flags.error ?? `Unknown ${invocation} argument: ${flags.args[0]}.`)
    process.exitCode = 2
    return
  }
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    writeError(host, `Unknown terminal theme: ${flags.theme}. Available themes: ${listTerminalThemes().join(", ")}.`)
    process.exitCode = 2
    return
  }

  const definition = createBitvInteractionDefinition(defaults, flags.language, host, dependencies)
  if (invocation === "gd") {
    await dependencies.runGuide(definition, { host, language: flags.language })
    return
  }
  await dependencies.runUi(definition, {
    host,
    renderer: flags.renderer,
    language: flags.language,
    theme: flags.theme,
    loadScreen: async () => (await import("./Tui.js")).BitvTui,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args } : undefined,
  })
}

export function createBitvInteractionDefinition(
  defaults: BitvDefaults,
  language: TerminalLanguage,
  host: CliHost,
  dependencies: BitvCliDependencies = defaultDependencies,
): TerminalInteractionDefinition<BitvInput, BitvResult> {
  const schema = createBitvInteractionSchema({
    paths: defaults.paths?.join("\n"),
    reportPath: defaults.reportPath,
    targetPath: defaults.targetPath,
    outputPath: defaults.outputPath,
    recursive: defaults.recursive,
    bitrateStepMbps: defaults.bitrateStepMbps,
    maxLevels: defaults.maxLevels,
    transferMode: defaults.transferMode,
    dryRun: defaults.dryRun,
  }, language)
  return {
    schema,
    run: (input, onEvent) => runBitv(input, dependencies.createRuntime(host), onEvent),
  }
}

async function runPipe(args: string[], host: CliHost, dependencies: BitvCliDependencies): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    writeUsage(host)
    return
  }

  const action = parseAction(args[0])
  if (!action) {
    writeError(host, `Unknown BitV command: ${args[0] ?? ""}. Use \`${CLI_NAME} --help\`.`)
    process.exitCode = 2
    return
  }

  let parsed: ParsedPipeOptions
  try {
    parsed = parsePipeOptions(args.slice(1))
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  const defaults = await resolveBitvDefaults(host, parsed.json)
  let paths = [...parsed.paths]
  if (paths.includes("-")) {
    paths = paths.filter((path) => path !== "-").concat(await readStdinLines(host.stdin))
  } else if (paths.length === 0 && action !== "status" && action !== "report" && !host.stdin.isTTY) {
    paths = await readStdinLines(host.stdin)
  }

  const reportPath = action === "report" ? parsed.reportPath ?? paths.shift() ?? defaults.reportPath : undefined
  const input: BitvInput = {
    action,
    paths: action === "report" ? undefined : paths.length ? paths : defaults.paths,
    reportPath,
    targetPath: parsed.targetPath ?? defaults.targetPath,
    outputPath: parsed.outputPath ?? defaults.outputPath,
    recursive: parsed.recursive ?? defaults.recursive ?? BITV_DEFAULTS.recursive,
    bitrateStepMbps: parsed.bitrateStepMbps ?? defaults.bitrateStepMbps ?? BITV_DEFAULTS.bitrateStepMbps,
    maxLevels: parsed.maxLevels ?? defaults.maxLevels ?? BITV_DEFAULTS.maxLevels,
    transferMode: parsed.transferMode ?? defaults.transferMode ?? BITV_DEFAULTS.transferMode,
    dryRun: parsed.apply ? false : parsed.dryRun ?? defaults.dryRun ?? BITV_DEFAULTS.dryRun,
  }

  try {
    const result = await runBitv(input, dependencies.createRuntime(host), parsed.json ? () => {} : (event) => {
      if (event.message.trim()) writeError(host, event.message)
    })
    if (parsed.json) writeJson(host, result)
    else writePlainResult(host, result)
    if (!result.success) process.exitCode = 1
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

interface ParsedPipeOptions {
  paths: string[]
  reportPath?: string
  targetPath?: string
  outputPath?: string
  recursive?: boolean
  bitrateStepMbps?: number
  maxLevels?: number
  transferMode?: BitvTransferMode
  dryRun?: boolean
  apply: boolean
  json: boolean
}

function parsePipeOptions(args: string[]): ParsedPipeOptions {
  const result: ParsedPipeOptions = { paths: [], apply: false, json: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (arg === "--") {
      result.paths.push(...args.slice(index + 1))
      break
    }
    if (arg === "--json") {
      result.json = true
      continue
    }
    if (arg === "--recursive" || arg === "-R") {
      result.recursive = true
      continue
    }
    if (arg === "--no-recursive") {
      result.recursive = false
      continue
    }
    if (arg === "--copy") {
      result.transferMode = "copy"
      continue
    }
    if (arg === "--move") {
      result.transferMode = "move"
      continue
    }
    if (arg === "--dry-run") {
      result.dryRun = true
      continue
    }
    if (arg === "--apply") {
      result.apply = true
      continue
    }

    const [name, inlineValue] = arg.split("=", 2)
    const valueOption = valueOptionName(name)
    if (valueOption) {
      const value = inlineValue || args[index + 1]
      if (!value) throw new Error(`${name} requires a value.`)
      if (!inlineValue) index += 1
      if (valueOption === "path") result.paths.push(value)
      if (valueOption === "reportPath") result.reportPath = value
      if (valueOption === "targetPath") result.targetPath = value
      if (valueOption === "outputPath") result.outputPath = value
      if (valueOption === "bitrateStepMbps") result.bitrateStepMbps = parsePositiveNumber(value, name)
      if (valueOption === "maxLevels") result.maxLevels = parsePositiveInteger(value, name)
      continue
    }

    if (arg.startsWith("-")) throw new Error(`Unknown BitV option: ${arg}.`)
    result.paths.push(arg)
  }
  return result
}

function valueOptionName(name: string): "path" | "reportPath" | "targetPath" | "outputPath" | "bitrateStepMbps" | "maxLevels" | null {
  if (name === "--path" || name === "-p") return "path"
  if (name === "--report") return "reportPath"
  if (name === "--target" || name === "-t") return "targetPath"
  if (name === "--output" || name === "-o") return "outputPath"
  if (name === "--step" || name === "-s") return "bitrateStepMbps"
  if (name === "--levels" || name === "-l") return "maxLevels"
  return null
}

async function resolveBitvDefaults(host: CliHost, json = false): Promise<BitvDefaults> {
  try {
    const { config } = await loadNodeConfigWithHints<BitvNodeConfig>("bitv", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    const interaction = resolveInteractionPreferences(config)
    return {
      interactionMode: interaction.mode,
      interactionRenderer: interaction.renderer,
      interactionLanguage: interaction.language,
      interactionTheme: interaction.theme,
      paths: normalizeConfigPaths(config?.paths),
      reportPath: config?.report_path?.trim() || undefined,
      targetPath: config?.target_path?.trim() || undefined,
      outputPath: config?.output_path?.trim() || undefined,
      recursive: config?.recursive,
      bitrateStepMbps: config?.bitrate_step_mbps,
      maxLevels: config?.max_levels,
      transferMode: config?.transfer_mode,
      dryRun: config?.dry_run,
    }
  } catch {
    return {}
  }
}

function parseAction(value: string | undefined): BitvAction | null {
  return value === "status" || value === "analyze" || value === "classify" || value === "report" ? value : null
}

function parsePositiveNumber(value: string, flag: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${flag} requires a number greater than zero.`)
  return number
}

function parsePositiveInteger(value: string, flag: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0 || number > 1000) throw new Error(`${flag} requires an integer from 1 to 1000.`)
  return number
}

function normalizeConfigPaths(value: string[] | string | undefined): string[] | undefined {
  if (Array.isArray(value)) return value.map((path) => path.trim()).filter(Boolean)
  if (typeof value === "string") return value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean)
  return undefined
}

function writePlainResult(host: CliHost, result: BitvResult): void {
  writeLine(host, result.message)
  const data = result.data
  if (!data) return
  if (data.videos.length) writeLine(host, `Videos: ${data.videos.length}`)
  if (data.operations.length) writeLine(host, `Operations: ${data.operations.length}${data.dryRun ? " (preview)" : ""}`)
  if (data.reportPath) writeLine(host, `Report: ${data.reportPath}`)
  if (data.errors.length) writeLine(host, `Errors: ${data.errors.length}`)
}

function writeUsage(host: CliHost): void {
  writeLine(host, `${CLI_NAME} - native video bitrate analysis and classification`)
  writeLine(host)
  writeLine(host, "Interactive modes:")
  writeLine(host, `  ${CLI_NAME} ui [--lang zh|en] [--theme default|dracula|high-contrast]`)
  writeLine(host, `  ${CLI_NAME} gd`)
  writeLine(host, `  ${CLI_NAME} guided    Compatibility alias for gd`)
  writeLine(host)
  writeLine(host, "Pipe-safe commands:")
  writeLine(host, `  ${CLI_NAME} status [--json]`)
  writeLine(host, `  ${CLI_NAME} analyze <paths...> [--recursive] [--step 5] [--levels 10] [--output report.json] [--json]`)
  writeLine(host, `  ${CLI_NAME} classify <paths...> --target <dir> [--copy|--move] [--dry-run|--apply] [--json]`)
  writeLine(host, `  ${CLI_NAME} report <report.json> [--target <dir>] [--copy|--move] [--dry-run|--apply] [--json]`)
  writeLine(host)
  writeLine(host, "Classify/report default to dry-run. Use --apply for real file changes.")
}

function createDefaultHost(): CliHost {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
