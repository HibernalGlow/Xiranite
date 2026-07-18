#!/usr/bin/env node
import { defineCommand, nodeCliName, readStdinLines, runGuidedInteraction, runMain, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, loadXiraniteConfig, saveXiraniteConfig, updateNodeConfig } from "@xiranite/config"
import type { VertAction, VertEnginePreference } from "./core.js"
import { runVert } from "./core.js"
import { createNodeVertRuntime } from "./platform.js"
import { createVertInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const NAME = nodeCliName("vert")
interface Config extends CliInteractionPreferencesSource { engine?: VertEnginePreference; target_format?: string; quality?: number }
export const cli: CliCommand = { name: NAME, description: "Universal local format converter with CLI-first execution.", run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()) {
  await runInteractionCli({
    args, host, cliName: NAME,
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<Config>("vert", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition: (defaults, language) => ({ schema: createVertInteractionSchema({ engine: defaults.engine, targetFormat: defaults.target_format, quality: defaults.quality }, language), run: (input, event) => runVert(input, createNodeVertRuntime(), event) }),
    runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runMain(program(pipeHost), { rawArgs: pipeArgs }) : Promise.resolve(usage(pipeHost)),
    runGuide: runGuidedInteraction, runUi: runTerminalUi, loadScreen: async () => (await import("./Tui.js")).VertTui,
    createPreferences: (_defaults, values) => preferences(host, values), reexecEntrypoint: process.argv[1], help,
  })
}

function program(host: CliHost) {
  return defineCommand({ meta: { name: NAME, description: "VERT universal conversion." }, subCommands: { status: command("status", host), plan: command("plan", host), convert: command("convert", host) } })
}

function command(action: VertAction, host: CliHost) {
  return defineCommand({
    meta: { name: action, description: action === "status" ? "Check conversion engines." : `${action} file conversion.` },
    args: { paths: { type: "positional", required: false }, to: { type: "string", required: action !== "status" }, out: { type: "string" }, engine: { type: "string" }, overwrite: { type: "boolean" }, quality: { type: "string" }, json: { type: "boolean" } },
    async run({ args }) {
      const paths = typeof args.paths === "string" ? (args.paths === "-" ? await readStdinLines(host.stdin) : args.paths.split(/[;,\r\n]+/).filter(Boolean)) : []
      const engine = args.engine === "cli" || args.engine === "wasm" ? args.engine : "auto"
      const result = await runVert({ action, paths, targetFormat: String(args.to ?? ""), outputDirectory: args.out ? String(args.out) : undefined, engine, overwrite: Boolean(args.overwrite), quality: Number(args.quality ?? 90) }, createNodeVertRuntime())
      if (args.json) writeJson(host, result)
      else { writeLine(host, result.message); for (const output of result.data?.outputPaths ?? []) writeLine(host, `  ${output}`) }
      if (!result.success && !result.data?.wasmFallbackRequired) process.exitCode = 1
    },
  })
}

function preferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: "vert", current, async save(values) { const { config, path } = await loadXiraniteConfig(options); await saveXiraniteConfig(updateNodeConfig(config, "vert", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }), { ...options, configPath: path }) }, async restore() { const { config } = await loadNodeConfigWithHints<Config>("vert", { ...options, jsonMode: true }); const value = resolveInteractionPreferences(config); return { theme: value.theme, defaultMode: value.mode, language: value.language ?? "zh" } } }
}
function usage(host: CliHost) { writeLine(host, `${NAME} ui | gd | status | plan <files> --to webp | convert <files> --to webp`) }
function defaultHost(): CliHost { return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr } }
if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
