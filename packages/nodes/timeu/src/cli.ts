#!/usr/bin/env node
import { hasPipedInput, readStdinLines } from "@xiranite/cli-runtime"
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runTimeu } from "./core.js"
import type { TimeuAction, TimeuInput } from "./core.js"
import { createNodeTimeuRuntime } from "./platform.js"

interface TimeuNodeConfig {
  record_path?: string
  recursive?: boolean
  include_directories?: boolean
  dry_run?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action: TimeuAction = args.includes("restore") ? "restore" : args.includes("backup") ? "backup" : "scan"
  const { config } = await loadNodeConfigWithHints<TimeuNodeConfig>("timeu", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })
  let paths = pathArgs(args)
  if (paths.includes("-")) {
    paths = paths.filter(p => p !== "-").concat(await readStdinLines())
  } else if (paths.length === 0 && hasPipedInput()) {
    paths = await readStdinLines()
  }
  const input: TimeuInput = {
    action,
    paths,
    recordPath: valueFor(args, "--record") ?? config?.record_path,
    recursive: args.includes("--no-recursive") ? false : config?.recursive,
    includeDirectories: args.includes("--include-directories") || config?.include_directories === true,
    dryRun: args.includes("--dry-run") || config?.dry_run === true,
  }
  const result = await runTimeu(input, createNodeTimeuRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()

function pathArgs(args: string[]): string[] {
  const commands = new Set(["scan", "backup", "restore"])
  const valueOptions = new Set(["--record"])
  return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? ""))
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
