#!/usr/bin/env node
import { runSnf } from "./core.js"
import { createNodeSnfRuntime } from "./platform.js"

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action = args.includes("run") ? "run" : args.includes("plan") ? "plan" : "status"
  const paths = args.filter((arg) => !arg.startsWith("--") && !["run", "plan", "status"].includes(arg))
  const result = await runSnf({ action, paths, dryRun: args.includes("--dry-run") }, createNodeSnfRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
