#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { MarkuAction, MarkuInput, MarkuModuleId } from "./core.js"
import { MARKU_MODULES, runMarku } from "./core.js"
import { createNodeMarkuRuntime } from "./platform.js"

interface MarkuCliOptions {
  module?: string
  path?: string
  paths?: string
  input?: string
  inputFile?: string
  outputFile?: string
  config?: string
  recursive?: boolean
  dryRun?: boolean
  write?: boolean
  enableUndo?: boolean
  historyPath?: string
  undoId?: string
  json?: boolean
}

export const cli: CliCommand = {
  name: "xiranite-marku",
  description: "Markdown module toolbox with text, file, diff, and undo modes.",
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
    meta: { name: "xiranite-marku", description: "Markdown processing toolbox with guided terminal mode." },
    subCommands: {
      text: defineCommand({
        meta: { name: "text", description: "Process inline text or an input file." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "text", ...await inputFromArgs(args as MarkuCliOptions) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      run: defineCommand({
        meta: { name: "run", description: "Process Markdown files or folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "run", ...await inputFromArgs(args as MarkuCliOptions) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "Show undo history." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "history", ...await inputFromArgs(args as MarkuCliOptions) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo the latest or selected write run." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "undo", ...await inputFromArgs(args as MarkuCliOptions) }, Boolean(args.json), host, args as MarkuCliOptions)
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
    module: { type: "string", description: `Module: ${MARKU_MODULES.map((item) => item.id).join(", ")}` },
    path: { type: "string", description: "Input file or folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated paths." },
    input: { type: "string", description: "Inline Markdown text." },
    inputFile: { type: "string", description: "Read Markdown text from this file." },
    outputFile: { type: "string", description: "Write text-mode output to this file." },
    config: { type: "string", description: "Module config JSON." },
    recursive: { type: "boolean", description: "Recurse into folders." },
    dryRun: { type: "boolean", description: "Preview file changes without writing." },
    write: { type: "boolean", description: "Write file changes. Overrides dry-run." },
    enableUndo: { type: "boolean", description: "Record undo state when writing." },
    historyPath: { type: "string", description: "Undo history JSON path." },
    undoId: { type: "string", description: "Undo record id." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function inputFromArgs(args: MarkuCliOptions): Promise<MarkuInput> {
  const inputText = args.inputFile ? await readFile(args.inputFile, "utf8") : args.input
  return {
    module: isMarkuModule(args.module) ? args.module : "markt",
    paths: splitArg(args.paths, args.path ? [args.path] : []),
    inputText,
    stepConfig: parseConfig(args.config),
    recursive: args.recursive,
    dryRun: args.write ? false : args.dryRun,
    enableUndo: args.enableUndo,
    historyPath: args.historyPath,
    undoId: args.undoId,
  }
}

async function runAction(input: MarkuInput & { action: MarkuAction }, json: boolean, host: CliHost, options: MarkuCliOptions): Promise<void> {
  const result = await runMarku(input, createNodeMarkuRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })
  if (options.outputFile && result.data?.outputText) await writeFile(options.outputFile, result.data.outputText, "utf8")
  if (json) {
    writeJson(host, result)
    return
  }
  writeLine(host, result.message)
  if (result.data?.outputText) writeLine(host, result.data.outputText)
  if (result.data?.diffText) writeLine(host, result.data.diffText)
  for (const item of result.data?.diffs?.slice(0, 20) ?? []) writeLine(host, `${item.changed ? "changed" : "same"} ${item.file}`)
  for (const item of result.data?.history?.slice(0, 20) ?? []) writeLine(host, `${item.id} ${item.module} ${item.files.length}${item.undone ? " undone" : ""}`)
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `text --input '# A' --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedMarkuApp, { host }))
}

function GuidedMarkuApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"module" | "text" | "running" | "done">("module")
  const [module, setModule] = useState<MarkuModuleId>("markt")
  const [message, setMessage] = useState("Module id.")
  const [lines, setLines] = useState<string[]>(MARKU_MODULES.map((item) => item.id).slice(0, 9))

  async function submit(value: string) {
    if (step === "module") {
      setModule(isMarkuModule(value) ? value : "markt")
      setMessage("Markdown text.")
      setLines([])
      setStep("text")
      return
    }
    setStep("running")
    const result = await runMarku({ action: "text", module, inputText: value }, createNodeMarkuRuntime())
    setLines([result.message, ...(result.data?.outputText ? [result.data.outputText] : [])])
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
    h(Text, { color: "cyan", bold: true }, "marku guided"),
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

function parseConfig(value?: string): Record<string, unknown> {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function isMarkuModule(value?: string): value is MarkuModuleId {
  return MARKU_MODULES.some((item) => item.id === value)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
