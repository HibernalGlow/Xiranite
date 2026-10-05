#!/usr/bin/env node
import { pathToFileURL } from "node:url"

import { nodeCliName, runGuidedInteraction, writeError, writeJson, writeLine, type CliCommand, type CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi } from "@xiranite/cli-runtime/terminal"
import type { TerminalPreferenceController, TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"

import type { RecycleuAction, RecycleuData, RecycleuInput, RecycleuResult } from "./core.js"
import { createRecycleuInteractionSchema, type RecycleuInteractionValues } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("recycleu")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "recycleu"
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

/**
 * The two terminal renderers, injectable so a test can capture the definition the `gd`/`ui`
 * gate hands over without opening a real OpenTUI session. Neither seam carries node logic:
 * the run itself is the host client built in `hostOperationsClient`, never an in-process core.
 */
export interface RecycleuCliDependencies {
  runGuide: <Input, Result>(definition: TerminalInteractionDefinition<Input, Result>, options: { host: CliHost; language: TerminalLanguage }) => Promise<void>
  runUi: typeof runTerminalUi
}

const defaultDependencies: RecycleuCliDependencies = {
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
  // The attach flags belong to the face, not to the node: they leave argv before the command
  // router sees them and are folded into the host env, so one object carries the attach for the
  // whole invocation and the flags can never reach a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this
  // invocation, so it stops with it. An attached host is left exactly where it was.
  try {
    await runInteractionCli({
      args: attach.remaining, host: attachedHost, cliName: CLI_NAME,
      loadContext: () => resolveRecycleuContext(attachedHost, true),
      createDefinition: (defaults, language) => createRecycleuHostDefinition(defaults, language, attachedHost),
      runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runPipe(pipeArgs, pipeHost) : Promise.resolve(writeUsage(pipeHost)),
      // `ui`/`gd` confirm the host is present before drawing anything (ADR-0074 §5): a guided run
      // that spends its prompts and only then reports a dead host burns the operator's attention.
      runGuide: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await dependencies.runGuide(definition, options)
      },
      runUi: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await dependencies.runUi(definition, options)
      },
      loadScreen: async () => (await import("./Tui.js")).RecycleuTui,
      createPreferences: (_defaults, values) => createPreferenceController(attachedHost, values),
      reexecEntrypoint: process.argv[1],
      help,
    })
  } finally {
    await stopSharedHost()
  }
}

/**
 * Folds `--backend`/`--token`/`--channel-file` into the host env, which is where
 * `@xiranite/cli-runtime/backend` reads them as its second and third resolution steps; a flag
 * therefore outranks a real environment value.
 */
function withAttachFlags(host: CliHost, flags: Partial<Record<HostAttachFlag, string>>): CliHost {
  const env = { ...host.env }
  if (flags.backend) env.XIRANITE_BACKEND_URL = flags.backend
  if (flags.token) env.XIRANITE_BACKEND_TOKEN = flags.token
  if (flags.channelFile) env.XIRANITE_CHANNEL_FILE = flags.channelFile
  return { ...host, env }
}

/**
 * The host for this face process, resolved once (ADR-0074 §6): attach to a host that is already
 * running, or start one as our own child when the operator configured nothing. The memo itself
 * lives in `@xiranite/cli-runtime`, because host lifecycle is a terminal concern and not each
 * node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is written to this face's error line (it already names
 * every way to attach and says when no host binary was found), so interactive callers only have
 * to stop before drawing anything.
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
 * Attaches to the host, runs the operation and returns its result document, or `undefined` when
 * the attach or the transport failed — reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that
 * fallback is the compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to
 * get a host. Failures are caught here instead of thrown because citty's `runMain` answers a
 * thrown error with `process.exit(1)` and drops buffered stdout; setting `process.exitCode`
 * keeps the two codes this CLI uses (1 failure, 2 usage) and leaves `--json` output clean.
 * A run that simply did not work is a result with `success: false`, not a throw.
 */
async function runRecycleuOnHost(
  host: CliHost,
  input: RecycleuInput,
  onEvent?: (event: OperationEvent) => void,
): Promise<RecycleuResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<RecycleuData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema — fields,
 * defaults, the danger prompt included; the run and the control calls go to the host, and the
 * started record is kept so cancel, pause and resume address the operation this face actually
 * started (docs/migration/face-operations-migration.md §3).
 */
export function createRecycleuHostDefinition(
  defaults: RecycleuDefaults,
  language: TerminalLanguage,
  host: CliHost,
): TerminalInteractionDefinition<RecycleuInput, RecycleuResult> {
  const initial: Partial<RecycleuInteractionValues> = {
    interval: defaults.interval,
    maxCycles: defaults.maxCycles,
    driveLetter: defaults.driveLetter,
  }
  const schema = createRecycleuInteractionSchema(initial, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<RecycleuData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<RecycleuData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function createPreferenceController(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const configOptions = { env: host.env, cwd: host.cwd }
  return {
    nodeId: "recycleu",
    current,
    async save(values) {
      await updateNodeConfigFile("recycleu", {
        cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language },
      }, configOptions)
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

async function runPipe(args: string[], host: CliHost): Promise<void> {
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
  let options: ReturnType<typeof parsePipeOptions>
  try {
    options = parsePipeOptions(args.slice(1))
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }
  const { value: defaults } = await resolveRecycleuContext(host, options.json)
  const input: RecycleuInput = {
    action,
    driveLetter: options.drive ?? defaults.driveLetter ?? "",
    interval: options.interval ?? defaults.interval ?? 10,
    maxCycles: options.cycles ?? defaults.maxCycles ?? 360,
  }
  const result = await runRecycleuOnHost(host, input, (event) => {
    if (!options.json && event.message.trim()) writeLine(host, event.message)
  })
  if (!result) return
  if (options.json) writeJson(host, result)
  else writeLine(host, result.message)
  if (!result.success) process.exitCode = 1
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
