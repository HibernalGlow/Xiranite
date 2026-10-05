#!/usr/bin/env node
/**
 * The nameu terminal face (ADR-0074 §5).
 *
 * This process holds no node engine. nameu's one implementation is `src/core.ts`, and the host evaluates it
 * in its QuickJS executor; the face resolves a host (attach to one, or start our own child), sends the input
 * document to `POST /nodes/nameu/operations`, and renders what comes back.
 *
 * A run that cannot reach a host stops and says so — the behaviour this replaces was `runNameu(input,
 * createNodeNameuRuntime())` inside the shell, which is the compat path ADR-0074 §5 removes. `HostAttachmentError`
 * already names every way to attach, so the interactive faces resolve the host before they draw anything.
 */
import {
  hasPipedInput,
  isEntryModule,
  nodeCliName,
  readStdinLines,
  runGuidedInteraction,
  writeError,
  writeJson,
  writeLine,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import type { TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { NameuAction, NameuData, NameuInput, NameuMode, NameuResult } from "./core.js"
import { createNameuInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("nameu")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "nameu"
/** The plain-text plan listing stays capped the way the runner capped it. */
const PIPE_ITEM_LIMIT = 80

interface NameuNodeConfig extends CliInteractionPreferencesSource {
  mode?: NameuMode
  recursive?: boolean
  add_artist_name?: boolean
  normalize_folders?: boolean
  keep_timestamp?: boolean
  dry_run?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Native archive rename planner.",
  run: (args, host) => runProgram(args, host),
}

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  // The attach flags belong to the face, not to the node: they leave argv before the pipe parser reads it and
  // are folded into the host env, so one object carries the attach for the whole invocation and the flags can
  // never reach a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this invocation, so it
  // stops with it. An attached host is left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({
      args: attach.remaining,
      host: attachedHost,
      cliName: CLI_NAME,
      loadContext: async () => {
        const { config } = await loadNodeConfigWithHints<NameuNodeConfig>(NODE_ID, {
          env: attachedHost.env,
          cwd: attachedHost.cwd,
          hintSink: { stderr: attachedHost.stderr },
          jsonMode: true,
        })
        return { preferences: resolveInteractionPreferences(config), value: config ?? {} }
      },
      createDefinition: (config, language) => createNameuHostDefinition(attachedHost, config, language),
      runPipe,
      runGuide: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runGuidedInteraction(definition, options)
      },
      runUi: async (definition, options) => {
        // The workbench is the product, but opening it without a host would let the operator fill in the whole
        // desk before the first dead end, so the host is resolved before the renderer starts.
        if (!await hostReady(attachedHost)) return
        await runTerminalUi(definition, options)
      },
      loadScreen: async () => (await import("./Tui.js")).NameuTui,
      createPreferences: (_config, current) => nameuPreferences(attachedHost, current),
      reexecEntrypoint: process.argv[1],
      help,
    })
  } finally {
    await stopSharedHost()
  }
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
 * The host for this face process, resolved once: attach to a host that is already running, or start one as our
 * own child when the operator configured nothing. The memo lives in `@xiranite/cli-runtime`, because host
 * lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is written to this face's error line (it already names every way to
 * attach and says when no host binary was found), so interactive callers only have to stop before drawing
 * anything.
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
 * The definition the `ui`, `gd` and `pipe` faces share. The node owns only the schema; the run and the control
 * calls go to the host, and the started record is kept so cancel, pause and resume address the operation this
 * face actually started.
 */
export function createNameuHostDefinition(
  host: CliHost,
  config: NameuNodeConfig,
  language: TerminalLanguage,
): TerminalInteractionDefinition<NameuInput, NameuResult> {
  const schema = createNameuInteractionSchema(
    {
      mode: config.mode,
      recursive: config.recursive,
      addArtistName: config.add_artist_name,
      normalizeFolders: config.normalize_folders,
      keepTimestamp: config.keep_timestamp,
      dryRun: config.dry_run,
    },
    language,
  )
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<NameuData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<NameuData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => {
      if (running) await running.client.pauseOperation(running.operationId)
    },
    resume: async () => {
      if (running) await running.client.resumeOperation(running.operationId)
    },
    cancel: async () => {
      if (running) await running.client.cancelOperation(running.operationId)
    },
  }
}

