#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { createCliHost, nodeCliName, writeError, writeJson, writeLine, type CliCommand, type CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runGuidedInteraction } from "@xiranite/cli-runtime"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"
import { createLogxInteractionSchema } from "./interaction.js"
import { runLogx, type LogxAction, type LogxInput } from "./core.js"
import { createNodeLogxRuntime } from "./platform.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("logx")
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const
interface LogxConfig extends CliInteractionPreferencesSource { directory?: string; minimum_severity?: LogxInput["minimumSeverity"]; limit?: number }

export const cli: CliCommand = { name: CLI_NAME, description: "Analyze Xiranite structured logs.", run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = createCliHost()): Promise<void> {
  await runInteractionCli({
    args, host, cliName: CLI_NAME,
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<LogxConfig>("logx", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition: (defaults, language) => ({ schema: createLogxInteractionSchema({ directory: defaults.directory, minimumSeverity: defaults.minimum_severity, limit: defaults.limit }, language), run: (input, onEvent) => runLogx(input, createNodeLogxRuntime(), onEvent) }),
    runPipe: (pipeArgs, pipeHost) => runDirect(pipeArgs, pipeHost), runGuide: runGuidedInteraction, runUi: runTerminalUi,
    loadScreen: async () => (await import("./Tui.js")).LogxTui,
    createPreferences: (_defaults, current) => preferences(host, current), reexecEntrypoint: process.argv[1], help,
  })
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
  const result = await runLogx(input, createNodeLogxRuntime())
  if (!result.data) throw new Error(result.message)
  const output = command === "sessions" ? result.data.sessions : command === "stats" ? { aggregate: result.data.aggregate, telemetry: result.data.telemetry } : command === "errors" ? result.data.aggregate.errors : command === "doctor" ? { directory: result.data.directory, files: result.data.files, events: result.data.matchedCount, issues: result.data.issues } : result.data.events
  if (parsed.values.json || command === "stats" || command === "doctor") writeJson(host, output)
  else if (Array.isArray(output)) output.forEach((item) => writeLine(host, formatRow(command as LogxAction, item)))
  else writeJson(host, output)
  if (!result.success) process.exitCode = 1
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
