#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeCliEvent, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { RawfilterAction, RawfilterInput } from "./core.js"
import { runRawfilter } from "./core.js"
import { createNodeRawfilterRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("rawfilter")

interface RawfilterCliOptions {
  path?: string
  nameOnly?: boolean
  nameOnlyMode?: boolean
  createShortcuts?: boolean
  trashOnly?: boolean
  minSimilarity?: string | number
  dryRun?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Group similar archives and move duplicate/raw versions to trash or multi.",
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
    meta: { name: CLI_NAME, description: "Archive similarity filter with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan and group archives without changing files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "scan", ...inputFromArgs(args as RawfilterCliOptions) }, Boolean(args.json), host)
        },
      }),
      plan: defineCommand({
        meta: { name: "plan", description: "Preview file operations." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "plan", ...inputFromArgs(args as RawfilterCliOptions) }, Boolean(args.json), host)
        },
      }),
      execute: defineCommand({
        meta: { name: "execute", description: "Move duplicate/raw versions according to the plan." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "execute", ...inputFromArgs(args as RawfilterCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Directory containing archive files." },
    nameOnly: { type: "boolean", description: "Use exact normalized names only." },
    nameOnlyMode: { type: "boolean", description: "Alias for --nameOnly." },
    createShortcuts: { type: "boolean", description: "Create shortcuts for multi versions instead of moving them." },
    trashOnly: { type: "boolean", description: "Move every non-kept duplicate to trash." },
    minSimilarity: { type: "string", description: "Fuzzy grouping threshold from 0 to 1." },
    dryRun: { type: "boolean", description: "Preview without changing files." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: RawfilterCliOptions): RawfilterInput {
  return {
    path: args.path,
    nameOnlyMode: Boolean(args.nameOnly || args.nameOnlyMode),
    createShortcuts: args.createShortcuts,
    trashOnly: args.trashOnly,
    minSimilarity: numberArg(args.minSimilarity),
    dryRun: args.dryRun,
  }
}

async function runAction(input: RawfilterInput & { action: RawfilterAction }, json: boolean, host: CliHost): Promise<void> {
  const result = await runRawfilter(input, createNodeRawfilterRuntime(), (event) => {
    if (!json) writeCliEvent(host, event, { label: CLI_NAME })
  })
  if (json) {
    writeJson(host, result)
    return
  }
  writeLine(host, result.message)
  for (const item of result.data?.plan?.slice(0, 80) ?? []) {
    writeLine(host, `${item.status} ${item.destination} ${item.fileName}${item.targetPath ? ` -> ${item.targetPath}` : ` / ${item.reason}`}`)
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `plan --path . --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedRawfilterApp, { host }))
}

function GuidedRawfilterApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"path" | "action" | "running" | "done">("path")
  const [path, setPath] = useState("")
  const [message, setMessage] = useState("Directory path.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "path") {
      setPath(value)
      setMessage("Action: plan or execute.")
      setStep("action")
      return
    }
    await execute(normalizeGuidedAction(value))
  }

  async function execute(action: RawfilterAction) {
    setStep("running")
    setMessage("Running...")
    const result = await runRawfilter({ action, path }, createNodeRawfilterRuntime(), (event) => {
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
    { flexDirection: "column", gap: 1 },
    h(
      Box,
      { borderStyle: "round", borderColor: "cyan", flexDirection: "column", paddingX: 1, width: 76 },
      h(Text, { color: "cyan", bold: true }, "Xiranite Rawfilter"),
      h(Text, null, h(Text, { color: "cyan" }, "Entry   "), "Ink guided flow for duplicate archive filtering"),
      h(Text, null, h(Text, { color: "cyan" }, "Run     "), "Direct core/platform call with dry plan before execute"),
      h(Text, null, h(Text, { color: "cyan" }, "Script  "), `${CLI_NAME} plan --path <archive-folder> --json`),
    ),
    h(
      Box,
      { borderStyle: "single", borderColor: step === "done" ? "green" : "gray", flexDirection: "column", paddingX: 1, width: 76 },
      h(Text, { color: step === "done" ? "green" : "yellow", bold: true }, step === "done" ? "Result" : "Prompt"),
      h(Text, null, message),
      step !== "done" && step !== "running" ? h(InputLine, { onSubmit: submit }) : null,
    ),
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
  return h(Text, null, h(Text, { color: "cyan" }, "> "), value, h(Text, { inverse: true }, " "))
}

function normalizeGuidedAction(value: string): RawfilterAction {
  const action = value.trim().toLowerCase()
  return action === "execute" ? "execute" : "plan"
}

function numberArg(value?: string | number): number | undefined {
  if (typeof value === "number") return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
