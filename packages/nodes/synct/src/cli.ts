#!/usr/bin/env node
import { hasPipedInput, nodeCliName, readStdinLines, runGuidedInteraction, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"
import { runSynct } from "./core.js"
import type { SynctAction, SynctFormatKey, SynctInput, SynctSourceMode } from "./core.js"
import { createNodeSynctRuntime } from "./platform.js"
import { createSynctInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("synct")
interface SynctNodeConfig extends CliInteractionPreferencesSource { source_mode?: SynctSourceMode; format_key?: SynctFormatKey; recursive?: boolean; archive_folder?: boolean; fallback_to_created_time?: boolean; sync_folder_file_times?: boolean; dry_run?: boolean }

export const cli: CliCommand = { name: CLI_NAME, description: "Timestamp-based file and folder archive.", run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  await runInteractionCli({
    args, host, cliName: CLI_NAME,
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<SynctNodeConfig>("synct", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition: (defaults, language) => ({ schema: createSynctInteractionSchema({ sourceMode: defaults.source_mode, formatKey: defaults.format_key, recursive: defaults.recursive, archiveFolder: defaults.archive_folder, fallbackToCreatedTime: defaults.fallback_to_created_time, syncFolderFileTimes: defaults.sync_folder_file_times, dryRun: defaults.dry_run }, language), run: (input, event) => runSynct(input, createNodeSynctRuntime(), event) }),
    runPipe: runPipe,
    runGuide: runGuidedInteraction,
    runUi: runTerminalUi,
    loadScreen: async () => (await import("./Tui.js")).SynctTui,
    createPreferences: (_defaults, current) => preferences(host, current),
    reexecEntrypoint: process.argv[1], help,
  })
}

async function runPipe(args: string[], host: CliHost): Promise<void> {
  if (!args.length) { writeLine(host, `${CLI_NAME} ui | gd | scan | plan | archive`); return }
  const json = args.includes("--json")
  const action: SynctAction = args.includes("archive") || args.includes("run") ? "archive" : args.includes("scan") ? "scan" : "plan"
  const { config } = await loadNodeConfigWithHints<SynctNodeConfig>("synct", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
  let paths = pathArgs(args)
  if (paths.includes("-")) paths = paths.filter((path) => path !== "-").concat(await readStdinLines(host.stdin))
  else if (!paths.length && hasPipedInput(host.stdin) && Symbol.asyncIterator in Object(host.stdin)) paths = await readStdinLines(host.stdin)
  const input: SynctInput = { action, paths, sourceMode: valueFor(args, "--source-mode") as SynctSourceMode | undefined ?? config?.source_mode, formatKey: valueFor(args, "--format") as SynctFormatKey | undefined ?? config?.format_key, recursive: args.includes("--recursive") || config?.recursive === true, archiveFolder: args.includes("--archive-folder") || config?.archive_folder === true, fallbackToCreatedTime: args.includes("--no-fallback") ? false : config?.fallback_to_created_time, syncFolderFileTimes: args.includes("--no-sync-file-times") ? false : config?.sync_folder_file_times, dryRun: action !== "archive" || args.includes("--dry-run") || config?.dry_run === true }
  const result = await runSynct(input, createNodeSynctRuntime())
  if (json) writeJson(host, result)
  else { writeLine(host, result.message); for (const item of result.data?.items.slice(0, 80) ?? []) writeLine(host, `${item.status}\t${item.sourceName}\t->\t${item.targetRelative}`) }
  if (!result.success) process.exitCode = 1
}

function preferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController { const options = { env: host.env, cwd: host.cwd }; return { nodeId: "synct", current, async save(values) { await updateNodeConfigFile("synct", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<SynctNodeConfig>("synct", { ...options, jsonMode: true }); const p = resolveInteractionPreferences(config); return { theme: p.theme, defaultMode: p.mode, language: p.language ?? "zh" } } } }
function defaultHost(): CliHost { return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr } }
function pathArgs(args: string[]): string[] { const commands = new Set(["scan", "plan", "archive", "run"]), valueOptions = new Set(["--source-mode", "--format"]); return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? "")) }
function valueFor(args: string[], flag: string): string | undefined { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
