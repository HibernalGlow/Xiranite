#!/usr/bin/env node
import { hasPipedInput, nodeCliName, readStdinLines, runGuidedInteraction, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"
import { runSamea } from "./core.js"
import type { SameaAction } from "./core.js"
import { createNodeSameaRuntime } from "./platform.js"
import { createSameaInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("samea")
interface SameaConfig extends CliInteractionPreferencesSource {
  ignore_path_blacklist?: boolean; min_occurrences?: number; centralize?: boolean; dry_run?: boolean
  artist_blacklist?: string[]; path_blacklist?: string[]; regex_blacklist?: string[]; archive_extensions?: string[]
}
export const cli: CliCommand = { name: CLI_NAME, description: help.short, run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  await runInteractionCli({
    args, host, cliName: CLI_NAME,
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<SameaConfig>("samea", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition: (defaults, language) => ({ schema: createSameaInteractionSchema({ ignorePathBlacklist: defaults.ignore_path_blacklist, minOccurrences: defaults.min_occurrences, centralize: defaults.centralize, dryRun: defaults.dry_run, artistBlacklist: defaults.artist_blacklist?.join("\n"), pathBlacklist: defaults.path_blacklist?.join("\n"), regexBlacklist: defaults.regex_blacklist?.join("\n"), archiveExtensions: defaults.archive_extensions?.join("\n") }, language), run: (input, onEvent) => runSamea(input, createNodeSameaRuntime(), onEvent) }),
    runPipe, runGuide: runGuidedInteraction, runUi: runTerminalUi,
    loadScreen: async () => (await import("./Tui.js")).SameaTui,
    createPreferences: (_defaults, current) => preferences(host, current), reexecEntrypoint: process.argv[1], help,
  })
}

async function runPipe(args: string[], host: CliHost): Promise<void> {
  if (!args.length) { writeLine(host, `${CLI_NAME} ui | gd | plan | classify`); return }
  const json = args.includes("--json")
  const action: SameaAction = args.includes("classify") || args.includes("run") ? "classify" : "plan"
  let paths = pathArgs(args)
  if (paths.includes("-")) paths = paths.filter((path) => path !== "-").concat(await readStdinLines(host.stdin))
  else if (!paths.length && hasPipedInput(host.stdin) && Symbol.asyncIterator in Object(host.stdin)) paths = await readStdinLines(host.stdin)
  const { config } = await loadNodeConfigWithHints<SameaConfig>("samea", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
  const result = await runSamea({ action, paths, minOccurrences: numberFor(args, "--min") ?? config?.min_occurrences, centralize: args.includes("--centralize") || config?.centralize === true, ignorePathBlacklist: args.includes("--ignore-path-blacklist") || config?.ignore_path_blacklist === true, dryRun: action !== "classify" || args.includes("--dry-run") || config?.dry_run !== false, artistBlacklist: config?.artist_blacklist, pathBlacklist: config?.path_blacklist, regexBlacklist: config?.regex_blacklist, archiveExtensions: config?.archive_extensions }, createNodeSameaRuntime())
  if (json) writeJson(host, result); else { writeLine(host, result.message); for (const item of result.data?.items.slice(0, 100) ?? []) writeLine(host, `${item.status}\t${item.artistName}\t${item.sourcePath}\t->\t${item.targetPath}`) }
  if (!result.success) process.exitCode = 1
}

function preferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: "samea", current, async save(value) { await updateNodeConfigFile("samea", { cli: { theme: value.theme, default_mode: value.defaultMode, language: value.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<SameaConfig>("samea", { ...options, jsonMode: true }); const value = resolveInteractionPreferences(config); return { theme: value.theme, defaultMode: value.mode, language: value.language ?? "zh" } } }
}
function pathArgs(args: string[]): string[] { const commands = new Set(["plan", "classify", "run"]), valueOptions = new Set(["--min"]); return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? "")) }
function numberFor(args: string[], flag: string): number | undefined { const index = args.indexOf(flag), value = index >= 0 ? args[index + 1] : undefined; return value === undefined ? undefined : Number(value) }
const defaultHost = (): CliHost => ({ cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
