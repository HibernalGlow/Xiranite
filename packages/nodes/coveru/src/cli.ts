#!/usr/bin/env node
import { hasPipedInput, readStdinLines } from "@xiranite/cli-runtime"
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runCoveru } from "./core.js"
import type { CoveruInput, CoveruOutputMode } from "./core.js"
import { createNodeCoveruRuntime } from "./platform.js"

interface CoveruNodeConfig {
  output_dir?: string
  output_mode?: CoveruOutputMode
  overwrite?: boolean
  recursive?: boolean
  dry_run?: boolean
  preferred_names?: string[]
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
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
