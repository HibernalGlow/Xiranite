#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeCliEvent, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { CleanfInput, CleanfPresetId } from "./core.js"
import { getDefaultPresets, parseCleanfPaths, runCleanf } from "./core.js"
import { createNodeCleanfRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("cleanf")

interface CleanfCliOptions {
  paths?: string
  presets?: string
  exclude?: string
  preview?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Remove empty folders, backup files, temp folders, and trash patterns.",
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
    meta: {
      name: CLI_NAME,
      description: "File cleanup CLI with Typer-style commands and an Ink guided mode.",
    },
    subCommands: {
      preview: defineCommand({
        meta: { name: "preview", description: "Preview cleanup targets without deleting." },
        args: cleanfArgs(true),
        async run({ args }) {
          await runAction(inputFromArgs(args as CleanfCliOptions, true), Boolean(args.json), host)
        },
      }),
      run: defineCommand({
        meta: { name: "run", description: "Execute cleanup." },
        args: cleanfArgs(false),
        async run({ args }) {
          await runAction(inputFromArgs(args as CleanfCliOptions, Boolean(args.preview)), Boolean(args.json), host)
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

function cleanfArgs(previewDefault: boolean) {
  return {
    paths: { type: "string", description: "Paths separated by semicolon or new lines." },
    presets: { type: "string", default: getDefaultPresets().join(","), description: "Comma-separated presets." },
    exclude: { type: "string", description: "Comma-separated exclude keywords." },
    preview: { type: "boolean", default: previewDefault, description: "Preview mode." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: CleanfCliOptions, preview: boolean): CleanfInput {
  return {
    paths: parseCleanfPaths((args.paths ?? "").split(";")),
    presets: (args.presets ?? getDefaultPresets().join(",")).split(",").map((item) => item.trim()).filter(Boolean) as CleanfPresetId[],
    exclude: args.exclude,
    preview,
  }
}

async function runAction(input: CleanfInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runCleanf(input, createNodeCleanfRuntime(), json ? undefined : (event) => {
    if (event.type === "progress") writeCliEvent(host, event, { label: CLI_NAME })
    else writeLine(host, event.message)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  if (input.preview && result.data?.previewFiles.length) {
    writeLine(host, result.data.previewFiles.join("\n"))
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `preview --help` for scripted use.")
    process.exitCode = 2
    return
  }

  await runInkApp(h(GuidedCleanfApp, { host }))
}

function GuidedCleanfApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"paths" | "preview" | "running" | "done">("paths")
  const [paths, setPaths] = useState("")
  const [message, setMessage] = useState("Enter path(s), separated by semicolon.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "paths") {
      setPaths(value)
      setStep("preview")
      setMessage("Preview only? yes/no.")
      return
    }

    if (step === "preview") {
      const preview = !["n", "no", "false", "0"].includes(value.toLowerCase())
      setStep("running")
      await execute({ paths: parseCleanfPaths(paths.split(";")), presets: getDefaultPresets(), preview })
    }
  }

  async function execute(input: CleanfInput) {
    setMessage("Running...")
    const result = await runCleanf(input, createNodeCleanfRuntime(), (event) => {
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
    { flexDirection: "column", gap: 1 },
    h(
      Box,
      { borderStyle: "round", borderColor: "cyan", flexDirection: "column", paddingX: 1, width: 76 },
      h(Text, { color: "cyan", bold: true }, "Xiranite Cleanf"),
      h(Text, null, h(Text, { color: "cyan" }, "Entry   "), "Ink guided flow for safe cleanup planning"),
      h(Text, null, h(Text, { color: "cyan" }, "Presets "), "empty_folders, backup_files, temp_folders"),
      h(Text, null, "        trash_files, hb_txt_files"),
      h(Text, null, h(Text, { color: "cyan" }, "Script  "), `${CLI_NAME} preview --paths <folder> --json`),
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
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1))
      return
    }
    if (!key.ctrl && input) {
      setValue((current) => current + input)
    }
  })
  return h(Text, null, h(Text, { color: "cyan" }, "> "), value, h(Text, { inverse: true }, " "))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
