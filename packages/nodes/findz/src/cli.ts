#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeCliEvent, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { FindzAction, FindzInput, FindzOutputFormat } from "./core.js"
import { runFindz } from "./core.js"
import { createNodeFindzRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("findz")

interface FindzCliOptions {
  where?: string
  path?: string
  paths?: string
  noArchive?: boolean
  followSymlinks?: boolean
  imageMeta?: boolean
  maxResults?: string
  maxReturn?: string
  groupBy?: string
  refine?: string
  sortBy?: "name" | "count" | "totalSize" | "avgSize"
  asc?: boolean
  output?: string
  csv?: boolean
  efu?: boolean
  json?: boolean
  long?: boolean
  print0?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Search files and archive members with SQL-like filters.",
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
    meta: { name: CLI_NAME, description: "SQL-like file and archive search with guided terminal mode." },
    subCommands: {
      search: defineCommand({
        meta: { name: "search", description: "Search files and optional archive members." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("search", inputFromArgs(args as FindzCliOptions), host)
        },
      }),
      "archives-only": defineCommand({
        meta: { name: "archives-only", description: "Return archive files themselves, without entering them." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("archives_only", inputFromArgs(args as FindzCliOptions), host)
        },
      }),
      nested: defineCommand({
        meta: { name: "nested", description: "Find archives containing nested archive files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("nested", inputFromArgs(args as FindzCliOptions), host)
        },
      }),
      refine: defineCommand({
        meta: { name: "refine", description: "Search, group, and apply a secondary group filter." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("search", { ...inputFromArgs(args as FindzCliOptions), groupBy: (args as FindzCliOptions).groupBy || "archive" }, host)
        },
      }),
      "help-filter": defineCommand({
        meta: { name: "help-filter", description: "Print filter syntax help." },
        async run() {
          await runAction("help", { action: "help" }, host)
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
    where: { type: "string", description: "SQL-like filter, default 1." },
    path: { type: "string", description: "Single file or folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated paths." },
    noArchive: { type: "boolean", description: "Do not search inside archives." },
    followSymlinks: { type: "boolean", description: "Follow symbolic links." },
    imageMeta: { type: "boolean", description: "Read image dimensions for filesystem image files." },
    maxResults: { type: "string", description: "Stop after this many matches, 0 means unlimited." },
    maxReturn: { type: "string", description: "Return this many items in JSON/data, 0 means all." },
    groupBy: { type: "string", description: "Group by archive, ext, or dir." },
    refine: { type: "string", description: "Secondary group filter, e.g. count > 10." },
    sortBy: { type: "string", description: "Group sort: name, count, totalSize, avgSize." },
    asc: { type: "boolean", description: "Sort groups ascending." },
    output: { type: "string", description: "Save output to file." },
    csv: { type: "boolean", description: "Print CSV." },
    efu: { type: "boolean", description: "Print Everything EFU file list." },
    json: { type: "boolean", description: "Print JSON result." },
    long: { type: "boolean", description: "Print long text rows." },
    print0: { type: "boolean", description: "Use NUL separators for text output." },
  } as const
}

function inputFromArgs(args: FindzCliOptions): FindzInput {
  return {
    where: args.where || "1",
    paths: splitArg(args.paths, args.path ? [args.path] : []),
    noArchive: args.noArchive,
    followSymlinks: args.followSymlinks,
    withImageMeta: args.imageMeta,
    maxResults: numberArg(args.maxResults),
    maxReturnFiles: numberArg(args.maxReturn),
    groupBy: args.groupBy,
    refine: args.refine,
    sortBy: args.sortBy,
    sortDesc: !args.asc,
    outputPath: args.output,
    outputFormat: outputFormat(args),
    longFormat: args.long ?? true,
    printZero: args.print0,
  }
}

async function runAction(action: FindzAction, input: FindzInput, host: CliHost): Promise<void> {
  const result = await runFindz({ ...input, action }, createNodeFindzRuntime(), (event) => {
    if (!input.outputFormat || input.outputFormat === "text") writeCliEvent(host, event, { label: CLI_NAME })
  })

  if (input.outputFormat === "json") {
    writeJson(host, result)
  } else {
    if (result.data?.outputText) host.stdout.write(result.data.outputText + (input.printZero ? "" : "\n"))
    else writeLine(host, result.message)
  }

  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `search --where \"ext = \\\"jpg\\\"\" --path . --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedFindzApp, { host }))
}

function GuidedFindzApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"path" | "where" | "archive" | "running" | "done">("path")
  const [path, setPath] = useState(".")
  const [where, setWhere] = useState("1")
  const [message, setMessage] = useState("Search path.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "path") {
      setPath(value || ".")
      setMessage("WHERE filter, blank means 1.")
      setStep("where")
      return
    }
    if (step === "where") {
      setWhere(value || "1")
      setMessage("Search inside archives? yes/no.")
      setStep("archive")
      return
    }
    await execute(!/^n(o)?$/i.test(value))
  }

  async function execute(searchArchives: boolean) {
    setStep("running")
    setMessage("Running...")
    const result = await runFindz({ action: "search", path, where, noArchive: !searchArchives, maxReturnFiles: 40 }, createNodeFindzRuntime(), (event) => {
      setLines((current) => [...current.slice(-8), event.message])
    })
    setLines((current) => [...current.slice(-8), result.message])
    if (result.data?.outputText) writeLine(host, result.data.outputText)
    setMessage("Completed. Press q to exit.")
    setStep("done")
  }

  useInput((input) => {
    if (step === "done" && (input === "q" || input === "\u0003")) app.exit()
  })

  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { color: "cyan", bold: true }, "findz guided"),
    h(Text, null, message),
    step !== "done" && step !== "running" ? h(InputLine, { onSubmit: submit }) : null,
    h(Text, { color: "gray" }, `${path} / ${where}`),
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

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: string): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function outputFormat(args: FindzCliOptions): FindzOutputFormat {
  if (args.json) return "json"
  if (args.csv) return "csv"
  if (args.efu) return "efu"
  return "text"
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
