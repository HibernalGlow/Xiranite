#!/usr/bin/env node
import { nodeCliName, runGuidedInteraction, writeJson, writeLine, type CliCommand, type CliHost } from "@xiranite/cli-runtime"
import { runInteractionCli, runTerminalUi } from "@xiranite/cli-runtime/terminal"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runMelodeck, type MelodeckInput } from "./core.js"
import { createNodeMelodeckRuntime, DEFAULT_MELODECK_IPC } from "./platform.js"
import { createMelodeckInteractionSchema } from "./interaction.js"

const NAME = nodeCliName("melodeck")
interface Config extends CliInteractionPreferencesSource { mpv_path?: string; ipc_path?: string; volume?: number }
export const cli: CliCommand = { name: NAME, description: "Play local music with mpv.", run: (args, host) => runProgram(args, host) }
export async function runProgram(args = process.argv.slice(2), host: CliHost = createHost()): Promise<void> {
  await runInteractionCli({ args, host, cliName: NAME, loadContext: async () => { const { config } = await loadNodeConfigWithHints<Config>("melodeck", { cwd: host.cwd, env: host.env, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } }, createDefinition: (context, language) => ({ schema: createMelodeckInteractionSchema({ mpvPath: context.mpv_path, ipcPath: context.ipc_path ?? DEFAULT_MELODECK_IPC, volume: context.volume }, language), run: (input, event) => runMelodeck(input, createNodeMelodeckRuntime(), event) }), runGuide: runGuidedInteraction, runUi: runTerminalUi, loadScreen: async () => (await import("./Tui.js")).MelodeckTui, runPipe: (pipeArgs, pipeHost) => runPipe(pipeArgs, pipeHost) })
}
async function runPipe(args: string[], host: CliHost) { const action = (args.find((value) => !value.startsWith("-")) ?? "status") as MelodeckInput["action"]; const paths = args.filter((value) => !value.startsWith("-") && value !== action); const json = args.includes("--json"); const result = await runMelodeck({ action, paths, volume: Number(valueFor(args, "--volume") ?? 80), mpvPath: valueFor(args, "--mpv-path"), ipcPath: valueFor(args, "--ipc") ?? DEFAULT_MELODECK_IPC }, createNodeMelodeckRuntime(), (event) => { if (!json) writeLine(host, event.message) }); if (json) writeJson(host, result); else writeLine(host, result.message); if (!result.success) process.exitCode = 1 }
function valueFor(args: string[], flag: string) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
function createHost(): CliHost { return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr } }
if (process.argv[1]?.replace(/\\/g, "/").endsWith("cli.js")) await runProgram()
