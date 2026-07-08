#!/usr/bin/env node
import { runSimiu } from "./core.js"
import { createNodeSimiuRuntime } from "./platform.js"

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const dryRun = args.includes("--apply") ? false : true
  const action = args.includes("apply") ? "apply" : args.includes("plan") ? "plan" : "scan"
  const roots = args.filter((arg) => !arg.startsWith("--") && !["scan", "plan", "apply"].includes(arg))
  const result = await runSimiu({ action, roots, dryRun }, createNodeSimiuRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