/**
 * Attaches to the host, runs the operation and returns its result document, or `undefined` when the attach or
 * the transport failed — reported on this face's error line with exit code 1. Failures are caught here instead
 * of thrown because a run that simply did not work is a result with `success: false`, not a throw, and a face
 * that cannot reach a host must not answer by running the node locally.
 */
async function runNameuOnHost(
  host: CliHost,
  input: NameuInput,
  onEvent?: (event: OperationEvent) => void,
): Promise<NameuResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<NameuData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

async function runPipe(args: string[], host: CliHost): Promise<void> {
  if (!args.length) {
    writeLine(host, `${CLI_NAME} ui | gd | scan | plan | rename`)
    return
  }

  const json = args.includes("--json")
  const action: NameuAction = args.includes("rename") || args.includes("run")
    ? "rename"
    : args.includes("scan")
      ? "scan"
      : "plan"
  const { config } = await loadNodeConfigWithHints<NameuNodeConfig>(NODE_ID, {
    env: host.env,
    cwd: host.cwd,
    hintSink: { stderr: host.stderr },
    jsonMode: json,
  })

  let paths = pathArgs(args)
  if (paths.includes("-")) {
    paths = paths.filter((path) => path !== "-").concat(await readStdinLines(host.stdin))
  } else if (!paths.length && hasPipedInput(host.stdin) && Symbol.asyncIterator in Object(host.stdin)) {
    paths = await readStdinLines(host.stdin)
  }

  const input: NameuInput = {
    action,
    paths,
    mode: (valueFor(args, "--mode") as NameuMode | undefined) ?? config?.mode,
    recursive: args.includes("--no-recursive") ? false : config?.recursive,
    addArtistName: args.includes("--no-artist") ? false : config?.add_artist_name,
    normalizeFolders: args.includes("--no-folder-normalize") ? false : config?.normalize_folders,
    keepTimestamp: args.includes("--no-keep-time") ? false : config?.keep_timestamp,
    dryRun: action !== "rename" || args.includes("--dry-run") || config?.dry_run === true,
  }

  // No event rendering here, exactly as before: the plain-text answer stays `message` plus the plan listing,
  // and `--json` stays a single clean document on stdout.
  const result = await runNameuOnHost(host, input)
  if (!result) return

  if (json) {
    writeJson(host, result)
  } else {
    writeLine(host, result.message)
    for (const item of result.data?.items.slice(0, PIPE_ITEM_LIMIT) ?? []) {
      writeLine(host, `${item.status}\t${item.sourcePath}\t->\t${item.targetName}`)
    }
  }
  if (!result.success) process.exitCode = 1
}

function nameuPreferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return {
    nodeId: NODE_ID,
    current,
    async save(values: TerminalPreferenceValues) {
      await updateNodeConfigFile(NODE_ID, { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options)
    },
    async restore() {
      const { config } = await loadNodeConfigWithHints<NameuNodeConfig>(NODE_ID, { ...options, jsonMode: true })
      const preferences = resolveInteractionPreferences(config)
      return { theme: preferences.theme, defaultMode: preferences.mode, language: preferences.language ?? "zh" }
    },
  }
}

const defaultHost = (): CliHost => ({
  cwd: process.cwd(),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
})

/**
 * Positional folder paths: every bare argument that is not one of the action words, and not the value that
 * follows `--mode` (which is a mode name, never a path).
 */
function pathArgs(args: string[]): string[] {
  const commands = new Set(["scan", "plan", "rename", "run"])
  const valued = new Set(["--mode"])
  return args.filter((value, index) => !value.startsWith("--") && !commands.has(value) && !valued.has(args[index - 1] ?? ""))
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

if (isEntryModule(import.meta.url)) {
  try {
    await runProgram()
  } catch (error) {
    writeError(defaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
