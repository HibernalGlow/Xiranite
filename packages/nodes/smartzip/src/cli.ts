#!/usr/bin/env node
import { runSmartZip } from "./core.js"
import { createNodeSmartZipRuntime } from "./platform.js"

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const dryRun = args.includes("--dry-run")
  const action = args.includes("x") ? "extract" : args.includes("xc") ? "extract_codepage" : args.includes("o") ? "open" : args.includes("a") ? "archive" : "status"
  const valueOptions = new Set(["--ini-path", "--database-path", "--smartzip-exe", "--smartzip-ahk", "--autohotkey-exe"])
  const paths = args.filter((arg, index) => !arg.startsWith("--") && !["x", "xc", "o", "a", "status"].includes(arg) && !valueOptions.has(args[index - 1] ?? ""))
  const result = await runSmartZip({
    action,
    paths,
    iniPath: valueFor(args, "--ini-path"),
    databasePath: valueFor(args, "--database-path"),
    smartZipExe: valueFor(args, "--smartzip-exe"),
    smartZipAhk: valueFor(args, "--smartzip-ahk"),
    autohotkeyExe: valueFor(args, "--autohotkey-exe"),
    recordRun: args.includes("--record-run"),
    dryRun,
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
