#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { CrashuAction, CrashuConflictPolicy, CrashuInput, CrashuMoveDirection } from "./core.js"
import { runCrashu } from "./core.js"
import { createNodeCrashuRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("crashu")

interface CrashuCliOptions {
  source?: string
  sourcePaths?: string
  targetPath?: string
  targetNames?: string
  destinationPath?: string
  threshold?: string | number
  similarityThreshold?: string | number
  autoMove?: boolean
  moveDirection?: CrashuMoveDirection
  conflictPolicy?: CrashuConflictPolicy
  pairsFileName?: string
  dryRun?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Match similar folder names and optionally move matched folders.",
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
    meta: { name: CLI_NAME, description: "Folder similarity matcher with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Find similar folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "scan", ...inputFromArgs(args as CrashuCliOptions) }, Boolean(args.json), host)
        },
      }),
      plan: defineCommand({
        meta: { name: "plan", description: "Preview move operations." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "plan", ...inputFromArgs(args as CrashuCliOptions) }, Boolean(args.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move matched folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "move", ...inputFromArgs(args as CrashuCliOptions), autoMove: true }, Boolean(args.json), host)
        },
      }),
      execute: defineCommand({
        meta: { name: "execute", description: "Alias for move." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "execute", ...inputFromArgs(args as CrashuCliOptions), autoMove: true }, Boolean(args.json), host)
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
    source: { type: "string", description: "Source directory. Repeat with --sourcePaths for more." },
    sourcePaths: { type: "string", description: "Comma, semicolon, or newline separated source directories." },
    targetPath: { type: "string", description: "Directory whose child folder names are targets." },
    targetNames: { type: "string", description: "Comma, semicolon, or newline separated target names." },
    destinationPath: { type: "string", description: "Move destination root." },
    threshold: { type: "string", description: "Similarity threshold from 0 to 1." },
    similarityThreshold: { type: "string", description: "Similarity threshold from 0 to 1." },
    autoMove: { type: "boolean", description: "Allow move actions." },
    moveDirection: { type: "string", description: "to_target or to_source." },
    conflictPolicy: { type: "string", description: "skip, overwrite, or rename." },
    pairsFileName: { type: "string", description: "Pairs JSON file name." },
    dryRun: { type: "boolean", description: "Preview without moving." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: CrashuCliOptions): CrashuInput {
  return {
    sourcePaths: splitArg(args.sourcePaths, args.source ? [args.source] : []),
    targetPath: args.targetPath,
    targetNames: splitArg(args.targetNames),
    destinationPath: args.destinationPath,
    similarityThreshold: numberArg(args.similarityThreshold ?? args.threshold),
    autoMove: args.autoMove,
    moveDirection: isDirection(args.moveDirection) ? args.moveDirection : undefined,
    conflictPolicy: isConflict(args.conflictPolicy) ? args.conflictPolicy : undefined,
    pairsFileName: args.pairsFileName,
    dryRun: args.dryRun,
  }
}

async function runAction(input: CrashuInput & { action: CrashuAction }, json: boolean, host: CliHost): Promise<void> {
  const result = await runCrashu(input, createNodeCrashuRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })
  if (json) {
    writeJson(host, result)
    return
  }
  writeLine(host, result.message)
  for (const item of result.data?.similarFolders?.slice(0, 40) ?? []) writeLine(host, `${Math.round(item.similarity * 100)}% ${item.path} -> ${item.target}`)
  for (const item of result.data?.plan?.slice(0, 40) ?? []) writeLine(host, `${item.status} ${item.sourcePath}${item.destinationPath ? ` -> ${item.destinationPath}` : ` / ${item.reason}`}`)
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `scan --source . --targetNames name --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedCrashuApp, { host }))
}

function GuidedCrashuApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"source" | "target" | "action" | "running" | "done">("source")
  const [source, setSource] = useState("")
  const [target, setTarget] = useState("")
  const [message, setMessage] = useState("Source directory.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "source") {
      setSource(value)
      setMessage("Target directory or target name.")
      setStep("target")
      return
    }
    if (step === "target") {
      setTarget(value)
      setMessage("Action: scan or plan.")
      setStep("action")
      return
    }
    await execute(value === "plan" ? "plan" : "scan")
  }

  async function execute(action: CrashuAction) {
    setStep("running")
    setMessage("Running...")
    const result = await runCrashu({ action, sourcePaths: [source], targetPath: target, targetNames: [target] }, createNodeCrashuRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "crashu guided"),
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

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: string | number): number | undefined {
  if (typeof value === "number") return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isDirection(value?: string): value is CrashuMoveDirection {
  return value === "to_target" || value === "to_source"
}

function isConflict(value?: string): value is CrashuConflictPolicy {
  return value === "skip" || value === "overwrite" || value === "rename"
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
