#!/usr/bin/env node
import { hasPipedInput, readStdinLines, runGuidedInteraction } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runCoveru } from "./core.js"
import type { CoveruInput, CoveruOutputMode } from "./core.js"
import { createNodeCoveruRuntime } from "./platform.js"
import { createCoveruInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

interface CoveruNodeConfig extends CliInteractionPreferencesSource {
  output_dir?: string
  output_mode?: CoveruOutputMode
  overwrite?: boolean
  recursive?: boolean
  dry_run?: boolean
  preferred_names?: string[]
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  await runInteractionCli({
    args,
    host: { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
    cliName: "xcoveru",
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<CoveruNodeConfig>("coveru", { hintSink: { stderr: process.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition: (defaults, language) => ({ schema: createCoveruInteractionSchema({ outputDir: defaults.output_dir, outputMode: defaults.output_mode, overwrite: defaults.overwrite, recursive: defaults.recursive, dryRun: defaults.dry_run, preferred: defaults.preferred_names?.join(", ") }, language), run: (input, event) => runCoveru(input, createNodeCoveruRuntime(), event) }),
    runPipe: async (pipeArgs) => await runLegacy(pipeArgs), runGuide: runGuidedInteraction, runUi: runTerminalUi, loadScreen: async () => (await import("./Tui.js")).CoveruTui,
    createPreferences: (_d, current) => coveruPreferences(current), reexecEntrypoint: process.argv[1], help,
  })
}

async function runLegacy(args: string[]): Promise<void> {
  const json = args.includes("--json")
  const action = args.includes("extract") ? "extract" : args.includes("plan") ? "plan" : "scan"
  const { config } = await loadNodeConfigWithHints<CoveruNodeConfig>("coveru", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })
  let paths = pathArgs(args)
  if (paths.includes("-")) {
    paths = paths.filter((p) => p !== "-").concat(await readStdinLines())
  } else if (paths.length === 0 && hasPipedInput()) {
    paths = await readStdinLines()
  }
  const input: CoveruInput = {
    action,
    paths,
    outputDir: valueFor(args, "--output-dir") ?? config?.output_dir,
    outputMode: (valueFor(args, "--output-mode") as CoveruOutputMode | undefined) ?? config?.output_mode,
    overwrite: args.includes("--overwrite") || config?.overwrite === true,
    recursive: args.includes("--no-recursive") ? false : config?.recursive,
    dryRun: args.includes("--dry-run") || config?.dry_run === true,
    preferredNames: listValue(valueFor(args, "--preferred")) ?? config?.preferred_names,
  }
  const result = await runCoveru(input, createNodeCoveruRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

function coveruPreferences(current: TerminalPreferenceValues): TerminalPreferenceController { return { nodeId: "coveru", current, async save(values) { const { config, path } = await (await import("@xiranite/config")).loadXiraniteConfig({}); await (await import("@xiranite/config")).saveXiraniteConfig((await import("@xiranite/config")).updateNodeConfig(config, "coveru", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }), { configPath: path }) }, async restore() { return current } } }

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()

function pathArgs(args: string[]): string[] {
  const commands = new Set(["scan", "plan", "extract"])
  const valueOptions = new Set(["--output-dir", "--output-mode", "--preferred"])
  return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? ""))
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function listValue(value: string | undefined): string[] | undefined {
  const items = value?.split(",").map((item) => item.trim()).filter(Boolean)
  return items?.length ? items : undefined
}
