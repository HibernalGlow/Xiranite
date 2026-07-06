#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { LataInput } from "./core.js"
import { runLata } from "./core.js"
import { createNodeLataRuntime } from "./platform.js"

interface LataCliOptions {
  path?: string
  taskfile?: string
  task?: string
  args?: string
  cwd?: string
  json?: boolean
}

export const cli: CliCommand = {
  name: "xiranite-lata",
  description: "Taskfile launcher with list, plan, execute, and guided modes.",
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
    meta: { name: "xiranite-lata", description: "Taskfile launcher with guided terminal mode." },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "List tasks from a Taskfile." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "list", ...inputFromArgs(args as LataCliOptions) }, Boolean(args.json), host)
        },
      }),
      plan: defineCommand({
        meta: { name: "plan", description: "Preview the commands for a task." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "plan", ...inputFromArgs(args as LataCliOptions) }, Boolean(args.json), host)
        },
      }),
      execute: defineCommand({
        meta: { name: "execute", description: "Execute a task." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "execute", ...inputFromArgs(args as LataCliOptions) }, Boolean(args.json), host)
        },
      }),
      run: defineCommand({
        meta: { name: "run", description: "Alias for execute." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "execute", ...inputFromArgs(args as LataCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Taskfile path." },
    taskfile: { type: "string", description: "Taskfile path." },
    task: { type: "string", description: "Task name." },
    args: { type: "string", description: "Task args exposed as {{.CLI_ARGS}} and LATA_ARGS." },
    cwd: { type: "string", description: "Working directory for Taskfile discovery." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: LataCliOptions): LataInput {
  return {
    taskfilePath: args.taskfile || args.path,
    taskName: args.task,
    taskArgs: args.args ?? "",
    cwd: args.cwd,
  }
}

async function runAction(input: LataInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runLata(input, createNodeLataRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })
  if (json) {
    writeJson(host, result)
    return
  }
  writeLine(host, result.message)
  for (const task of result.data?.tasks?.slice(0, 80) ?? []) writeLine(host, `${task.name} (${task.cmdCount}) ${task.desc}`)
  for (const item of result.data?.commandPlan?.slice(0, 80) ?? []) writeLine(host, `${item.taskName}: ${item.command}`)
  for (const item of result.data?.commandResults?.slice(0, 80) ?? []) writeLine(host, `${item.exitCode} ${item.taskName}: ${item.command}`)
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `list --path Taskfile.yml --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedLataApp, { host }))
}

function GuidedLataApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"taskfile" | "task" | "running" | "done">("taskfile")
  const [taskfile, setTaskfile] = useState("")
  const [message, setMessage] = useState("Taskfile path, or blank to use cwd.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "taskfile") {
      setTaskfile(value)
      const result = await runLata({ action: "list", taskfilePath: value }, createNodeLataRuntime())
      setLines(result.data?.tasks.map((task) => `${task.name} (${task.cmdCount})`) ?? [result.message])
      setMessage("Task name to execute.")
      setStep("task")
      return
    }
    await execute(value)
  }

  async function execute(taskName: string) {
    setStep("running")
    setMessage("Running...")
    const result = await runLata({ action: "execute", taskfilePath: taskfile, taskName }, createNodeLataRuntime(), (event) => {
      setLines((current) => [...current.slice(-8), event.message])
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
    h(Text, { color: "cyan", bold: true }, "lata guided"),
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
