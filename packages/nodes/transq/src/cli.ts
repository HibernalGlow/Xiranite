#!/usr/bin/env node
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runTransq } from "./core.js"
import { createNodeTransqRuntime } from "./platform.js"

interface TransqNodeConfig {
  config_path?: string
  database_path?: string
  python?: string
  source_root?: string
  module_name?: string
  record_run?: boolean
  dry_run?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const passthroughIndex = args.indexOf("--")
  const commandArgs = passthroughIndex >= 0 ? args.slice(0, passthroughIndex) : args
  const passthroughArgs = passthroughIndex >= 0 ? args.slice(passthroughIndex + 1) : []
  const json = commandArgs.includes("--json")
  const action = commandArgs.includes("run") ? "run" : commandArgs.includes("plan") ? "plan" : "status"
  const valueOptions = new Set(["--config-path", "--database-path", "--python", "--source-root", "--module-name"])
  const paths = commandArgs.filter((arg, index) => !arg.startsWith("--") && !["run", "plan", "status"].includes(arg) && !valueOptions.has(commandArgs[index - 1] ?? ""))

  const { config: nodeConfig } = await loadNodeConfigWithHints<TransqNodeConfig>("transq", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })

  const result = await runTransq({
    action,
    paths,
    args: passthroughArgs,
    configPath: valueFor(commandArgs, "--config-path") ?? nodeConfig?.config_path,
    databasePath: valueFor(commandArgs, "--database-path") ?? nodeConfig?.database_path,
    python: valueFor(commandArgs, "--python") ?? nodeConfig?.python,
    sourceRoot: valueFor(commandArgs, "--source-root") ?? nodeConfig?.source_root,
    moduleName: valueFor(commandArgs, "--module-name") ?? nodeConfig?.module_name,
    recordRun: commandArgs.includes("--record-run") || nodeConfig?.record_run === true,
    dryRun: commandArgs.includes("--dry-run") || nodeConfig?.dry_run === true,
  }, createNodeTransqRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
