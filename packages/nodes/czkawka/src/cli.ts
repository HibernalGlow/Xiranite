#!/usr/bin/env node
import { hasPipedInput, nodeCliName, readStdinLines, runGuidedInteraction, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, loadXiraniteConfig, saveXiraniteConfig, updateNodeConfig } from "@xiranite/config"
import { CZKAWKA_TOOLS, runCzkawka, type CzkawkaInput, type CzkawkaTool } from "./core.js"
import { createNodeCzkawkaRuntime } from "./platform.js"
import { createCzkawkaInteractionSchema } from "./interaction.js"
import { help } from "./help.js"
import { CZKAWKA_CLI_VALUE_FLAGS, parseCzkawkaCliOptions } from "./tool-options.js"

const CLI_NAME = nodeCliName("czkawka")
interface CzkawkaConfig extends CliInteractionPreferencesSource { tool?: CzkawkaTool; recursive?: boolean; use_cache?: boolean; hash_type?: "crc32" | "xxh3" | "blake3"; check_method?: "name" | "size" | "size-and-name" | "hash"; similarity?: number }

export const cli: CliCommand = { name: CLI_NAME, description: help.short, run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  await runInteractionCli({
    args,
    host,
    cliName: CLI_NAME,
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<CzkawkaConfig>("czkawka", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition: (defaults, language) => ({ schema: createCzkawkaInteractionSchema({ tool: defaults.tool, recursive: defaults.recursive, useCache: defaults.use_cache, hashType: defaults.hash_type, checkMethod: defaults.check_method, similarity: defaults.similarity }, language), run: (input, onEvent) => runCzkawka(input, createNodeCzkawkaRuntime(), onEvent) }),
    runPipe,
    runGuide: runGuidedInteraction,
    runUi: runTerminalUi,
    loadScreen: async () => (await import("./Tui.js")).CzkawkaTui,
    createPreferences: (_defaults, current) => preferences(host, current),
    reexecEntrypoint: process.argv[1],
    help,
  })
}

async function runPipe(args: string[], host: CliHost): Promise<void> {
  if (!args.length) { writeLine(host, `${CLI_NAME} ui | gd | scan <tool> <directories...> | delete <paths...> | move <destination> <paths...> | save <output> <paths...>`); return }
  const command = args[0] ?? "scan", json = args.includes("--json")
  const { config } = await loadNodeConfigWithHints<CzkawkaConfig>("czkawka", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
  let input: CzkawkaInput
  if (command === "scan" || CZKAWKA_TOOLS.includes(command as CzkawkaTool)) {
    const explicitTool = command === "scan" ? args[1] : command
    const tool = CZKAWKA_TOOLS.includes(explicitTool as CzkawkaTool) ? explicitTool as CzkawkaTool : config?.tool ?? "duplicate-files"
    const offset = command === "scan" ? 2 : 1
    let roots = positional(args.slice(offset), SCAN_VALUE_FLAGS)
    if (roots.includes("-")) roots = roots.filter((path) => path !== "-").concat(await readStdinLines(host.stdin))
    else if (!roots.length && hasPipedInput(host.stdin) && Symbol.asyncIterator in Object(host.stdin)) roots = await readStdinLines(host.stdin)
    input = { action: "scan", tool, includedDirectories: roots, recursive: !args.includes("--no-recursive") && config?.recursive !== false, useCache: !args.includes("--no-cache") && config?.use_cache !== false, checkMethod: config?.check_method, hashType: config?.hash_type, similarity: config?.similarity, allowedExtensions: valueFor(args, "--allow"), excludedExtensions: valueFor(args, "--exclude-ext"), minimumFileSize: numberFor(args, "--min-size"), maximumFileSize: numberFor(args, "--max-size"), filterText: valueFor(args, "--filter"), ...parseCzkawkaCliOptions(args) }
  } else if (command === "delete") input = { action: "delete", selectedPaths: positional(args.slice(1), new Set()), dryRun: !args.includes("--live") }
  else if (command === "move") input = { action: "move", destinationDirectory: args[1], selectedPaths: positional(args.slice(2), new Set()), dryRun: !args.includes("--live") }
  else if (command === "save") input = { action: "save", outputPath: args[1], selectedPaths: positional(args.slice(2), new Set()), outputFormat: args.includes("--csv") ? "csv" : "json", dryRun: false }
  else { writeLine(host, `Unknown command: ${command}`); process.exitCode = 2; return }
  const result = await runCzkawka(input, createNodeCzkawkaRuntime(), (event) => { if (!json && event.type === "progress") writeLine(host, `[${event.progress ?? 0}%] ${event.message}`) })
  if (json) writeJson(host, result)
  else { writeLine(host, result.message); for (const entry of result.data?.entries.slice(0, 200) ?? []) writeLine(host, `${entry.groupId + 1}\t${entry.size}\t${entry.path}${entry.detail ? `\t${entry.detail}` : ""}`) }
  if (!result.success) process.exitCode = 1
}

function preferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: "czkawka", current, async save(value) { const { config, path } = await loadXiraniteConfig(options); await saveXiraniteConfig(updateNodeConfig(config, "czkawka", { cli: { theme: value.theme, default_mode: value.defaultMode, language: value.language } }), { ...options, configPath: path }) }, async restore() { const { config } = await loadNodeConfigWithHints<CzkawkaConfig>("czkawka", { ...options, jsonMode: true }); const value = resolveInteractionPreferences(config); return { theme: value.theme, defaultMode: value.mode, language: value.language ?? "zh" } } }
}

const SCAN_VALUE_FLAGS = new Set([...CZKAWKA_CLI_VALUE_FLAGS, "--allow", "--exclude-ext", "--min-size", "--max-size", "--filter"])
function positional(args: string[], valueFlags: Set<string>): string[] { return args.filter((arg, index) => !arg.startsWith("--") && !valueFlags.has(args[index - 1] ?? "")) }
function valueFor(args: string[], flag: string): string | undefined { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
function numberFor(args: string[], flag: string): number | undefined { const value = valueFor(args, flag); if (value === undefined) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined }
const defaultHost = (): CliHost => ({ cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
