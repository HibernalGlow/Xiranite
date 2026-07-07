#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeCliEvent, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { FormatvAction, FormatvInput } from "./core.js"
import { runFormatv } from "./core.js"
import { createNodeFormatvRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("formatv")

interface FormatvCliOptions {
  path?: string
  paths?: string
  recursive?: boolean
  prefixName?: string
  prefix?: string
  dryRun?: boolean
  reportPath?: string
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Scan video folders, add/remove .nov suffixes, and check prefixed duplicates.",
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
    meta: { name: CLI_NAME, description: "Video .nov suffix and duplicate checker with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan video files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "scan", ...inputFromArgs(args as FormatvCliOptions) }, Boolean(args.json), host)
        },
      }),
      "add-nov": defineCommand({
        meta: { name: "add-nov", description: "Add .nov suffix to normal video files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "add_nov", ...inputFromArgs(args as FormatvCliOptions) }, Boolean(args.json), host)
        },
      }),
      "remove-nov": defineCommand({
        meta: { name: "remove-nov", description: "Remove .nov suffix from .nov video files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "remove_nov", ...inputFromArgs(args as FormatvCliOptions) }, Boolean(args.json), host)
        },
      }),
      duplicates: defineCommand({
        meta: { name: "duplicates", description: "Check prefixed files against original duplicates." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "check_duplicates", ...inputFromArgs(args as FormatvCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Input file or folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated paths." },
    recursive: { type: "boolean", description: "Recurse into folders." },
    prefixName: { type: "string", description: "Prefix config name, default hb." },
    prefix: { type: "string", description: "Alias for --prefixName." },
    dryRun: { type: "boolean", description: "Plan renames or skip duplicate report writing." },
    reportPath: { type: "string", description: "Duplicate report JSON path." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: FormatvCliOptions): FormatvInput {
  return {
    paths: splitArg(args.paths, args.path ? [args.path] : []),
    recursive: args.recursive,
    prefixName: args.prefixName || args.prefix,
    dryRun: args.dryRun,
    reportPath: args.reportPath,
  }
}

async function runAction(input: FormatvInput & { action: FormatvAction }, json: boolean, host: CliHost): Promise<void> {
  const result = await runFormatv(input, createNodeFormatvRuntime(), (event) => {
    if (!json) writeCliEvent(host, event, { label: CLI_NAME })
  })
  if (json) {
    writeJson(host, result)
    return
  }
  writeLine(host, result.message)
  writeLine(host, `normal=${result.data?.normalCount ?? 0} nov=${result.data?.novCount ?? 0} duplicates=${result.data?.duplicateCount ?? 0}`)
  for (const item of result.data?.operations?.slice(0, 50) ?? []) writeLine(host, `${item.status} ${item.sourcePath} -> ${item.targetPath}${item.reason ? ` / ${item.reason}` : ""}`)
  for (const item of result.data?.duplicates?.slice(0, 50) ?? []) writeLine(host, `duplicate ${item}`)
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `scan --path . --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedFormatvApp, { host }))
}

function GuidedFormatvApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"path" | "action" | "running" | "done">("path")
  const [path, setPath] = useState("")
  const [message, setMessage] = useState("Video folder path.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "path") {
      setPath(value)
      setMessage("Action: scan, add, remove, duplicates.")
      setStep("action")
      return
    }
    await execute(normalizeGuidedAction(value))
  }

  async function execute(action: FormatvAction) {
    setStep("running")
    setMessage("Running...")
    const result = await runFormatv({ action, path }, createNodeFormatvRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "formatv guided"),
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

function normalizeGuidedAction(value: string): FormatvAction {
  const action = value.trim().toLowerCase()
  if (action === "add" || action === "add_nov" || action === "add-nov") return "add_nov"
  if (action === "remove" || action === "remove_nov" || action === "remove-nov") return "remove_nov"
  if (action === "duplicates" || action === "check_duplicates") return "check_duplicates"
  return "scan"
}

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
