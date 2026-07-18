#!/usr/bin/env node
import { hasPipedInput, readStdinLines, nodeCliName, writeError, writeJson, writeLine, runGuidedInteraction } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, loadXiraniteConfig, saveXiraniteConfig, updateNodeConfig } from "@xiranite/config"
import { runClassf } from "./core.js"
import type { ClassfAction, ClassfClassifyMode, ClassfExistingPolicy, ClassfInput, ClassfPlacementMode, ClassfResult, ClassfTransferMode, ClassfWorkItemMode } from "./core.js"
import { createNodeClassfRuntime } from "./platform.js"
import { createClassfInteractionSchema, type ClassfInteractionValues } from "./interaction.js"
import { help } from "./help.js"

interface ClassfNodeConfig {
  crashu_source_paths?: string[]
  crashu_similarity_threshold?: number
  samea_min_occurrences?: number
  samea_centralize?: boolean
  samea_ignore_path_blacklist?: boolean
  samea_group_enabled?: boolean
  samea_group_min_occurrences?: number
  samea_group_centralize?: boolean
  target_dir?: string
  transfer_mode?: ClassfTransferMode
  classify_mode?: ClassfClassifyMode
  placement_mode?: ClassfPlacementMode
  existing_policy?: ClassfExistingPolicy
  work_item_mode?: ClassfWorkItemMode
  dry_run?: boolean
}

interface ClassfCliConfig extends CliInteractionPreferencesSource, ClassfNodeConfig {}
const CLI_NAME = nodeCliName("classf")

export const cli: CliCommand = { name: CLI_NAME, description: "Plan and apply classified file transfers.", run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  await runInteractionCli({
    args, host, cliName: CLI_NAME,
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<ClassfCliConfig>("classf", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition: (defaults, language) => createClassfDefinition(defaults, language),
    runPipe: (pipeArgs, pipeHost) => runPipe(pipeArgs, pipeHost),
    runGuide: runGuidedInteraction,
    runUi: runTerminalUi,
    loadScreen: async () => (await import("./Tui.js")).ClassfTui,
    createPreferences: (_defaults, values) => createPreferenceController(host, values),
    reexecEntrypoint: process.argv[1], help,
  })
}

function createDefaultHost(): CliHost { return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr } }

function createClassfDefinition(defaults: ClassfNodeConfig, _language: TerminalLanguage): TerminalInteractionDefinition<ClassfInput, ClassfResult> {
  return { schema: createClassfInteractionSchema({ crashuSourcesText: defaults.crashu_source_paths?.join("\n") ?? "", targetDir: defaults.target_dir ?? "", transferMode: defaults.transfer_mode ?? "move", classifyMode: defaults.classify_mode ?? "auto", placementMode: defaults.placement_mode ?? "local", existingPolicy: defaults.existing_policy ?? "merge", workItemMode: defaults.work_item_mode ?? "files", dryRun: defaults.dry_run ?? true, sameaGroupEnabled: defaults.samea_group_enabled ?? false, sameaGroupMinOccurrences: defaults.samea_group_min_occurrences ?? 1 } satisfies Partial<ClassfInteractionValues>, _language), run: (input, onEvent) => runClassf(input, createNodeClassfRuntime(), onEvent) }
}

function createPreferenceController(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: "classf", current, async save(values) { const { config, path } = await loadXiraniteConfig(options); await saveXiraniteConfig(updateNodeConfig(config, "classf", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }), { ...options, configPath: path }) }, async restore() { const { config } = await loadNodeConfigWithHints<ClassfCliConfig>("classf", { ...options, jsonMode: true }); const prefs = resolveInteractionPreferences(config); return { theme: prefs.theme, defaultMode: prefs.mode, language: prefs.language ?? resolveTerminalLanguage(undefined, host.env) } } }
}

async function runPipe(args: string[], host: CliHost): Promise<void> {
  const json = args.includes("--json")
  const action: ClassfAction = args.includes("classify") || args.includes("run") ? "classify" : "plan"
  const { config } = await loadNodeConfigWithHints<ClassfNodeConfig>("classf", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
  let paths = pathArgs(args)
  if (paths.includes("-")) {
    paths = paths.filter((p) => p !== "-").concat(await readStdinLines(host.stdin))
  } else if (paths.length === 0 && hasPipedInput(host.stdin) && Symbol.asyncIterator in (host.stdin as object)) {
    paths = await readStdinLines(host.stdin)
  }
  const input: ClassfInput = {
    action,
    paths,
    crashuSourcePaths: valueFor(args, "--crashu-source")?.split(/[,\r\n]+/).map((path) => path.trim()).filter(Boolean) ?? config?.crashu_source_paths,
    crashuSimilarityThreshold: numberFor(args, "--similarity") ?? config?.crashu_similarity_threshold,
    sameaMinOccurrences: numberFor(args, "--samea-min") ?? config?.samea_min_occurrences,
    sameaCentralize: args.includes("--samea-centralize") || config?.samea_centralize,
    sameaIgnorePathBlacklist: args.includes("--samea-ignore-path-blacklist") || config?.samea_ignore_path_blacklist,
    sameaGroupEnabled: args.includes("--samea-group") || config?.samea_group_enabled,
    sameaGroupMinOccurrences: numberFor(args, "--samea-group-min") ?? config?.samea_group_min_occurrences,
    sameaGroupCentralize: args.includes("--samea-group-centralize") || config?.samea_group_centralize,
    targetDir: valueFor(args, "--target") ?? config?.target_dir,
    transferMode: valueFor(args, "--transfer") as ClassfTransferMode | undefined ?? config?.transfer_mode,
    classifyMode: valueFor(args, "--classify") as ClassfClassifyMode | undefined ?? config?.classify_mode,
    placementMode: valueFor(args, "--placement") as ClassfPlacementMode | undefined ?? config?.placement_mode,
    existingPolicy: valueFor(args, "--existing") as ClassfExistingPolicy | undefined ?? config?.existing_policy,
    workItemMode: valueFor(args, "--items") as ClassfWorkItemMode | undefined ?? config?.work_item_mode,
    dryRun: action !== "classify" || args.includes("--dry-run") || config?.dry_run === true,
  }
  const result = await runClassf(input, createNodeClassfRuntime())
  if (json) writeJson(host, result)
  else {
    writeLine(host, result.message)
    for (const item of result.data?.items.slice(0, 80) ?? []) writeLine(host, `${item.status}\t${item.stage}\t${item.sourceName}\t->\t${item.targetRelative}`)
  }
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram().catch((error) => { writeError(createDefaultHost(), error instanceof Error ? error.message : String(error)); process.exitCode = 1 })

function pathArgs(args: string[]): string[] {
  const commands = new Set(["plan", "classify", "run"])
  const valueOptions = new Set(["--target", "--transfer", "--classify", "--placement", "--existing", "--items", "--crashu-source", "--similarity", "--samea-min", "--samea-group-min"])
  return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? ""))
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function numberFor(args: string[], flag: string): number | undefined {
  const value = valueFor(args, flag)
  return value === undefined ? undefined : Number(value)
}
