#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { createCliHost, nodeCliName, runGuidedInteraction, writeError, writeJson, writeLine, type CliCommand, type CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationsClient } from "@xiranite/cli-runtime/backend"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"
import { createLogxInteractionSchema } from "./interaction.js"
// ADR-0074 §5: this face owns no engine. `./core.js` is imported as types only — the single
// implementation of `runLogx` runs in the host's QuickJS realm and is reached over `/operations`.
// `./platform.js` (the Node runtime factory the host bundle consumes) is not imported here at all.
import type { LogxAction, LogxData, LogxInput, LogxResult } from "./core.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("logx")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "logx"
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const
interface LogxConfig extends CliInteractionPreferencesSource { directory?: string; minimum_severity?: LogxInput["minimumSeverity"]; limit?: number }

export const cli: CliCommand = { name: CLI_NAME, description: "Analyze Xiranite structured logs.", run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = createCliHost()): Promise<void> {
  // The attach flags belong to the face and not to the node: they leave argv before the pipe router's
  // `parseArgs` (strict) ever sees them, and are folded into the host env, so `--backend` can never
  // turn into a node parameter.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // A host this face started belongs to this invocation and stops with it; a host it merely attached
  // to is left exactly where it was (ADR-0074 §5 makes the host lifecycle CLI work).
  try {
    await runInteractionCli({
      args: attach.remaining,
      host: attachedHost,
      cliName: CLI_NAME,
      loadContext: async () => { const { config } = await loadNodeConfigWithHints<LogxConfig>(NODE_ID, { env: attachedHost.env, cwd: attachedHost.cwd, hintSink: { stderr: attachedHost.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
      createDefinition: (defaults, language) => createLogxHostDefinition(attachedHost, defaults, language),
      runPipe: (pipeArgs, pipeHost) => runDirect(pipeArgs, pipeHost),
      // LogX answers every action by reading the log directory, so opening an interactive surface
      // without a host would let the operator fill the whole workbench before the first dead end.
      // The refusal comes first and names every way to attach.
      runGuide: async (definition, options) => { if (await hostReady(attachedHost)) await runGuidedInteraction(definition, options) },
      runUi: async (definition, options) => { if (await hostReady(attachedHost)) await runTerminalUi(definition, options) },
      loadScreen: async () => (await import("./Tui.js")).LogxTui,
      createPreferences: (_defaults, current) => preferences(attachedHost, current), reexecEntrypoint: process.argv[1], help,
    })
  } finally {
    await stopSharedHost()
  }
}

async function runDirect(args: string[], host: CliHost): Promise<void> {
  const [command = "query", ...rest] = args
  const parsed = parseArgs({ args: rest, allowPositionals: true, strict: true, options: {
    dir: { type: "string" }, level: { type: "string" }, scope: { type: "string" }, event: { type: "string" }, session: { type: "string" }, search: { type: "string" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "string" }, order: { type: "string" }, json: { type: "boolean", default: false },
  } })
  if (!(["query", "sessions", "stats", "errors", "doctor"] as string[]).includes(command)) throw new Error(`Unknown LogX command: ${command}`)
  const minimumSeverity = parsed.values.level
  if (minimumSeverity && !LOG_LEVELS.includes(minimumSeverity as typeof LOG_LEVELS[number])) throw new Error(`Invalid --level: ${minimumSeverity}`)
  const order = parsed.values.order
  if (order && order !== "asc" && order !== "desc") throw new Error(`Invalid --order: ${order}`)
  const limit = parsed.values.limit ? Number(parsed.values.limit) : undefined
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 5_000)) throw new Error(`Invalid --limit: ${parsed.values.limit}`)
  const input: LogxInput = { action: command as LogxAction, directory: parsed.values.dir, minimumSeverity: minimumSeverity as LogxInput["minimumSeverity"], scope: parsed.values.scope, eventName: parsed.values.event, sessionId: parsed.values.session, search: parsed.values.search, since: parsed.values.since, until: parsed.values.until, limit, order: order as LogxInput["order"] }
  // The pipe surface never streamed progress before, so it does not start now; it only changes which
  // process computes the answer.
  const result = await runLogxOnHost(host, input)
  if (!result) return
  if (!result.data) throw new Error(result.message)
  const output = command === "sessions" ? result.data.sessions : command === "stats" ? { aggregate: result.data.aggregate, telemetry: result.data.telemetry } : command === "errors" ? result.data.aggregate.errors : command === "doctor" ? { directory: result.data.directory, files: result.data.files, events: result.data.matchedCount, issues: result.data.issues } : result.data.events
  if (parsed.values.json || command === "stats" || command === "doctor") writeJson(host, output)
  else if (Array.isArray(output)) output.forEach((item) => writeLine(host, formatRow(command as LogxAction, item)))
  else writeJson(host, output)
  if (!result.success) process.exitCode = 1
}

/**
 * Folds `--backend`/`--token`/`--channel-file` into the host env, which is where
 * `@xiranite/cli-runtime/backend` reads them as its second and third resolution steps; a flag therefore
 * outranks a real environment value, and the env is what survives the OpenTUI re-exec.
 */
function withAttachFlags(host: CliHost, flags: Partial<Record<HostAttachFlag, string>>): CliHost {
  const env = { ...host.env }
  if (flags.backend) env.XIRANITE_BACKEND_URL = flags.backend
  if (flags.token) env.XIRANITE_BACKEND_TOKEN = flags.token
  if (flags.channelFile) env.XIRANITE_CHANNEL_FILE = flags.channelFile
  return { ...host, env }
}

/**
 * The host for this face process, resolved once: attach to a host that is already running, or start one
 * as our own child when the operator configured nothing. The memo lives in `@xiranite/cli-runtime`
 * because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is reachable. The reason goes to this face's error line (it names every way to attach
 * and says when no host binary was found), so interactive callers only have to stop before drawing anything.
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
 * or the transport failed — reported on this face's error line with exit code 1. A terminal face that
 * cannot reach a host stops rather than running `core.ts` locally: that fallback is the compat path
 * ADR-0074 §5 removes. A run that simply did not find anything is a result with `success: false`, not a throw.
 */
async function runLogxOnHost(host: CliHost, input: LogxInput): Promise<LogxResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<LogxData>(NODE_ID, input)
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
export function createLogxHostDefinition(host: CliHost, defaults: LogxConfig, language: TerminalLanguage): TerminalInteractionDefinition<LogxInput, LogxResult> {
  const schema = createLogxInteractionSchema({ directory: defaults.directory, minimumSeverity: defaults.minimum_severity, limit: defaults.limit }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<LogxData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<LogxData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function formatRow(action: LogxAction, value: unknown): string {
  if (action === "sessions") { const row = value as { startedAt: string; eventCount: number; errorCount: number; id: string }; return `${row.startedAt}  ${String(row.eventCount).padStart(6)}  ${String(row.errorCount).padStart(4)} errors  ${row.id}` }
  if (action === "errors") { const row = value as { count: number; fingerprint: string }; return `${String(row.count).padStart(6)}  ${row.fingerprint}` }
  const event = value as { timestamp: string; severityText: string; scope: { name: string }; eventName: string; body?: string }
  return `${event.timestamp}  ${event.severityText.toUpperCase().padEnd(5)}  ${event.scope.name}  ${event.eventName}${event.body ? `  ${event.body}` : ""}`
}

function preferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: "logx", current, async save(value) { await updateNodeConfigFile("logx", { cli: { theme: value.theme, default_mode: value.defaultMode, language: value.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<LogxConfig>("logx", { ...options, jsonMode: true }); const value = resolveInteractionPreferences(config); return { theme: value.theme, defaultMode: value.mode, language: value.language ?? "zh" } } }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) runProgram().catch((error) => { writeError(createCliHost(), error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
