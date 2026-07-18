#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { hasPipedInput, readStdinLines, writeError, writeJson, writeLine, type CliCommand, type CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, loadXiraniteConfig, saveXiraniteConfig, updateNodeConfig } from "@xiranite/config"
import { runClassq } from "./core.js"
import type { ClassqAction, ClassqExistingPolicy, ClassqInput, ClassqResult, ClassqTransferMode } from "./core.js"
import { createClassqInteractionSchema, type ClassqInteractionValues } from "./interaction.js"
import { help } from "./help.js"
import { createNodeClassqRuntime } from "./platform.js"

const CLI_NAME = "xclassq"
interface ClassqNodeConfig extends CliInteractionPreferencesSource { keyword?: string; wait_keyword?: string; transfer_mode?: ClassqTransferMode; existing_policy?: ClassqExistingPolicy; dry_run?: boolean }
export const cli: CliCommand = { name: CLI_NAME, description: "Keyword-folder wait routing.", run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  await runInteractionCli({
    args, host, cliName: CLI_NAME,
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<ClassqNodeConfig>("classq", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition: createDefinition,
    runPipe: runPipe,
    runUi: runTerminalUi,
    loadScreen: async () => (await import("./Tui.js")).ClassqTui,
    createPreferences: (_defaults, values) => createPreferences(host, values),
    reexecEntrypoint: process.argv[1], help,
  })
}

function createDefinition(defaults: ClassqNodeConfig, language: TerminalLanguage): TerminalInteractionDefinition<ClassqInput, ClassqResult> {
  return { schema: createClassqInteractionSchema({ keyword: defaults.keyword ?? "already", waitKeyword: defaults.wait_keyword ?? "wait", transferMode: defaults.transfer_mode ?? "move", existingPolicy: defaults.existing_policy ?? "merge", dryRun: defaults.dry_run ?? true } satisfies Partial<ClassqInteractionValues>, language), run: (input, onEvent) => runClassq(input, createNodeClassqRuntime(), onEvent) }
}
function createPreferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: "classq", current, async save(values) { const { config, path } = await loadXiraniteConfig(options); await saveXiraniteConfig(updateNodeConfig(config, "classq", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }), { ...options, configPath: path }) }, async restore() { const { config } = await loadNodeConfigWithHints<ClassqNodeConfig>("classq", { ...options, jsonMode: true }); const prefs = resolveInteractionPreferences(config); return { theme: prefs.theme, defaultMode: prefs.mode, language: prefs.language ?? "zh" } } }
}
async function runPipe(args: string[], host: CliHost): Promise<void> {
  if (!args.length || args.includes("--help") || args.includes("-h") || args[0] === "help") { writeUsage(host); return }
  const json = args.includes("--json"), action: ClassqAction = args.includes("classify") || args.includes("run") ? "classify" : "plan"
  const { config } = await loadNodeConfigWithHints<ClassqNodeConfig>("classq", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
  let paths = pathArgs(args)
  if (paths.includes("-")) paths = paths.filter((path) => path !== "-").concat(await readStdinLines(host.stdin))
  else if (!paths.length && hasPipedInput(host.stdin)) paths = await readStdinLines(host.stdin)
  const input: ClassqInput = { action, paths, keyword: valueFor(args, "--keyword") ?? config?.keyword, waitKeyword: valueFor(args, "--wait") ?? config?.wait_keyword, transferMode: valueFor(args, "--transfer") as ClassqTransferMode | undefined ?? config?.transfer_mode, existingPolicy: valueFor(args, "--existing") as ClassqExistingPolicy | undefined ?? config?.existing_policy, dryRun: action !== "classify" || args.includes("--dry-run") || !args.includes("--apply") }
  const result = await runClassq(input, createNodeClassqRuntime())
  if (json) writeJson(host, result)
  else { writeLine(host, result.message); for (const item of result.data?.items.slice(0, 80) ?? []) writeLine(host, `${item.status}\t${item.stage}\t${item.sourceName}\t->\t${item.targetRelative}`) }
  if (!result.success) process.exitCode = 1
}
function writeUsage(host: CliHost) { writeLine(host, `${CLI_NAME} - keyword-folder wait routing`); writeLine(host, `  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]`); writeLine(host, `  ${CLI_NAME} gd`); writeLine(host, `  ${CLI_NAME} plan <roots...> [--keyword already] [--wait wait] [--json]`); writeLine(host, `  ${CLI_NAME} classify <roots...> [--transfer move|copy] [--dry-run|--apply] [--json]`) }
function pathArgs(args: string[]) { const commands = new Set(["plan", "classify", "run"]), flags = new Set(["--keyword", "--wait", "--transfer", "--existing"]); return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !flags.has(args[index - 1] ?? "")) }
function valueFor(args: string[], flag: string) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
function defaultHost(): CliHost { return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr } }
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) { try { await runProgram() } catch (error) { writeError(defaultHost(), error instanceof Error ? error.message : String(error)); process.exitCode = 1 } }
