#!/usr/bin/env node
import { runSnf } from "./core.js"
import { createNodeSnfRuntime } from "./platform.js"

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const passthroughIndex = args.indexOf("--")
  const commandArgs = passthroughIndex >= 0 ? args.slice(0, passthroughIndex) : args
  const passthroughArgs = passthroughIndex >= 0 ? args.slice(passthroughIndex + 1) : []
  const json = commandArgs.includes("--json")
  const action = commandArgs.includes("run") ? "run" : commandArgs.includes("plan") ? "plan" : "status"
  const valueOptions = new Set(["--config-path", "--database-path", "--python", "--source-root", "--module-name"])
  const paths = commandArgs.filter((arg, index) => !arg.startsWith("--") && !["run", "plan", "status"].includes(arg) && !valueOptions.has(commandArgs[index - 1] ?? ""))
  const result = await runSnf({
    action,
    paths,
    args: passthroughArgs,
    configPath: valueFor(commandArgs, "--config-path"),
    databasePath: valueFor(commandArgs, "--database-path"),
    python: valueFor(commandArgs, "--python"),
    sourceRoot: valueFor(commandArgs, "--source-root"),
    moduleName: valueFor(commandArgs, "--module-name"),
    recordRun: commandArgs.includes("--record-run"),
    dryRun: commandArgs.includes("--dry-run"),
  }, createNodeSnfRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
