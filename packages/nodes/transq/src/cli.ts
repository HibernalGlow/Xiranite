#!/usr/bin/env node
import { hasPipedInput, readStdinLines } from "@xiranite/cli-runtime"
import { loadNodeConfigWithHints } from "@xiranite/config"

import { runTransq } from "./core.js"
import { createNodeTransqRuntime } from "./platform.js"

interface TransqNodeConfig {
  preview?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action = args.includes("run") ? "run" : args.includes("plan") ? "plan" : "status"
  let paths = args.filter((arg) => !arg.startsWith("--") && !["run", "plan", "status"].includes(arg))
  if (paths.includes("-")) {
    paths = paths.filter((path) => path !== "-").concat(await readStdinLines())
  } else if (!paths.length && hasPipedInput()) {
    paths = await readStdinLines()
  }

  const { config } = await loadNodeConfigWithHints<TransqNodeConfig>("transq", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })
  const result = await runTransq({
    action,
    paths,
    preview: action === "plan" || (!args.includes("--live") && (args.includes("--preview") || config?.preview !== false)),
  }, createNodeTransqRuntime())

  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
