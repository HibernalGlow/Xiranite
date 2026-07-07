#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeCliEvent, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { MoveaInput } from "./core.js"
import { runMovea } from "./core.js"
import { createNodeMoveaRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("movea")

interface MoveaCliOptions {
  path?: string
  root?: string
  level1?: string
  archive?: string
  folders?: string
  regex?: string
  plan?: string
  dryRun?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Scan and move archives or folders into numbered target folders.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  if (args.length === 0) {
    await runGuided(host)
    return
  }
  await runMain(createProgram(host), { rawArgs: args })
}

function createDefaultHost(): CliHost {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "Archive classifier mover with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan a root path for movable archives and folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "scan", ...inputFromArgs(args as MoveaCliOptions) }, Boolean(args.json), host)
        },
      }),
      match: defineCommand({
        meta: { name: "match", description: "Preview target folders for an archive name." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "match", ...inputFromArgs(args as MoveaCliOptions) }, Boolean(args.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move items according to --plan JSON inside --level1." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "move_single", ...inputFromArgs(args as MoveaCliOptions) }, Boolean(args.json), host)
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Open the rich guided terminal workflow." },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

function commonArgs() {
  return {
    path: { type: "string", description: "Root path." },
    root: { type: "string", description: "Root path." },
    level1: { type: "string", description: "First-level folder name." },
    archive: { type: "string", description: "Archive name to match." },
    folders: { type: "string", description: "Comma-separated target folder names." },
    regex: { type: "string", description: "Comma-separated regex patterns." },
    plan: { type: "string", description: "Move plan JSON, for example {\"book.zip\":\"1. comics\"}." },
    dryRun: { type: "boolean", description: "Preview moves without changing files." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: MoveaCliOptions): MoveaInput {
  return {
    rootPath: args.root || args.path,
    level1Name: args.level1,
    archiveName: args.archive,
    subfolders: splitArg(args.folders),
    regexPatterns: splitArg(args.regex),
    movePlan: parsePlan(args.plan),
    dryRun: Boolean(args.dryRun),
  }
}

async function runAction(input: MoveaInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runMovea(input, createNodeMoveaRuntime(), (event) => {
    if (!json) writeCliEvent(host, event, { label: CLI_NAME })
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  if (result.data?.matchedFolders.length) {
    for (const folder of result.data.matchedFolders) writeLine(host, `- ${folder}`)
  }
  if (result.data?.moveItems.length) {
    for (const item of result.data.moveItems) writeLine(host, `${item.success ? "OK" : "FAIL"} ${item.itemName} -> ${item.targetFolder}`)
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `scan --path . --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedMoveaApp, { host }))
}

function GuidedMoveaApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "path" | "archive" | "folders" | "running" | "done">("action")
  const [action, setAction] = useState<"scan" | "match">("scan")
  const [rootPath, setRootPath] = useState("")
  const [archiveName, setArchiveName] = useState("")
  const [message, setMessage] = useState("Action: scan or match.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const next = value === "match" ? "match" : "scan"
      setAction(next)
      setMessage(next === "scan" ? "Root path." : "Archive name.")
      setStep(next === "scan" ? "path" : "archive")
      return
    }
    if (step === "path") {
      setRootPath(value)
      await execute({ action: "scan", rootPath: value })
      return
    }
    if (step === "archive") {
      setArchiveName(value)
      setMessage("Target folders, comma-separated.")
      setStep("folders")
      return
    }
    if (step === "folders") await execute({ action, archiveName, subfolders: splitArg(value) })
  }

  async function execute(input: MoveaInput) {
    setStep("running")
    setMessage("Running...")
    const result = await runMovea(input, createNodeMoveaRuntime(), (event) => {
      setLines((current) => [...current.slice(-8), `[${event.progress ?? 0}%] ${event.message}`])
    })
    setLines((current) => [...current.slice(-8), result.message])
    writeLine(host, result.message)
    setMessage("Completed. Press q to exit.")
    setStep("done")
  }

  useInput((input) => {
    if (step === "done" && (input === "q" || input === "\u0003")) app.exit()
  })

  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { color: "cyan", bold: true }, "movea guided"),
    h(Text, null, rootPath ? `root: ${rootPath}` : message),
    step !== "done" && step !== "running" ? h(InputLine, { onSubmit: submit }) : null,
    ...lines.map((line) => h(Text, { key: line, color: "gray" }, line)),
  )
}

function InputLine({ onSubmit }: { onSubmit: (value: string) => void | Promise<void> }) {
  const [value, setValue] = useState("")
  useInput((input, key) => {
    if (key.return) {
      void onSubmit(value.trim())
      setValue("")
      return
    }
    if (key.backspace || key.delete) setValue((current) => current.slice(0, -1))
    else if (!key.ctrl && input) setValue((current) => current + input)
  })
  return h(Text, null, "> ", value, h(Text, { inverse: true }, " "))
}

function splitArg(value?: string): string[] {
  return (value ?? "").split(/[,;\r\n]/).map((item) => item.trim()).filter(Boolean)
}

function parsePlan(value?: string): Record<string, string | null> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string | null> : {}
  } catch {
    return {}
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
