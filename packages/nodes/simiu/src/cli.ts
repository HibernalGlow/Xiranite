#!/usr/bin/env node
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runSimiu } from "./core.js"
import { createNodeSimiuRuntime } from "./platform.js"

interface SimiuNodeConfig {
  config_path?: string
  database_path?: string
  record_run?: boolean
  dry_run?: boolean
  recursive?: boolean
  scan_order?: "path" | "smallest-first" | "deepest-first"
  name_prefix?: string
  min_group_size?: number
  size_tolerance_bytes?: number
  mode?: "move" | "copy" | "link"
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action = args.includes("apply") ? "apply" : args.includes("plan") ? "plan" : "scan"
  const valueOptions = new Set(["--config-path", "--database-path"])
  const roots = args.filter((arg, index) => !arg.startsWith("--") && !["scan", "plan", "apply"].includes(arg) && !valueOptions.has(args[index - 1] ?? ""))

  const { config: nodeConfig } = await loadNodeConfigWithHints<SimiuNodeConfig>("simiu", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })

  const dryRun = args.includes("--apply") ? false : (nodeConfig?.dry_run ?? true)
  const result = await runSimiu({
    action,
    roots,
    configPath: valueFor(args, "--config-path") ?? nodeConfig?.config_path,
    databasePath: valueFor(args, "--database-path") ?? nodeConfig?.database_path,
    recordRun: args.includes("--record-run") || nodeConfig?.record_run === true,
    recursive: nodeConfig?.recursive,
    scanOrder: nodeConfig?.scan_order,
    namePrefix: nodeConfig?.name_prefix,
    minGroupSize: nodeConfig?.min_group_size,
    sizeToleranceBytes: nodeConfig?.size_tolerance_bytes,
    mode: nodeConfig?.mode,
    dryRun,
  }, createNodeSimiuRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
