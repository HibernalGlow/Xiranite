#!/usr/bin/env bun
import { hasPipedInput, nodeCliName, readStdinLines, runGuidedInteraction, writeError, writeJson, writeLine, type CliCommand, type CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"
import { runXlchemy, type XlchemyInput, type XlchemyResult } from "./core.js"
import { buildPipeInput, interactionDefaults, parseXlchemyPositional, type XlchemyNodeConfig } from "./cli-input.js"
import { help } from "./help.js"
import { createXlchemyInteractionSchema } from "./interaction.js"
import { createNodeXlchemyRuntime } from "./platform.js"

interface XlchemyCliConfig extends CliInteractionPreferencesSource, XlchemyNodeConfig {}
const CLI_NAME = nodeCliName("xlchemy")
export const cli: CliCommand = { name: CLI_NAME, description: "Plan and run native image transcoding batches.", run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  await runInteractionCli({ args, host, cliName: CLI_NAME, loadContext: async () => { const { config } = await loadNodeConfigWithHints<XlchemyCliConfig>("xlchemy", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } }, createDefinition: (defaults, language) => definition(defaults, language), runPipe, runGuide: runGuidedInteraction, runUi: runTerminalUi, loadScreen: async () => (await import("./Tui.js")).XlchemyTui, createPreferences: (_defaults, values) => preferences(host, values), reexecEntrypoint: process.argv[1], help })
}
export function createXlchemyDefinition(defaults: XlchemyNodeConfig, language: TerminalLanguage): TerminalInteractionDefinition<XlchemyInput, XlchemyResult> {
  let cancelled = false
  return {
    schema: createXlchemyInteractionSchema(interactionDefaults(defaults), language),
    run: (input, onEvent) => { cancelled = false; return runXlchemy(input, { ...createNodeXlchemyRuntime(), isCancelled: () => cancelled }, onEvent) },
    cancel: async () => { cancelled = true },
  }
}
function definition(defaults: XlchemyNodeConfig, language: TerminalLanguage) { return createXlchemyDefinition(defaults, language) }
async function runPipe(args: string[], host: CliHost) {
  const json = args.includes("--json"); const { config } = await loadNodeConfigWithHints<XlchemyNodeConfig>("xlchemy", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json }); let paths = parseXlchemyPositional(args); if (paths.includes("-") || (!paths.length && hasPipedInput(host.stdin))) paths = paths.filter((path) => path !== "-").concat(await readStdinLines(host.stdin)); const input = buildPipeInput(args, config ?? {}, paths)
  let cancelled = false
  const requestCancel = () => { cancelled = true }
  process.once("SIGINT", requestCancel); process.once("SIGTERM", requestCancel)
  try {
    const result = await runXlchemy(input, { ...createNodeXlchemyRuntime(), isCancelled: () => cancelled })
    if (json) writeJson(host, result); else { writeLine(host, result.message); for (const tool of result.data?.environment ?? []) writeLine(host, `${tool.runnable ? "ready" : "missing"}\t${tool.label}\t${tool.path ?? "-"}\t${tool.version ?? tool.detail ?? ""}`); for (const file of result.data?.files ?? []) writeLine(host, `${file.status}\t${file.sourcePath}\t->\t${file.outputPath}`) }
    if (!result.success) process.exitCode = 1
  } finally { process.off("SIGINT", requestCancel); process.off("SIGTERM", requestCancel) }
}
function preferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController { const options = { env: host.env, cwd: host.cwd }; return { nodeId: "xlchemy", current, async save(values) { await updateNodeConfigFile("xlchemy", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<XlchemyCliConfig>("xlchemy", { ...options, jsonMode: true }); const prefs = resolveInteractionPreferences(config); return { theme: prefs.theme, defaultMode: prefs.mode, language: prefs.language ?? resolveTerminalLanguage(undefined, host.env) } } } }
function defaultHost(): CliHost { return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr } }
if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram().catch((error) => { writeError(defaultHost(), error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
