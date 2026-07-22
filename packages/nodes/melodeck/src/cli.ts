#!/usr/bin/env node
import { nodeCliName, runGuidedInteraction, writeJson, writeLine, type CliCommand, type CliHost } from "@xiranite/cli-runtime"
import { runInteractionCli, runTerminalUi } from "@xiranite/cli-runtime/terminal"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { getAppConfig, getNodeConfig, loadXiraniteConfig } from "@xiranite/config"
import { runMelodeck, type MelodeckInput } from "./core.js"
import { createNodeMelodeckRuntime, DEFAULT_MELODECK_IPC } from "./platform.js"
import { createMelodeckInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const NAME = nodeCliName("melodeck")
interface LegacyMusicDockConfig { savedTracks?: Array<{ path?: string }>; sourcePath?: string }
interface AppUiConfig { musicDock?: LegacyMusicDockConfig }
interface Config extends CliInteractionPreferencesSource {
  mpv_path?: string
  ipc_path?: string
  volume?: number
  saved_tracks?: Array<{ path?: string }>
  source_path?: string
}
interface Defaults extends Config { paths: string }
export const cli: CliCommand = { name: NAME, description: "Play local music with mpv.", run: (args, host) => runProgram(args, host) }
export async function runProgram(args = process.argv.slice(2), host: CliHost = createHost()): Promise<void> {
  await runInteractionCli({ args, host, cliName: NAME, loadContext: () => loadDefaults(host), createDefinition: (context, language) => ({ schema: createMelodeckInteractionSchema({ paths: context.paths, mpvPath: context.mpv_path, ipcPath: context.ipc_path ?? DEFAULT_MELODECK_IPC, volume: context.volume }, language), run: (input, event) => runMelodeck(input, createNodeMelodeckRuntime(), event) }), runGuide: runGuidedInteraction, runUi: runTerminalUi, loadScreen: async () => (await import("./Tui.js")).MelodeckTui, runPipe: (pipeArgs, pipeHost) => runPipe(pipeArgs, pipeHost), reexecEntrypoint: process.argv[1], help })
}
async function runPipe(args: string[], host: CliHost) { const action = (args.find((value) => !value.startsWith("-")) ?? "status") as MelodeckInput["action"]; const defaults = await loadDefaults(host); const paths = positionalPaths(args, action).length ? positionalPaths(args, action) : defaults.value.paths.split("\n").filter(Boolean); const json = args.includes("--json"); const result = await runMelodeck({ action, paths, volume: Number(valueFor(args, "--volume") ?? defaults.value.volume ?? 80), seekSeconds: Number(valueFor(args, "--seek") ?? 0), mpvPath: valueFor(args, "--mpv-path") ?? defaults.value.mpv_path, ipcPath: valueFor(args, "--ipc") ?? defaults.value.ipc_path ?? DEFAULT_MELODECK_IPC }, createNodeMelodeckRuntime(), (event) => { if (!json) writeLine(host, event.message) }); if (json) writeJson(host, result); else writeLine(host, result.message); if (!result.success) process.exitCode = 1 }
async function loadDefaults(host: CliHost) { const { config } = await loadXiraniteConfig({ cwd: host.cwd, env: host.env }); const node = getNodeConfig<Config>(config, "melodeck") ?? {}; const legacy = getAppConfig<AppUiConfig>(config, "ui")?.musicDock; const paths = resolveMelodeckPaths(node, legacy); const value: Defaults = { ...node, paths: paths.join("\n") }; return { preferences: resolveInteractionPreferences(node), value } }
export function resolveMelodeckPaths(config: Pick<Config, "saved_tracks" | "source_path">, legacy?: LegacyMusicDockConfig): string[] { const tracks = (config.saved_tracks ?? legacy?.savedTracks ?? []).map((track) => track.path?.trim() ?? "").filter(Boolean); if (tracks.length) return [...new Set(tracks)]; const source = (config.source_path ?? legacy?.sourcePath)?.trim(); return source ? [source] : [] }
function positionalPaths(args: string[], action: MelodeckInput["action"]): string[] { const valueFlags = new Set(["--volume", "--seek", "--mpv-path", "--ipc"]); return args.filter((value, index) => !value.startsWith("-") && value !== action && !valueFlags.has(args[index - 1] ?? "")) }
function valueFor(args: string[], flag: string) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
function createHost(): CliHost { return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr } }
if (process.argv[1]?.replace(/\\/g, "/").endsWith("cli.js")) await runProgram()
