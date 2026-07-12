#!/usr/bin/env node
import { hasPipedInput, readStdinLines } from "@xiranite/cli-runtime"
import { runSamea } from "./core.js"
import type { SameaAction, SameaInput } from "./core.js"
import { createNodeSameaRuntime } from "./platform.js"

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action: SameaAction = args.includes("classify") || args.includes("run") ? "classify" : "plan"
  let paths = pathArgs(args)
  if (paths.includes("-")) paths = paths.filter((path) => path !== "-").concat(await readStdinLines())
  else if (!paths.length && hasPipedInput()) paths = await readStdinLines()
  const input: SameaInput = {
    action, paths,
    minOccurrences: numberFor(args, "--min") ?? undefined,
    centralize: args.includes("--centralize"),
    ignorePathBlacklist: args.includes("--ignore-path-blacklist"),
    dryRun: action !== "classify" || args.includes("--dry-run"),
  }
  const result = await runSamea(input, createNodeSameaRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(result.message)
    for (const item of result.data?.items.slice(0, 100) ?? []) console.log(`${item.status}\t${item.artistName}\t${item.sourcePath}\t->\t${item.targetPath}`)
  }
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()

function pathArgs(args: string[]): string[] {
  const commands = new Set(["plan", "classify", "run"])
  const valueOptions = new Set(["--min"])
  return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? ""))
}
function numberFor(args: string[], flag: string): number | undefined { const value = args[args.indexOf(flag) + 1]; return value === undefined ? undefined : Number(value) }
