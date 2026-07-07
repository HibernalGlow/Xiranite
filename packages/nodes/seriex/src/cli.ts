#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeCliEvent, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { SeriexInput } from "./core.js"
import { runSeriex } from "./core.js"
import { createNodeSeriexRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("seriex")

interface SeriexCliOptions {
  path?: string
  config?: string
  prefix?: string
  known?: string
  knownDir?: string
  noPrefix?: boolean
  dryRun?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Plan and apply archive series extraction.",
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
    meta: { name: CLI_NAME, description: "Series archive extractor with guided terminal mode." },
    subCommands: {
      plan: defineCommand({
        meta: { name: "plan", description: "Generate a series extraction plan." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "plan", ...inputFromArgs(args as SeriexCliOptions) }, Boolean(args.json), host)
        },
      }),
      execute: defineCommand({
        meta: { name: "execute", description: "Generate and apply a series extraction plan." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "execute", ...inputFromArgs(args as SeriexCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Directory to process." },
    config: { type: "string", description: "seriex.toml path." },
    prefix: { type: "string", description: "Series folder prefix." },
    known: { type: "string", description: "Comma-separated known series names." },
    knownDir: { type: "string", description: "Comma-separated reference directories." },
    noPrefix: { type: "boolean", description: "Do not prefix generated series folders." },
    dryRun: { type: "boolean", description: "Only print the plan." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: SeriexCliOptions): SeriexInput {
  return {
    directoryPath: args.path,
    configPath: args.config,
    prefix: args.prefix || "[#s]",
    addPrefix: !args.noPrefix,
    knownSeriesNames: splitArg(args.known),
    knownSeriesDirs: splitArg(args.knownDir),
    dryRun: Boolean(args.dryRun),
  }
}

async function runAction(input: SeriexInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runSeriex(input, createNodeSeriexRuntime(), (event) => {
    if (!json) writeCliEvent(host, event, { label: CLI_NAME })
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  if (result.data?.planItems.length) {
    for (const item of result.data.planItems) writeLine(host, `${item.folder}: ${item.files.length} file(s)`)
  }
  if (result.data?.moveItems.length) {
    for (const item of result.data.moveItems) writeLine(host, `${item.success ? "OK" : "FAIL"} ${item.filename} -> ${item.folder}`)
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `plan --path . --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedSeriexApp, { host }))
}

function GuidedSeriexApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"path" | "mode" | "running" | "done">("path")
  const [path, setPath] = useState("")
  const [message, setMessage] = useState("Directory path.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "path") {
      setPath(value)
      setMessage("Mode: plan or execute.")
      setStep("mode")
      return
    }
    if (step === "mode") await execute({ action: value === "execute" ? "execute" : "plan", directoryPath: path })
  }

  async function execute(input: SeriexInput) {
    setStep("running")
    setMessage("Running...")
    const result = await runSeriex(input, createNodeSeriexRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "seriex guided"),
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
