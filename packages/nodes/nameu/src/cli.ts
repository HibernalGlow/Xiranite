#!/usr/bin/env node
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runNameu } from "./core.js"
import type { NameuAction, NameuInput, NameuMode } from "./core.js"
import { createNodeNameuRuntime } from "./platform.js"

interface NameuNodeConfig {
  mode?: NameuMode
  recursive?: boolean
  add_artist_name?: boolean
  normalize_folders?: boolean
  keep_timestamp?: boolean
  dry_run?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action: NameuAction = args.includes("rename") || args.includes("run") ? "rename" : args.includes("scan") ? "scan" : "plan"
  const { config } = await loadNodeConfigWithHints<NameuNodeConfig>("nameu", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })
  const input: NameuInput = {
    action,
    paths: pathArgs(args),
    mode: valueFor(args, "--mode") as NameuMode | undefined ?? config?.mode,
    recursive: args.includes("--no-recursive") ? false : config?.recursive,
    addArtistName: args.includes("--no-artist") ? false : config?.add_artist_name,
    normalizeFolders: args.includes("--no-folder-normalize") ? false : config?.normalize_folders,
    keepTimestamp: args.includes("--no-keep-time") ? false : config?.keep_timestamp,
    dryRun: action !== "rename" || args.includes("--dry-run") || config?.dry_run === true,
  }

  const result = await runNameu(input, createNodeNameuRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(result.message)
    for (const item of result.data?.items.slice(0, 80) ?? []) {
      console.log(`${item.status}\t${item.sourcePath}\t->\t${item.targetName}`)
    }
  }
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()

function pathArgs(args: string[]): string[] {
  const commands = new Set(["scan", "plan", "rename", "run"])
  const valueOptions = new Set(["--mode"])
  return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? ""))
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
