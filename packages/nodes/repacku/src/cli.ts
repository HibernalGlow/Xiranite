#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/contract"
import type { RepackuAction, RepackuInput, RepackuOperation } from "./core.js"
import { runRepacku } from "./core.js"
import { createNodeRepackuRuntime } from "./platform.js"

interface RepackuCliOptions {
  path?: string
  paths?: string
  config?: string
  configPath?: string
  types?: string
  output?: string
  outputPath?: string
  deleteAfter?: boolean
  dryRun?: boolean
  minCount?: string | number
  galleryMarker?: string
  json?: boolean
}

export const cli: CliCommand = {
  name: "xiranite-repacku",
  description: "Analyze folder trees and repack folders into zip archives.",
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
    meta: { name: "xiranite-repacku", description: "Folder repacking workflow with guided terminal mode." },
    subCommands: {
      analyze: defineCommand({
        meta: { name: "analyze", description: "Analyze a folder and write a repacku config JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "analyze", ...inputFromArgs(args as RepackuCliOptions) }, Boolean(args.json), host)
        },
      }),
      compress: defineCommand({
        meta: { name: "compress", description: "Compress from an existing config, or analyze a folder first if --path is provided." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "compress", ...inputFromArgs(args as RepackuCliOptions) }, Boolean(args.json), host)
        },
      }),
      full: defineCommand({
        meta: { name: "full", description: "Analyze and then compress in one flow." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "full", ...inputFromArgs(args as RepackuCliOptions) }, Boolean(args.json), host)
        },
      }),
      "single-pack": defineCommand({
        meta: { name: "single-pack", description: "Pack first-level child folders and loose image files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "single-pack", ...inputFromArgs(args as RepackuCliOptions) }, Boolean(args.json), host)
        },
      }),
      "gallery-pack": defineCommand({
        meta: { name: "gallery-pack", description: "Find gallery folders and run single-pack in each one." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "gallery-pack", ...inputFromArgs(args as RepackuCliOptions) }, Boolean(args.json), host)
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
    paths: { type: "string", description: "Comma, semicolon, or newline separated folder paths." },
    config: { type: "string", description: "Config JSON path." },
    configPath: { type: "string", description: "Config JSON path." },
    types: { type: "string", description: "Target file types, comma separated, for example image,document." },
    output: { type: "string", description: "Config output path." },
    outputPath: { type: "string", description: "Config output path." },
    deleteAfter: { type: "boolean", description: "Delete source files after successful compression." },
    dryRun: { type: "boolean", description: "Plan operations without writing archives." },
    minCount: { type: "string", description: "Minimum matching direct files before compression." },
    galleryMarker: { type: "string", description: "Folder name marker used by gallery-pack." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: RepackuCliOptions): RepackuInput {
  return {
    paths: splitPaths(args.paths, args.path ? [args.path] : []),
    configPath: args.configPath || args.config,
    types: args.types,
    outputPath: args.outputPath || args.output,
    deleteAfter: args.deleteAfter,
    dryRun: args.dryRun,
    minCount: numberArg(args.minCount),
    galleryMarker: args.galleryMarker,
  }
}

async function runAction(input: RepackuInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runRepacku(input, createNodeRepackuRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  const data = result.data
  if (data) {
    if (data.configPath) writeLine(host, `config=${data.configPath}`)
    writeLine(host, `folders=${data.totalFolders} entire=${data.entireCount} selective=${data.selectiveCount} skip=${data.skipCount}`)
    writeLine(host, `operations=${data.totalOperations} planned=${data.plannedCount} compressed=${data.compressedCount} failed=${data.failedCount} skipped=${data.skippedCount}`)
    for (const operation of data.operations.slice(0, 80)) writeLine(host, formatOperation(operation))
    for (const error of data.errors) writeLine(host, `error: ${error}`)
  }
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `analyze --path . --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedRepackuApp, { host }))
}

function GuidedRepackuApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "path" | "types" | "delete" | "running" | "done">("action")
  const [action, setAction] = useState<RepackuAction>("full")
  const [pathValue, setPathValue] = useState("")
  const [types, setTypes] = useState("")
  const [message, setMessage] = useState("Action: full, analyze, compress, single-pack, gallery-pack.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const next = normalizeAction(value)
      setAction(next)
      setMessage(next === "compress" ? "Config JSON path, or folder path." : "Folder path.")
      setStep("path")
      return
    }
    if (step === "path") {
      setPathValue(value)
      if (action === "single-pack" || action === "gallery-pack") {
        setMessage("Delete after success? yes/no.")
        setStep("delete")
      } else {
        setMessage("Target types, comma-separated. Leave empty for all files.")
        setStep("types")
      }
      return
    }
    if (step === "types") {
      setTypes(value)
      setMessage("Delete after success? yes/no.")
      setStep("delete")
      return
    }
    await execute(!/^n(o)?$/i.test(value))
  }

  async function execute(deleteAfter: boolean) {
    setStep("running")
    setMessage("Running...")
    const looksLikeConfig = action === "compress" && /\.json$/i.test(pathValue)
    const result = await runRepacku({
      action,
      path: looksLikeConfig ? undefined : pathValue,
      configPath: looksLikeConfig ? pathValue : undefined,
      types,
      deleteAfter,
    }, createNodeRepackuRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "repacku guided"),
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

function normalizeAction(value: string): RepackuAction {
  const action = value.trim().toLowerCase()
  if (action === "analyze") return "analyze"
  if (action === "compress") return "compress"
  if (action === "single" || action === "single-pack" || action === "single_pack") return "single-pack"
  if (action === "gallery" || action === "gallery-pack" || action === "gallery_pack") return "gallery-pack"
  return "full"
}

function splitPaths(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: number | string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatOperation(operation: RepackuOperation): string {
  const extensions = operation.extensions.length ? ` [${operation.extensions.join(",")}]` : ""
  return `${operation.status} ${operation.mode}${extensions} ${operation.sourcePath} -> ${operation.targetPath}`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
