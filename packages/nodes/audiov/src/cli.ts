#!/usr/bin/env node
import { loadNodeConfigWithHints } from "@xiranite/config"
import { hasPipedInput, readStdinLines } from "@xiranite/cli-runtime"

import { runAudiov } from "./core.js"
import { createNodeAudiovRuntime } from "./platform.js"

interface AudiovNodeConfig {
  dry_run?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action = args.includes("run") ? "run" : args.includes("plan") ? "plan" : "status"
  let paths = args.filter((arg) => !arg.startsWith("--") && !["run", "plan", "status"].includes(arg))
  if (paths.includes("-")) {
    paths = paths.filter((path) => path !== "-").concat(await readStdinLines())
  } else if (paths.length === 0 && hasPipedInput()) {
    paths = await readStdinLines()
  }

  const { config } = await loadNodeConfigWithHints<AudiovNodeConfig>("audiov", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })
  const result = await runAudiov({
    action,
    paths,
    dryRun: args.includes("--dry-run") || config?.dry_run === true,
  }, createNodeAudiovRuntime())

  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
