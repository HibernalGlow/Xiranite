#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { nodeCliName, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { parseBatongAction, runBatong, type BatongInput } from "./core.js"
import { createNodeBatongRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("batong")

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Baton session migration wrapper for drawing-workflow coding agents.",
  run: (args, host) => runProgram(args, host),
}

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  if (!args.length || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    usage(host)
    return
  }

  let parsed: { input: BatongInput; json: boolean }
  try {
    parsed = parseArgs(args)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  const result = await runBatong(parsed.input, createNodeBatongRuntime())
  if (parsed.json) writeJson(host, result)
  else {
    writeLine(host, result.message)
    if (result.data?.output) writeLine(host, result.data.output)
  }
  if (!result.success) process.exitCode = 1
}

export function parseArgs(args: string[]): { input: BatongInput; json: boolean } {
  const action = parseBatongAction(args[0])
  if (!action) throw new Error(`Unknown BATONG command: ${args[0] ?? ""}. Use \`${CLI_NAME} --help\`.`)
  const tail = args.slice(1)
  const json = tail.includes("--json")
  const raw = tail.filter((arg) => arg !== "--json")
  if (action !== "convert") return { input: { action, rawArgs: [action, ...raw] }, json }

  let from: string | undefined
  let to: string | undefined
  let latest = false
  let importTarget = false
  let sessionPath: string | undefined

  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index]!
    if (arg === "--from" || arg === "--to") {
      const value = raw[++index]
      if (!value) throw new Error(`${arg} requires an agent format.`)
      if (arg === "--from") from = value
      else to = value
      continue
    }
    if (arg.startsWith("--from=")) { from = arg.slice("--from=".length); continue }
    if (arg.startsWith("--to=")) { to = arg.slice("--to=".length); continue }
    if (arg === "--latest") { latest = true; continue }
    if (arg === "--import") { importTarget = true; continue }
    if (!arg.startsWith("-") && !sessionPath) { sessionPath = arg; continue }
  }

  return { input: { action, from, to, sessionPath, latest, import: importTarget, rawArgs: [action, ...raw] }, json }
}

function usage(host: CliHost) {
  writeLine(host, `Usage:\n  ${CLI_NAME} list [baton options] [--json]\n  ${CLI_NAME} doctor [baton options] [--json]\n  ${CLI_NAME} install [baton options] [--json]\n  ${CLI_NAME} uninstall [baton options] [--json]\n  ${CLI_NAME} convert --from <agent> --to <agent> [session-file] [--latest] [--import] [additional Baton options] [--json]\n\nAll unsupported options are passed through to the installed Baton CLI unchanged.`)
}

function defaultHost(): CliHost {
  return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runProgram().catch((error) => {
    writeError(defaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
