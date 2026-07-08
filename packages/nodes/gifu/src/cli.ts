#!/usr/bin/env node
import { runGifu } from "./core.js"
import { createNodeGifuRuntime } from "./platform.js"

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const dryRun = args.includes("--dry-run")
  const action = args.includes("make") ? "make" : args.includes("plan") ? "plan" : "inspect"
  const paths = args.filter((arg) => !arg.startsWith("--") && !["make", "plan", "inspect"].includes(arg))
  const result = await runGifu({ action, paths, dryRun }, createNodeGifuRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
