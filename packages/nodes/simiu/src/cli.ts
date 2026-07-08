#!/usr/bin/env node
import { runSimiu } from "./core.js"
import { createNodeSimiuRuntime } from "./platform.js"

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const dryRun = args.includes("--apply") ? false : true
  const action = args.includes("apply") ? "apply" : args.includes("plan") ? "plan" : "scan"
  const valueOptions = new Set(["--config-path", "--database-path"])
  const roots = args.filter((arg, index) => !arg.startsWith("--") && !["scan", "plan", "apply"].includes(arg) && !valueOptions.has(args[index - 1] ?? ""))
  const result = await runSimiu({
    action,
    roots,
    configPath: valueFor(args, "--config-path"),
    databasePath: valueFor(args, "--database-path"),
    recordRun: args.includes("--record-run"),
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
