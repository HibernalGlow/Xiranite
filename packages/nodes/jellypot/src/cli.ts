#!/usr/bin/env node
import { runJellyPot } from "./core.js"
import { createNodeJellyPotRuntime } from "./platform.js"

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const dryRun = args.includes("--dry-run")
  const action = args.includes("launch") ? "launch_media" : args.includes("open") ? "open_jellyfin" : args.includes("registry") ? "apply_registry" : "status"
  const mediaPath = args.find((arg) => !arg.startsWith("--") && !["launch", "open", "registry", "status"].includes(arg))
  const result = await runJellyPot({ action, mediaPath, dryRun }, createNodeJellyPotRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
