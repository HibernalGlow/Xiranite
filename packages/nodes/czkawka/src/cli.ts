#!/usr/bin/env node
import { hasPipedInput, nodeCliName, readStdinLines, runGuidedInteraction, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { loadNodeConfigWithHints, loadXiraniteConfig, saveXiraniteConfig, updateNodeConfig } from "@xiranite/config"
import { CZKAWKA_TOOLS, runCzkawka, type CzkawkaInput, type CzkawkaResult, type CzkawkaTool } from "./core.js"
import { createNodeCzkawkaRuntime, openCzkawkaPath } from "./platform.js"
import { createCzkawkaInteractionSchema } from "./interaction.js"
import { help } from "./help.js"
import { createCzkawkaOperationInput, CZKAWKA_CLI_VALUE_FLAGS, parseCzkawkaCliOptions } from "./tool-options.js"
import { buildCzkawkaAnalysis } from "./analysis.js"
import { formatCzkawkaActivityMessage } from "./activity-log.js"
import { czkawkaScanPresetToValues, type CzkawkaScanPreset } from "./scan-presets.js"
import type { CzkawkaInteractionValues } from "./interaction.js"
import { parseCzkawkaExtensionTokens, parseCzkawkaList, serializeCzkawkaExtensionTokens } from "./source-inputs.js"

const CLI_NAME = nodeCliName("czkawka")
interface CzkawkaConfig extends CliInteractionPreferencesSource { tool?: CzkawkaTool; recursive?: boolean; use_cache?: boolean; hash_type?: "crc32" | "xxh3" | "blake3"; check_method?: "name" | "size" | "size-and-name" | "hash"; similarity?: number; scan_presets?: CzkawkaScanPreset[]; active_scan_preset_id?: string }

export const cli: CliCommand = { name: CLI_NAME, description: help.short, run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  await runInteractionCli({
    args,
    host,
    cliName: CLI_NAME,
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<CzkawkaConfig>("czkawka", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition,
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
  if (!args.length) { writeLine(host, `${CLI_NAME} ui | gd | scan <tool> <directories...> | delete <paths...> | move <destination> <paths...> | rename <extension> <paths...> | save <output> <paths...>`); return }
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
    input = { action: "scan", tool, includedDirectories: roots, includedDirectoriesReferenced: listFor(args, "--reference"), excludedDirectories: listFor(args, "--exclude-dir"), excludedItems: listFor(args, "--exclude-item"), recursive: !args.includes("--no-recursive") && config?.recursive !== false, useCache: !args.includes("--no-cache") && config?.use_cache !== false, threadCount: numberFor(args, "--threads"), checkMethod: config?.check_method, hashType: config?.hash_type, similarity: config?.similarity, allowedExtensions: extensionsFor(args, "--allow"), excludedExtensions: extensionsFor(args, "--exclude-ext"), minimumFileSize: numberFor(args, "--min-size"), maximumFileSize: numberFor(args, "--max-size"), filterText: valueFor(args, "--filter"), ...parseCzkawkaCliOptions(args) }
  } else if (command === "delete") input = createCzkawkaOperationInput("delete", { tool: operationToolFor(args), selectedPaths: positional(args.slice(1), OPERATION_VALUE_FLAGS), deleteMode: args.includes("--permanent") ? "permanent" : "trash", dryRun: !args.includes("--live") })
  else if (command === "move") input = createCzkawkaOperationInput("move", { tool: operationToolFor(args), destinationDirectory: args[1], selectedPaths: positional(args.slice(2), OPERATION_VALUE_FLAGS), copyMode: args.includes("--copy"), preserveStructure: args.includes("--preserve-structure"), conflictPolicy: valueFor(args, "--conflict"), dryRun: !args.includes("--live") })
  else if (command === "rename") input = createCzkawkaOperationInput("rename", { tool: operationToolFor(args), renameItems: positional(args.slice(2), OPERATION_VALUE_FLAGS).map((path) => ({ path, properExtension: args[1] ?? "" })), conflictPolicy: valueFor(args, "--conflict"), dryRun: !args.includes("--live") })
  else if (command === "save") input = createCzkawkaOperationInput("save", { tool: operationToolFor(args), outputPath: args[1], selectedPaths: positional(args.slice(2), OPERATION_VALUE_FLAGS), outputFormat: args.includes("--csv") ? "csv" : "json", exportScope: valueFor(args, "--scope"), dryRun: false })
  else { writeLine(host, `Unknown command: ${command}`); process.exitCode = 2; return }
  let cancelled = false
  const requestCancel = () => { cancelled = true }
  process.once("SIGINT", requestCancel); process.once("SIGTERM", requestCancel)
  const platform = createNodeCzkawkaRuntime()
  let result: CzkawkaResult
  try { result = await runCzkawka(input, { ...platform, isCancelled: () => cancelled }, (event) => { if (!json) writeLine(host, formatCzkawkaActivityMessage("info", event.message, event.progress)) }) }
  finally { process.off("SIGINT", requestCancel); process.off("SIGTERM", requestCancel) }
  if (json) writeJson(host, result)
  else { writeLine(host, result.message); if (result.data?.action === "scan") { const analysis = buildCzkawkaAnalysis(result.data.groups, [], result.data.tool); writeLine(host, `Formats: ${analysis.formats.slice(0, 8).map((item) => `${item.format}=${item.count}/${item.bytes}B`).join(", ") || "none"}`); if (analysis.similarities.length) writeLine(host, `Similarity: ${analysis.similarities.map((item) => `${item.label}=${item.count}`).join(", ")}`); if (result.data.tool === "similar-images") writeLine(host, `Similar folders: ${result.data.similarFolders?.map((item) => `${item.path}=${item.count}`).join(", ") || "none"}`) } for (const entry of result.data?.entries.slice(0, 200) ?? []) writeLine(host, entry.status ? `${entry.status}\t${entry.path}${entry.secondaryPath ? `\t→ ${entry.secondaryPath}` : ""}${entry.error ? `\t${entry.error}` : ""}` : `${entry.groupId + 1}\t${entry.size}\t${entry.path}${entry.detail ? `\t${entry.detail}` : ""}`) }
  if (!result.success) process.exitCode = 1
}

function createDefinition(defaults: CzkawkaConfig, language: TerminalLanguage) {
  const activePreset = defaults.scan_presets?.find((preset) => preset.id === defaults.active_scan_preset_id)
  const presetValues = activePreset ? czkawkaScanPresetToValues(activePreset) as Partial<CzkawkaInteractionValues> : {}
  let cancelled = false
  const platform = createNodeCzkawkaRuntime()
  return { schema: createCzkawkaInteractionSchema({ tool: defaults.tool, recursive: defaults.recursive, useCache: defaults.use_cache, hashType: defaults.hash_type, checkMethod: defaults.check_method, similarity: defaults.similarity, ...presetValues }, language), run: (input: CzkawkaInput, onEvent: Parameters<typeof runCzkawka>[2]) => { cancelled = false; return runCzkawka(input, { ...platform, isCancelled: () => cancelled }, onEvent) }, cancel: async () => { cancelled = true }, openPath: openCzkawkaPath }
}

function preferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: "czkawka", current, async save(value) { const { config, path } = await loadXiraniteConfig(options); await saveXiraniteConfig(updateNodeConfig(config, "czkawka", { cli: { theme: value.theme, default_mode: value.defaultMode, language: value.language } }), { ...options, configPath: path }) }, async restore() { const { config } = await loadNodeConfigWithHints<CzkawkaConfig>("czkawka", { ...options, jsonMode: true }); const value = resolveInteractionPreferences(config); return { theme: value.theme, defaultMode: value.mode, language: value.language ?? "zh" } } }
}

const SCAN_VALUE_FLAGS = new Set([...CZKAWKA_CLI_VALUE_FLAGS, "--reference", "--exclude-dir", "--exclude-item", "--allow", "--exclude-ext", "--min-size", "--max-size", "--threads", "--filter"])
const OPERATION_VALUE_FLAGS = new Set(["--conflict", "--scope", "--tool"])
function positional(args: string[], valueFlags: Set<string>): string[] { return args.filter((arg, index) => !arg.startsWith("--") && !valueFlags.has(args[index - 1] ?? "")) }
function valueFor(args: string[], flag: string): string | undefined { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
function valuesFor(args: string[], flag: string): string[] { return args.flatMap((value, index) => value === flag && args[index + 1] !== undefined ? [args[index + 1]!] : []) }
function listFor(args: string[], flag: string): string[] { return valuesFor(args, flag).flatMap((value) => parseCzkawkaList(value)).filter((value, index, all) => all.indexOf(value) === index) }
function extensionsFor(args: string[], flag: string): string | undefined { const values = valuesFor(args, flag).flatMap((value) => parseCzkawkaExtensionTokens(value)); return values.length ? serializeCzkawkaExtensionTokens(values) : undefined }
function numberFor(args: string[], flag: string): number | undefined { const value = valueFor(args, flag); if (value === undefined) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined }
function operationToolFor(args: string[]): CzkawkaTool | undefined { const value = valueFor(args, "--tool"); if (value === undefined) return undefined; if (!CZKAWKA_TOOLS.includes(value as CzkawkaTool)) throw new Error(`Unsupported Czkawka tool: ${value}`); return value as CzkawkaTool }
const defaultHost = (): CliHost => ({ cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
