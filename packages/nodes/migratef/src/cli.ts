#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { MigratefInput, MigratefMode } from "./core.js"
import { runMigratef } from "./core.js"
import { createNodeMigratefRuntime } from "./platform.js"

interface MigratefCliOptions {
  path?: string
  source?: string
  target?: string
  mode?: MigratefMode
  historyPath?: string
  batchId?: string
  dryRun?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: "xiranite-migratef",
  description: "Copy or move files with preserve, flat, direct, and undo modes.",
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
    meta: { name: "xiranite-migratef", description: "File migrator with guided terminal mode." },
    subCommands: {
      plan: defineCommand({
        meta: { name: "plan", description: "Preview a migration plan." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "plan", ...inputFromArgs(args as MigratefCliOptions) }, Boolean(args.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move files or folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "move", ...inputFromArgs(args as MigratefCliOptions) }, Boolean(args.json), host)
        },
      }),
      copy: defineCommand({
        meta: { name: "copy", description: "Copy files or folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "copy", ...inputFromArgs(args as MigratefCliOptions) }, Boolean(args.json), host)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "Show undo history." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "history", ...inputFromArgs(args as MigratefCliOptions) }, Boolean(args.json), host)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo a migration batch." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "undo", ...inputFromArgs(args as MigratefCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Comma-separated source paths." },
    source: { type: "string", description: "Comma-separated source paths." },
    target: { type: "string", description: "Target directory." },
    mode: { type: "string", description: "preserve, flat, or direct." },
    historyPath: { type: "string", description: "Undo history JSON path." },
    batchId: { type: "string", description: "Undo batch id." },
    dryRun: { type: "boolean", description: "Preview without changing files." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: MigratefCliOptions): MigratefInput {
  return {
    sourcePaths: splitArg(args.source || args.path),
    targetPath: args.target,
    mode: args.mode ?? "preserve",
    historyPath: args.historyPath,
    batchId: args.batchId,
    dryRun: Boolean(args.dryRun),
  }
}

async function runAction(input: MigratefInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runMigratef(input, createNodeMigratefRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })
  if (json) {
    writeJson(host, result)
    return
  }
  writeLine(host, result.message)
  for (const item of result.data?.plan?.slice(0, 30) ?? []) writeLine(host, `${item.status} ${item.sourcePath} -> ${item.targetPath || item.reason}`)
  for (const item of result.data?.history?.slice(0, 20) ?? []) writeLine(host, `${item.id} ${item.action} ${item.operations.length}`)
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `plan --source a --target b --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedMigratefApp, { host }))
}

function GuidedMigratefApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"source" | "target" | "action" | "running" | "done">("source")
  const [source, setSource] = useState("")
  const [target, setTarget] = useState("")
  const [message, setMessage] = useState("Source paths, comma-separated.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "source") {
      setSource(value)
      setMessage("Target directory.")
      setStep("target")
      return
    }
    if (step === "target") {
      setTarget(value)
      setMessage("Action: plan, move, copy.")
      setStep("action")
      return
    }
    if (step === "action") {
      const action = value === "copy" || value === "move" ? value : "plan"
      await execute({ action, sourcePaths: splitArg(source), targetPath: target, mode: "preserve", dryRun: action === "plan" })
    }
  }

  async function execute(input: MigratefInput) {
    setStep("running")
    setMessage("Running...")
    const result = await runMigratef(input, createNodeMigratefRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "migratef guided"),
    h(Text, null, message),
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
