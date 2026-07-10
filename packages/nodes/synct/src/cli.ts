#!/usr/bin/env node
import { hasPipedInput, readStdinLines } from "@xiranite/cli-runtime"
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runSynct } from "./core.js"
import type { SynctAction, SynctFormatKey, SynctInput, SynctSourceMode } from "./core.js"
import { createNodeSynctRuntime } from "./platform.js"

interface SynctNodeConfig {
  source_mode?: SynctSourceMode
  format_key?: SynctFormatKey
  recursive?: boolean
  archive_folder?: boolean
  fallback_to_created_time?: boolean
  sync_folder_file_times?: boolean
  dry_run?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action: SynctAction = args.includes("archive") || args.includes("run") ? "archive" : args.includes("scan") ? "scan" : "plan"
  const { config } = await loadNodeConfigWithHints<SynctNodeConfig>("synct", { hintSink: { stderr: process.stderr }, jsonMode: json })
  let paths = pathArgs(args)
  if (paths.includes("-")) {
    paths = paths.filter(p => p !== "-").concat(await readStdinLines())
  } else if (paths.length === 0 && hasPipedInput()) {
    paths = await readStdinLines()
  }
  const input: SynctInput = {
    action,
    paths,
    sourceMode: valueFor(args, "--source-mode") as SynctSourceMode | undefined ?? config?.source_mode,
    formatKey: valueFor(args, "--format") as SynctFormatKey | undefined ?? config?.format_key,
    recursive: args.includes("--recursive") || config?.recursive === true,
    archiveFolder: args.includes("--archive-folder") || config?.archive_folder === true,
    fallbackToCreatedTime: args.includes("--no-fallback") ? false : config?.fallback_to_created_time,
    syncFolderFileTimes: args.includes("--no-sync-file-times") ? false : config?.sync_folder_file_times,
    dryRun: action !== "archive" || args.includes("--dry-run") || config?.dry_run === true,
  }
  const result = await runSynct(input, createNodeSynctRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(result.message)
    for (const item of result.data?.items.slice(0, 80) ?? []) console.log(`${item.status}\t${item.sourceName}\t->\t${item.targetRelative}`)
  }
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()

function pathArgs(args: string[]): string[] {
  const commands = new Set(["scan", "plan", "archive", "run"])
  const valueOptions = new Set(["--source-mode", "--format"])
  return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? ""))
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
