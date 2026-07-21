#!/usr/bin/env node
import { hasPipedInput, readStdinLines, runGuidedInteraction, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runArcThumb, type ArcThumbInput } from "./core.js"
import { createArcThumbInteractionSchema } from "./interaction.js"
import type { InteractionValues } from "@xiranite/cli-runtime/interaction"
import { createArcThumbRuntime } from "./platform.js"
import { help } from "./help.js"

const CLI_NAME = "xarcthumb"
export const cli: CliCommand = { name: CLI_NAME, description: help.short, run: (args, host) => runProgram(args, host) }
export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  await runInteractionCli({ args, host, cliName: CLI_NAME, loadContext: async () => { const { config } = await loadNodeConfigWithHints<Record<string, unknown>>("arcthumb", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } }, createDefinition: (defaults, language) => ({ schema: createArcThumbInteractionSchema(defaults as Partial<InteractionValues>, language), run: (input, event) => runArcThumb(input, createArcThumbRuntime(), event) }), runPipe, runGuide: runGuidedInteraction, runUi: runTerminalUi, loadScreen: async () => (await import("./Tui.js")).ArcThumbTui, reexecEntrypoint: process.argv[1], help })
}
async function runPipe(args: string[], host: CliHost) {
  const json = args.includes("--json"), action = args.includes("render") ? "render" : "inspect"
  let paths = args.filter((arg, index) => !arg.startsWith("--") && arg !== action && !["--output-dir", "--format", "--size", "--quality"].includes(args[index - 1] ?? ""))
  if (paths.includes("-")) paths = paths.filter((path) => path !== "-").concat(await readStdinLines(host.stdin)); else if (!paths.length && hasPipedInput(host.stdin)) paths = await readStdinLines(host.stdin)
  const input: ArcThumbInput = { action, paths, outputDir: value(args, "--output-dir"), format: value(args, "--format") as ArcThumbInput["format"], maxDimension: number(args, "--size"), quality: number(args, "--quality"), write: args.includes("--write"), overwrite: args.includes("--overwrite"), recursive: !args.includes("--no-recursive") }
  const result = await runArcThumb(input, createArcThumbRuntime())
  if (json) writeJson(host, result); else { writeLine(host, result.message); for (const item of result.data?.items ?? []) writeLine(host, `${item.status}\t${item.path}\t${item.outputPath ?? item.reason ?? ""}`) }
  if (!result.success) process.exitCode = 1
}
const value = (args: string[], flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1] }
const number = (args: string[], flag: string) => { const parsed = Number(value(args, flag)); return Number.isFinite(parsed) ? parsed : undefined }
const defaultHost = (): CliHost => ({ cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
