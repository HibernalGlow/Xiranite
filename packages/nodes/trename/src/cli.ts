#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeCliEvent, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { TrenameAction, TrenameInput } from "./core.js"
import { runTrename } from "./core.js"
import { createNodeTrenameRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("trename")

interface TrenameCliOptions {
  path?: string
  paths?: string
  input?: string
  inputFile?: string
  output?: string
  base?: string
  basePath?: string
  includeHidden?: boolean
  hidden?: boolean
  includeRoot?: boolean
  noRoot?: boolean
  exclude?: string
  excludeExts?: string
  excludePattern?: string
  excludePatterns?: string
  split?: string | number
  maxLines?: string | number
  compact?: boolean
  mode?: "normal" | "leak"
  dryRun?: boolean
  execute?: boolean
  batchId?: string
  undoPath?: string
  jsonContent?: string
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Batch rename JSON workflow for scan, validate, rename, and undo.",
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
  return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "Batch rename JSON workflow with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan folders into rename JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("scan", args as TrenameCliOptions, Boolean(args.json), host)
        },
      }),
      import: defineCommand({
        meta: { name: "import", description: "Import and count rename JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("import", args as TrenameCliOptions, Boolean(args.json), host)
        },
      }),
      validate: defineCommand({
        meta: { name: "validate", description: "Validate rename JSON against the filesystem." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("validate", args as TrenameCliOptions, Boolean(args.json), host)
        },
      }),
      rename: defineCommand({
        meta: { name: "rename", description: "Plan or execute batch rename." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("rename", args as TrenameCliOptions, Boolean(args.json), host)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo a previous executed rename batch." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("undo", args as TrenameCliOptions, Boolean(args.json), host)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "List undo batches." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("history", args as TrenameCliOptions, Boolean(args.json), host)
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Open the guided terminal workflow." },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

function commonArgs() {
  return {
    path: { type: "string", description: "Folder path." },
    paths: { type: "string", description: "One or more paths. Quoted paths are supported." },
    input: { type: "string", description: "JSON input file." },
    inputFile: { type: "string", description: "JSON input file." },
    output: { type: "string", description: "Write scan JSON to this file." },
    base: { type: "string", description: "Base path for validate/rename." },
    basePath: { type: "string", description: "Base path for validate/rename." },
    includeHidden: { type: "boolean", description: "Include hidden files." },
    hidden: { type: "boolean", description: "Alias for --includeHidden." },
    includeRoot: { type: "boolean", description: "Include scanned folder as root node." },
    noRoot: { type: "boolean", description: "Scan children directly." },
    exclude: { type: "string", description: "Comma-separated excluded extensions." },
    excludeExts: { type: "string", description: "Comma-separated excluded extensions." },
    excludePattern: { type: "string", description: "Comma-separated excluded name patterns." },
    excludePatterns: { type: "string", description: "Comma-separated excluded name patterns." },
    split: { type: "string", description: "Max JSON lines per segment." },
    maxLines: { type: "string", description: "Max JSON lines per segment." },
    compact: { type: "boolean", description: "Use compact JSON output." },
    mode: { type: "string", description: "Scan mode: normal or leak." },
    dryRun: { type: "boolean", description: "Preview file operations." },
    execute: { type: "boolean", description: "Execute rename instead of dry-run." },
    batchId: { type: "string", description: "Undo batch id." },
    undoPath: { type: "string", description: "Undo JSON store path." },
    jsonContent: { type: "string", description: "Inline rename JSON content." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function runAction(action: TrenameAction, args: TrenameCliOptions, json: boolean, host: CliHost): Promise<void> {
  const input = await inputFromArgs(action, args)
  const result = await runTrename(input, createNodeTrenameRuntime(), (event) => {
    if (!json) writeCliEvent(host, event, { label: CLI_NAME })
  })

  if (args.output && action === "scan" && result.success) await writeSegments(args.output, result.data?.segments ?? [])

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  const data = result.data
  if (data) {
    writeLine(host, `total=${data.totalItems} pending=${data.pendingCount} ready=${data.readyCount} success=${data.successCount} failed=${data.failedCount} skipped=${data.skippedCount}`)
    if (data.basePath) writeLine(host, `base=${data.basePath}`)
    if (data.operationId) writeLine(host, `operation=${data.operationId}`)
    for (const segment of data.segments.slice(0, 1)) writeLine(host, segment)
    for (const operation of data.operations.slice(0, 30)) writeLine(host, `${operation.originalPath} -> ${operation.newPath}`)
    for (const conflict of data.conflicts.slice(0, 30)) writeLine(host, `${conflict.type}: ${conflict.message}`)
    for (const batch of data.history.slice(0, 20)) writeLine(host, `${batch.id}\t${batch.undone ? "undone" : "active"}\t${batch.operations.length}\t${batch.timestamp}`)
  }
  if (!result.success) process.exitCode = 1
}

async function inputFromArgs(action: TrenameAction, args: TrenameCliOptions): Promise<TrenameInput> {
  const inputFile = args.inputFile || args.input
  const jsonContent = args.jsonContent ?? (inputFile ? await readFile(inputFile, "utf8") : "")
  return {
    action,
    paths: args.paths || args.path,
    includeHidden: args.includeHidden ?? args.hidden,
    includeRoot: args.noRoot ? false : args.includeRoot,
    excludeExts: args.excludeExts || args.exclude,
    excludePatterns: args.excludePatterns || args.excludePattern,
    maxLines: numberArg(args.maxLines ?? args.split),
    compact: args.compact,
    mode: args.mode === "leak" ? "leak" : "normal",
    jsonContent,
    basePath: args.basePath || args.base,
    dryRun: args.execute ? false : args.dryRun ?? true,
    batchId: args.batchId,
    undoPath: args.undoPath,
  }
}

async function writeSegments(output: string, segments: string[]): Promise<void> {
  if (segments.length <= 1) {
    await writeFile(output, `${segments[0] ?? ""}\n`, "utf8")
    return
  }
  const dot = output.lastIndexOf(".")
  const base = dot >= 0 ? output.slice(0, dot) : output
  const ext = dot >= 0 ? output.slice(dot) : ".json"
  await Promise.all(segments.map((segment, index) => writeFile(`${base}_${index + 1}${ext}`, `${segment}\n`, "utf8")))
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `scan --path ... --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedTrenameApp, { host }))
}

function GuidedTrenameApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "path" | "json" | "running" | "done">("action")
  const [action, setAction] = useState<TrenameAction>("scan")
  const [path, setPath] = useState("")
  const [message, setMessage] = useState("Action: scan, validate, rename, undo, history.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const next = normalizeAction(value)
      setAction(next)
      setMessage(next === "scan" ? "Folder path." : next === "undo" ? "Batch id (blank for latest)." : "JSON file path.")
      setStep(next === "scan" || next === "undo" || next === "history" ? "path" : "json")
      return
    }
    if (step === "path" || step === "json") await execute(value)
  }

  async function execute(value: string) {
    setStep("running")
    setMessage("Running...")
    const input: TrenameInput = action === "scan"
      ? { action, path: value || path }
      : action === "undo"
        ? { action, batchId: value || undefined }
        : action === "history"
          ? { action }
          : { action, jsonContent: await readFile(value, "utf8"), dryRun: true }
    const result = await runTrename(input, createNodeTrenameRuntime(), (event) => setLines((current) => [...current.slice(-8), event.message]))
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
    h(Text, { color: "cyan", bold: true }, "trename guided"),
    h(Text, null, message),
    step !== "done" && step !== "running" ? h(InputLine, { onSubmit: submit }) : null,
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

function normalizeAction(value: string): TrenameAction {
  const action = value.trim().toLowerCase()
  if (action === "import") return "import"
  if (action === "validate") return "validate"
  if (action === "rename") return "rename"
  if (action === "undo") return "undo"
  if (action === "history") return "history"
  return "scan"
}

function numberArg(value?: string | number): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
