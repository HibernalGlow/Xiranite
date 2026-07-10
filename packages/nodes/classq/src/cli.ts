#!/usr/bin/env node
import { hasPipedInput, readStdinLines } from "@xiranite/cli-runtime"
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runClassq } from "./core.js"
import type { ClassqAction, ClassqExistingPolicy, ClassqInput, ClassqTransferMode } from "./core.js"
import { createNodeClassqRuntime } from "./platform.js"

interface ClassqNodeConfig {
  keyword?: string
  wait_keyword?: string
  transfer_mode?: ClassqTransferMode
  existing_policy?: ClassqExistingPolicy
  dry_run?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action: ClassqAction = args.includes("classify") || args.includes("run") ? "classify" : "plan"
  const { config } = await loadNodeConfigWithHints<ClassqNodeConfig>("classq", { hintSink: { stderr: process.stderr }, jsonMode: json })
  let paths = pathArgs(args)
  if (paths.includes("-")) {
    paths = paths.filter((p) => p !== "-").concat(await readStdinLines())
  } else if (paths.length === 0 && hasPipedInput()) {
    paths = await readStdinLines()
  }
  const input: ClassqInput = {
    action,
    paths,
    keyword: valueFor(args, "--keyword") ?? config?.keyword,
    waitKeyword: valueFor(args, "--wait") ?? config?.wait_keyword,
    transferMode: valueFor(args, "--transfer") as ClassqTransferMode | undefined ?? config?.transfer_mode,
    existingPolicy: valueFor(args, "--existing") as ClassqExistingPolicy | undefined ?? config?.existing_policy,
    dryRun: action !== "classify" || args.includes("--dry-run") || config?.dry_run === true,
  }
  const result = await runClassq(input, createNodeClassqRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(result.message)
    for (const item of result.data?.items.slice(0, 80) ?? []) console.log(`${item.status}\t${item.stage}\t${item.sourceName}\t->\t${item.targetRelative}`)
  }
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()

function pathArgs(args: string[]): string[] {
  const commands = new Set(["plan", "classify", "run"])
  const valueOptions = new Set(["--keyword", "--wait", "--transfer", "--existing"])
  return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? ""))
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
