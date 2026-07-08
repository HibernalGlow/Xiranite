#!/usr/bin/env node
import { runSmartZip } from "./core.js"
import { createNodeSmartZipRuntime } from "./platform.js"

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const dryRun = args.includes("--dry-run")
  const action = args.includes("x") ? "extract" : args.includes("xc") ? "extract_codepage" : args.includes("o") ? "open" : args.includes("a") ? "archive" : "status"
  const paths = args.filter((arg) => !arg.startsWith("--") && !["x", "xc", "o", "a", "status"].includes(arg))
  const result = await runSmartZip({ action, paths, dryRun }, createNodeSmartZipRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
