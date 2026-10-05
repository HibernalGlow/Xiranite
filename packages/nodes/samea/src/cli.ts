#!/usr/bin/env node
import { hasPipedInput, isEntryModule, nodeCliName, readStdinLines, runGuidedInteraction, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"
import type { SameaAction, SameaData, SameaInput, SameaResult } from "./core.js"
import { createSameaInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("samea")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "samea"
/** The pipe listing cap this CLI has always had; the host returns the whole document. */
const PIPE_ITEM_LIMIT = 100

interface SameaConfig extends CliInteractionPreferencesSource {
  ignore_path_blacklist?: boolean; min_occurrences?: number; centralize?: boolean; dry_run?: boolean
  artist_blacklist?: string[]; path_blacklist?: string[]; regex_blacklist?: string[]; archive_extensions?: string[]
}
export const cli: CliCommand = { name: CLI_NAME, description: help.short, run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  // The attach flags belong to the face, not to the node: they leave argv before the router sees them,
  // so `--backend <url>` can never be read as an archive root and never reaches a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5 puts the host lifecycle in this invocation: a host this face started stops with it, while
  // a host it attached to is left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({
      args: attach.remaining, host: attachedHost, cliName: CLI_NAME,
      loadContext: async () => { const { config } = await loadNodeConfigWithHints<SameaConfig>(NODE_ID, { env: attachedHost.env, cwd: attachedHost.cwd, hintSink: { stderr: attachedHost.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
      createDefinition: (defaults, language) => createSameaHostDefinition(attachedHost, defaults, language),
      runPipe,
      // Opening a screen without a host would let the operator fill the whole workbench before the first
      // dead end, so the host is resolved before the renderer or the guide asks anything.
      runGuide: async (definition, options) => { if (await hostReady(attachedHost)) await runGuidedInteraction(definition, options) },
      runUi: async (definition, options) => { if (await hostReady(attachedHost)) await runTerminalUi(definition, options) },
      loadScreen: async () => (await import("./Tui.js")).SameaTui,
      createPreferences: (_defaults, current) => preferences(attachedHost, current), reexecEntrypoint: process.argv[1], help,
    })
  } finally {
    await stopSharedHost()
  }
}

/**
 * The `ui`/`gd` definition. The node owns only the shared schema — including `isDangerous` and
 * `dangerPrompt`, which the session consults *before* it calls `run`, so live classification still needs
 * an explicit confirmation — and every byte of work goes to the host, whose own root grants come from the
 * node manifest rather than from anything invented here. The started record is kept so cancel, pause and
 * resume address the operation this face actually started.
 */
export function createSameaHostDefinition(host: CliHost, defaults: SameaConfig, language: TerminalLanguage): TerminalInteractionDefinition<SameaInput, SameaResult> {
  const schema = createSameaInteractionSchema({ ignorePathBlacklist: defaults.ignore_path_blacklist, minOccurrences: defaults.min_occurrences, centralize: defaults.centralize, dryRun: defaults.dry_run, artistBlacklist: defaults.artist_blacklist?.join("\n"), pathBlacklist: defaults.path_blacklist?.join("\n"), regexBlacklist: defaults.regex_blacklist?.join("\n"), archiveExtensions: defaults.archive_extensions?.join("\n") }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<SameaData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<SameaData>(started, onEvent)
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
  if (!args.length) { writeLine(host, `${CLI_NAME} ui | gd | plan | classify`); return }
  const json = args.includes("--json")
  const action: SameaAction = args.includes("classify") || args.includes("run") ? "classify" : "plan"
  let paths = pathArgs(args)
  if (paths.includes("-")) paths = paths.filter((path) => path !== "-").concat(await readStdinLines(host.stdin))
  else if (!paths.length && hasPipedInput(host.stdin) && Symbol.asyncIterator in Object(host.stdin)) paths = await readStdinLines(host.stdin)
  const { config } = await loadNodeConfigWithHints<SameaConfig>(NODE_ID, { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
  const result = await runSameaOnHost(host, { action, paths, minOccurrences: numberFor(args, "--min") ?? config?.min_occurrences, centralize: args.includes("--centralize") || config?.centralize === true, ignorePathBlacklist: args.includes("--ignore-path-blacklist") || config?.ignore_path_blacklist === true, dryRun: action !== "classify" || args.includes("--dry-run") || config?.dry_run !== false, artistBlacklist: config?.artist_blacklist, pathBlacklist: config?.path_blacklist, regexBlacklist: config?.regex_blacklist, archiveExtensions: config?.archive_extensions })
  if (!result) return
  if (json) writeJson(host, result); else { writeLine(host, result.message); for (const item of result.data?.items.slice(0, PIPE_ITEM_LIMIT) ?? []) writeLine(host, `${item.status}\t${item.artistName}\t${item.sourcePath}\t->\t${item.targetPath}`) }
  if (!result.success) process.exitCode = 1
}

/**
 * Runs one operation on the host and returns its result document, or `undefined` when the attach or the
 * transport failed — already reported on this face's error line with exit code 1. A terminal face that
 * cannot reach a host stops rather than running `core.ts` locally: that fallback is the compat path
 * ADR-0074 §5 removes, and `HostAttachmentError` names every way to get a host. Failures are caught here
 * instead of thrown because `process.exitCode` keeps `--json` output clean, while a run that simply did
 * not work is a result with `success: false` and not a throw.
 */
async function runSameaOnHost(host: CliHost, input: SameaInput, onEvent?: (event: OperationEvent) => void): Promise<SameaResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<SameaData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/** Folds `--backend`/`--token`/`--channel-file` into the host env, where the backend module reads them as
 * its second and third resolution steps; a flag therefore outranks a real environment value. */
function withAttachFlags(host: CliHost, flags: Partial<Record<HostAttachFlag, string>>): CliHost {
  const env = { ...host.env }
  if (flags.backend) env.XIRANITE_BACKEND_URL = flags.backend
  if (flags.token) env.XIRANITE_BACKEND_TOKEN = flags.token
  if (flags.channelFile) env.XIRANITE_CHANNEL_FILE = flags.channelFile
  return { ...host, env }
}

/** The host for this face process, resolved once: attach to a running host, or start our own child. */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/** True when a host is ready; the reason is written to this face's error line, which already names every way to attach. */
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

function preferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: NODE_ID, current, async save(value) { await updateNodeConfigFile(NODE_ID, { cli: { theme: value.theme, default_mode: value.defaultMode, language: value.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<SameaConfig>(NODE_ID, { ...options, jsonMode: true }); const value = resolveInteractionPreferences(config); return { theme: value.theme, defaultMode: value.mode, language: value.language ?? "zh" } } }
}
function pathArgs(args: string[]): string[] { const commands = new Set(["plan", "classify", "run"]), valueOptions = new Set(["--min"]); return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? "")) }
function numberFor(args: string[], flag: string): number | undefined { const index = args.indexOf(flag), value = index >= 0 ? args[index + 1] : undefined; return value === undefined ? undefined : Number(value) }
const defaultHost = (): CliHost => ({ cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
if (isEntryModule(import.meta.url)) await runProgram()
