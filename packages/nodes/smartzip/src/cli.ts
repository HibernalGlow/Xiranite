#!/usr/bin/env node
import { hasPipedInput, readStdinLines } from "@xiranite/cli-runtime"
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runSmartZip } from "./core.js"
import { createNodeSmartZipRuntime } from "./platform.js"

interface SmartzipNodeConfig {
  ini_path?: string
  database_path?: string
  smartzip_exe?: string
  smartzip_ahk?: string
  autohotkey_exe?: string
  record_run?: boolean
  dry_run?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action = args.includes("x") ? "extract" : args.includes("xc") ? "extract_codepage" : args.includes("o") ? "open" : args.includes("a") ? "archive" : "status"
  const valueOptions = new Set(["--ini-path", "--database-path", "--smartzip-exe", "--smartzip-ahk", "--autohotkey-exe"])
  let paths = args.filter((arg, index) => !arg.startsWith("--") && !["x", "xc", "o", "a", "status"].includes(arg) && !valueOptions.has(args[index - 1] ?? ""))
  if (paths.includes("-")) {
    paths = paths.filter(p => p !== "-").concat(await readStdinLines())
  } else if (paths.length === 0 && hasPipedInput()) {
    paths = await readStdinLines()
  }

  const { config: nodeConfig } = await loadNodeConfigWithHints<SmartzipNodeConfig>("smartzip", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })

  const result = await runSmartZip({
    action,
    paths,
    iniPath: valueFor(args, "--ini-path") ?? nodeConfig?.ini_path,
    databasePath: valueFor(args, "--database-path") ?? nodeConfig?.database_path,
    smartZipExe: valueFor(args, "--smartzip-exe") ?? nodeConfig?.smartzip_exe,
    smartZipAhk: valueFor(args, "--smartzip-ahk") ?? nodeConfig?.smartzip_ahk,
    autohotkeyExe: valueFor(args, "--autohotkey-exe") ?? nodeConfig?.autohotkey_exe,
    recordRun: args.includes("--record-run") || nodeConfig?.record_run === true,
    dryRun: args.includes("--dry-run") || nodeConfig?.dry_run === true,
  }, createNodeSmartZipRuntime())
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
