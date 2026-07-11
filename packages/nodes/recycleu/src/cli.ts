#!/usr/bin/env node
import { pathToFileURL } from "node:url"

import { nodeCliName, runGuidedInteraction, writeError, writeJson, writeLine, type CliCommand, type CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi } from "@xiranite/cli-runtime/terminal"
import type { TerminalPreferenceController, TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, loadXiraniteConfig, saveXiraniteConfig, updateNodeConfig } from "@xiranite/config"

import type { RecycleuAction, RecycleuInput, RecycleuResult, RecycleuRuntime } from "./core.js"
import { runRecycleu } from "./core.js"
import { createRecycleuInteractionSchema, type RecycleuInteractionValues } from "./interaction.js"
import { createNodeRecycleuRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("recycleu")
export const RECYCLEU_CYCLES_HELP = "Maximum clean cycles; use 0 for unlimited."

interface RecycleuNodeConfig extends CliInteractionPreferencesSource {
  interval?: number
  max_cycles?: number
  drive_letter?: string
}

interface RecycleuDefaults {
  interval?: number
  maxCycles?: number
  driveLetter?: string
}

export interface RecycleuCliDependencies {
  createRuntime: (host: CliHost) => RecycleuRuntime
  runGuide: <Input, Result>(definition: TerminalInteractionDefinition<Input, Result>, options: { host: CliHost; language: TerminalLanguage }) => Promise<void>
  runUi: typeof runTerminalUi
}

const defaultDependencies: RecycleuCliDependencies = {
  createRuntime: () => createNodeRecycleuRuntime(),
  runGuide: runGuidedInteraction,
  runUi: runTerminalUi,
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Empty the Windows recycle bin immediately or on a controlled schedule.",
  run: (args, host) => runProgram(args, host),
}

export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createDefaultHost(),
  dependencies: RecycleuCliDependencies = defaultDependencies,
): Promise<void> {
  await runInteractionCli({
    args, host, cliName: CLI_NAME,
    loadContext: () => resolveRecycleuContext(host, true),
    createDefinition: (defaults, language) => createRecycleuInteractionDefinition(defaults, language, host, dependencies),
    runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runPipe(pipeArgs, pipeHost, dependencies) : Promise.resolve(writeUsage(pipeHost)),
    runGuide: dependencies.runGuide,
    runUi: dependencies.runUi,
    loadScreen: async () => (await import("./Tui.js")).RecycleuTui,
    createPreferences: (_defaults, values) => createPreferenceController(host, values),
    reexecEntrypoint: process.argv[1],
  })
}

function createPreferenceController(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const configOptions = { env: host.env, cwd: host.cwd }
  return {
    nodeId: "recycleu",
    current,
    async save(values) {
      const { config, path } = await loadXiraniteConfig(configOptions)
      const updated = updateNodeConfig(config, "recycleu", {
        cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language },
      })
      await saveXiraniteConfig(updated, { ...configOptions, configPath: path })
    },
    async restore() {
      const { config } = await loadNodeConfigWithHints<RecycleuNodeConfig>("recycleu", { ...configOptions, jsonMode: true })
      const preferences = resolveInteractionPreferences(config)
      return {
        theme: preferences.theme,
        defaultMode: preferences.mode,
        language: preferences.language ?? resolveTerminalLanguage(undefined, host.env),
      }
    },
  }
}

export function createRecycleuInteractionDefinition(
  defaults: RecycleuDefaults,
  language: TerminalLanguage,
  host: CliHost,
  dependencies: RecycleuCliDependencies = defaultDependencies,
): TerminalInteractionDefinition<RecycleuInput, RecycleuResult> {
  let cancellationRequested = false
  const initial: Partial<RecycleuInteractionValues> = {
    interval: defaults.interval,
    maxCycles: defaults.maxCycles,
    driveLetter: defaults.driveLetter,
  }
  return {
    schema: createRecycleuInteractionSchema(initial, language),
    async run(input, onEvent) {
      cancellationRequested = false
      const runtime = dependencies.createRuntime(host)
      return await runRecycleu(input, {
        ...runtime,
        isCancelled: () => cancellationRequested || runtime.isCancelled?.() === true,
      }, onEvent)
    },
    cancel: () => { cancellationRequested = true },
  }
}

async function runPipe(args: string[], host: CliHost, dependencies: RecycleuCliDependencies): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    writeUsage(host)
    return
  }
  const action = parseAction(args[0])
  if (!action) {
    writeError(host, `Unknown RecycleU command: ${args[0] ?? ""}. Use \`${CLI_NAME} --help\`.`)
    process.exitCode = 2
    return
  }
  try {
    const options = parsePipeOptions(args.slice(1))
    const { value: defaults } = await resolveRecycleuContext(host, options.json)
    const input: RecycleuInput = {
      action,
      driveLetter: options.drive ?? defaults.driveLetter ?? "",
      interval: options.interval ?? defaults.interval ?? 10,
      maxCycles: options.cycles ?? defaults.maxCycles ?? 360,
    }
    const result = await runRecycleu(input, dependencies.createRuntime(host), (event) => {
      if (!options.json && event.message.trim()) writeLine(host, event.message)
    })
    if (options.json) writeJson(host, result)
    else writeLine(host, result.message)
    if (!result.success) process.exitCode = 1
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}

function parsePipeOptions(args: string[]) {
  const options: { drive?: string; interval?: number; cycles?: number; json: boolean } = { json: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (arg === "--json") { options.json = true; continue }
    const [name, inline] = arg.split("=", 2)
    if (name !== "--drive" && name !== "--interval" && name !== "--cycles") throw new Error(`Unknown RecycleU option: ${arg}.`)
    const value = inline ?? args[++index]
    if (!value) throw new Error(`${name} requires a value.`)
    if (name === "--drive") options.drive = value
    if (name === "--interval") options.interval = parseInteger(value, name, 5)
    if (name === "--cycles") options.cycles = parseInteger(value, name, 0)
  }
  return options
}

async function resolveRecycleuContext(host: CliHost, json = false): Promise<{ preferences: CliInteractionPreferences; value: RecycleuDefaults }> {
  try {
    const { config } = await loadNodeConfigWithHints<RecycleuNodeConfig>("recycleu", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
    const interaction = resolveInteractionPreferences(config)
    return { preferences: interaction, value: { interval: config?.interval, maxCycles: config?.max_cycles, driveLetter: config?.drive_letter?.trim() || undefined } }
  } catch {
    return { preferences: resolveInteractionPreferences(undefined), value: {} }
  }
}

function parseAction(value: string | undefined): RecycleuAction | null {
  if (value === "status") return "status"
  if (value === "clean" || value === "clean_now") return "clean_now"
  if (value === "start") return "start"
  return null
}

function parseInteger(value: string, flag: string, min: number): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min) throw new Error(`${flag} must be an integer of at least ${min}.`)
  return number
}

function writeUsage(host: CliHost) {
  writeLine(host, `Usage:\n  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]\n  ${CLI_NAME} gd\n  ${CLI_NAME} status [--json]\n  ${CLI_NAME} clean [--drive C] [--json]\n  ${CLI_NAME} start [--drive C] [--interval 10] [--cycles 360] [--json]`)
}

function createDefaultHost(): CliHost {
  return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runProgram().catch((error) => {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
