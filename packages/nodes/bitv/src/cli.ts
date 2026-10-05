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
import { listTerminalThemes, runTerminalUi, writeTerminalNodeHelp } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints } from "@xiranite/config/node"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"

import type { BitvAction, BitvData, BitvInput, BitvResult, BitvTransferMode } from "./core.js"
import { createBitvInteractionSchema } from "./interaction.js"
import { help } from "./help.js"
import type { NodeHelp } from "@xiranite/contract"

const CLI_NAME = nodeCliName("bitv")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "bitv"

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
  /**
   * Only the two interactive renderers are injectable. The node engine is not: it lives in the host,
   * so there is no runtime factory to hand in any more (ADR-0074 §5) — tests attach a scripted
   * `/operations` server through the host env instead.
   */
  runGuide: <Input, Result>(
    definition: TerminalInteractionDefinition<Input, Result>,
    options: { host: CliHost; language: TerminalLanguage; help?: NodeHelp },
  ) => Promise<void>
  runUi: typeof runTerminalUi
}

const defaultDependencies: BitvCliDependencies = {
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
  // The attach flags belong to the face, not to the node: they leave argv before the pipe router and the
  // ui/gd flag resolver see them, and are folded into the host env, so they can never reach a bitv input
  // document and one object carries the attach for the whole invocation.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)
  const remaining = attach.remaining

  try {
    await runFace(remaining, attachedHost, dependencies)
  } finally {
    // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this invocation,
    // so it stops with it. An attached host is left exactly where it was (`stop()` is a no-op on it).
    await stopSharedHost()
  }
}

async function runFace(args: string[], host: CliHost, dependencies: BitvCliDependencies): Promise<void> {
  if (args[0] === "help" || args.includes("--help") || args.includes("-h")) {
    writeTerminalNodeHelp(host, help, resolveTerminalLanguage(undefined, host.env))
    return
  }
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
    await runPipe(args, host)
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

  // The ui and gd screens are the product, but opening one without a host would let the operator fill in
  // the whole workbench before the first dead end, so the host is resolved before the renderer starts.
  if (!await hostReady(host)) return

  const definition = createBitvHostDefinition(defaults, flags.language, host)
  if (invocation === "gd") {
    await dependencies.runGuide(definition, { host, language: flags.language, help })
    return
  }
  await dependencies.runUi(definition, {
    host,
    renderer: flags.renderer,
    language: flags.language,
    theme: flags.theme,
    help,
    loadScreen: async () => (await import("./Tui.js")).BitvTui,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args } : undefined,
  })
}

/**
 * Folds `--backend`/`--token`/`--channel-file` into the host env, which is where
 * `@xiranite/cli-runtime/backend` reads them as its second and third resolution steps; a flag therefore
 * outranks a real environment value.
 */
function withAttachFlags(host: CliHost, flags: Partial<Record<HostAttachFlag, string>>): CliHost {
  const env = { ...host.env }
  if (flags.backend) env.XIRANITE_BACKEND_URL = flags.backend
  if (flags.token) env.XIRANITE_BACKEND_TOKEN = flags.token
  if (flags.channelFile) env.XIRANITE_CHANNEL_FILE = flags.channelFile
  return { ...host, env }
}

/**
 * The host for this face process, resolved once (ADR-0074 §6): attach to a host that is already running,
 * or start one as our own child when the operator configured nothing. The memo itself lives in
 * `@xiranite/cli-runtime`, because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is already written to this face's error line, and that line names
 * every way to attach, so an interactive caller only has to stop before drawing anything.
 */
async function hostReady(host: CliHost): Promise<boolean> {
  try {
    await resolveHostHandle(host)
    return true
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return false
  }
}

/** A client bound to the resolved host, or a rejection naming what is missing. */
async function hostOperationsClient(host: CliHost): Promise<OperationsClient> {
  const handle = await resolveHostHandle(host)
  return createOperationsClient({ baseUrl: handle.attachment.baseUrl, token: handle.attachment.token })
}

/**
 * Attaches to the host, runs the operation and returns its result document, or `undefined` when the attach
 * or the transport failed — reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that fallback is
 * the compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to get a host.
 * Failures are caught here instead of thrown because this face's own router answers a thrown error with
 * `process.exit(1)` and drops buffered stdout; setting `process.exitCode` keeps the two codes this CLI uses
 * (1 failure, 2 usage) and leaves `--json` output clean. A run that simply did not work is a result with
 * `success: false`, not a throw.
 */
async function runBitvOnHost(
  host: CliHost,
  input: BitvInput & { action: BitvAction },
  onEvent?: (event: OperationEvent) => void,
): Promise<BitvResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<BitvData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema; the run and the
 * control calls go to the host, and the started record is kept so cancel, pause and resume address the
 * operation this face actually started.
 */
export function createBitvHostDefinition(
  defaults: BitvDefaults,
  language: TerminalLanguage,
  host: CliHost,
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
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<BitvData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<BitvData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

async function runPipe(args: string[], host: CliHost): Promise<void> {
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
  // Unset numbers, booleans and transfer modes stay unset: `BITV_DEFAULTS` is the host's table, read by the
  // core that runs the action, and a face that copies it here would hold a second copy of the node's defaults.
  const input: BitvInput & { action: BitvAction } = {
    action,
    paths: action === "report" ? undefined : paths.length ? paths : defaults.paths,
    reportPath,
    targetPath: parsed.targetPath ?? defaults.targetPath,
    outputPath: parsed.outputPath ?? defaults.outputPath,
    recursive: parsed.recursive ?? defaults.recursive,
    bitrateStepMbps: parsed.bitrateStepMbps ?? defaults.bitrateStepMbps,
    maxLevels: parsed.maxLevels ?? defaults.maxLevels,
    transferMode: parsed.transferMode ?? defaults.transferMode,
    dryRun: parsed.apply ? false : parsed.dryRun ?? defaults.dryRun,
  }

  const result = await runBitvOnHost(host, input, parsed.json ? undefined : (event) => {
    if (event.message.trim()) writeError(host, event.message)
  })
  // `undefined` is the attach or transport failure, already reported with exit code 1 by the helper.
  if (!result) return
  if (parsed.json) writeJson(host, result)
  else writePlainResult(host, result)
  if (!result.success) process.exitCode = 1
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
