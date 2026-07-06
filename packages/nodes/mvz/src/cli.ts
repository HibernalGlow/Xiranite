#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { MvzAction, MvzInput } from "./core.js"
import { parseMvzEntries, runMvz } from "./core.js"
import { createNodeMvzRuntime } from "./platform.js"

interface MvzCliOptions {
  entry?: string
  entries?: string
  file?: string
  output?: string
  pattern?: string
  replacement?: string
  separator?: string
  near?: boolean
  autoDir?: boolean
  flatten?: boolean
  dryRun?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: "xiranite-mvz",
  description: "Delete, extract, move, or rename archive-internal files from archive//path lines.",
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
    meta: { name: "xiranite-mvz", description: "7-Zip archive member workflow with guided terminal mode." },
    subCommands: {
      extract: defineCommand({
        meta: { name: "extract", description: "Extract matching archive-internal files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("extract", await inputFromArgs(args as MvzCliOptions), Boolean(args.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Extract matching files, then delete them from archives." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("move", await inputFromArgs(args as MvzCliOptions), Boolean(args.json), host)
        },
      }),
      delete: defineCommand({
        meta: { name: "delete", description: "Delete matching archive-internal files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("delete", await inputFromArgs(args as MvzCliOptions), Boolean(args.json), host)
        },
      }),
      rename: defineCommand({
        meta: { name: "rename", description: "Rename matching archive-internal files with a regex replacement." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("rename", await inputFromArgs(args as MvzCliOptions), Boolean(args.json), host)
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
    entry: { type: "string", description: "Single archive//internal entry." },
    entries: { type: "string", description: "Newline, comma, or semicolon separated archive//internal entries." },
    file: { type: "string", description: "Text file containing archive//internal entries." },
    output: { type: "string", description: "Output directory for extract or move." },
    pattern: { type: "string", description: "Regex pattern for rename." },
    replacement: { type: "string", description: "Replacement text for rename." },
    separator: { type: "string", description: "Archive/internal separator, default //." },
    near: { type: "boolean", description: "Extract next to each archive." },
    autoDir: { type: "boolean", description: "Append archive stem as output folder." },
    flatten: { type: "boolean", description: "Use 7z e instead of 7z x." },
    dryRun: { type: "boolean", description: "Plan commands without executing 7-Zip." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function inputFromArgs(args: MvzCliOptions): Promise<MvzInput> {
  const fileText = args.file ? await readFile(args.file, "utf8") : undefined
  return {
    fileText,
    files: splitArg(args.entries, args.entry ? [args.entry] : []),
    output: args.output,
    pattern: args.pattern,
    replacement: args.replacement,
    separator: args.separator,
    near: args.near,
    autoDir: args.autoDir,
    flatten: args.flatten,
    dryRun: args.dryRun,
  }
}

async function runAction(action: MvzAction, input: MvzInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runMvz({ ...input, action }, createNodeMvzRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  writeLine(host, `archives=${result.data?.totalArchives ?? 0} files=${result.data?.totalFiles ?? 0} success=${result.data?.successCount ?? 0} failed=${result.data?.failedCount ?? 0}`)
  for (const item of result.data?.preview.slice(0, 50) ?? []) writeLine(host, `plan ${item.action} ${item.count} / ${item.command}`)
  for (const item of result.data?.results.slice(0, 50) ?? []) writeLine(host, `${item.success ? "ok" : "fail"} ${item.action} ${item.archive} / ${item.message}`)
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `extract --entry archive.zip//file.txt --dryRun --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedMvzApp, { host }))
}

function GuidedMvzApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "entries" | "output" | "pattern" | "dry" | "running" | "done">("action")
  const [action, setAction] = useState<MvzAction>("extract")
  const [entries, setEntries] = useState("")
  const [output, setOutput] = useState("")
  const [pattern, setPattern] = useState("")
  const [message, setMessage] = useState("Action: extract, move, delete, rename.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const nextAction = normalizeAction(value)
      setAction(nextAction)
      setMessage("Entry list: archive.zip//path.txt.")
      setStep("entries")
      return
    }
    if (step === "entries") {
      setEntries(value)
      if (action === "rename") {
        setMessage("Rename regex pattern.")
        setStep("pattern")
      } else if (action === "extract" || action === "move") {
        setMessage("Output directory, blank means near archive.")
        setStep("output")
      } else {
        setMessage("Dry-run? yes/no.")
        setStep("dry")
      }
      return
    }
    if (step === "pattern") {
      setPattern(value)
      setMessage("Dry-run? yes/no.")
      setStep("dry")
      return
    }
    if (step === "output") {
      setOutput(value)
      setMessage("Dry-run? yes/no.")
      setStep("dry")
      return
    }
    await execute(!/^n(o)?$/i.test(value))
  }

  async function execute(dryRun: boolean) {
    setStep("running")
    setMessage("Running...")
    const result = await runMvz({
      action,
      fileText: entries,
      output: output || undefined,
      near: !output,
      autoDir: true,
      pattern,
      replacement: "",
      dryRun,
    }, createNodeMvzRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "mvz guided"),
    h(Text, null, message),
    step !== "done" && step !== "running" ? h(InputLine, { onSubmit: submit }) : null,
    h(Text, { color: "gray" }, `${parseMvzEntries(entries).length} entr${parseMvzEntries(entries).length === 1 ? "y" : "ies"}`),
    ...lines.map((line, index) => h(Text, { key: `${index}:${line}`, color: "gray" }, line)),
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

function normalizeAction(value: string): MvzAction {
  const action = value.trim().toLowerCase()
  if (action === "delete" || action === "del") return "delete"
  if (action === "move" || action === "mv") return "move"
  if (action === "rename" || action === "rn") return "rename"
  return "extract"
}

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
