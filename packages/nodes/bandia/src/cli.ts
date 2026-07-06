#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { BandiaAction, BandiaArchiveFormat, BandiaExtractMode, BandiaInput, BandiaOverwriteMode } from "./core.js"
import { parsePathMappings, runBandia } from "./core.js"
import { createNodeBandiaRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("bandia")

interface BandiaCliOptions {
  path?: string
  paths?: string
  mappings?: string
  mappingFile?: string
  outputDir?: string
  outputPath?: string
  deleteAfter?: boolean
  useTrash?: boolean
  parallel?: boolean
  workers?: number | string
  extractMode?: BandiaExtractMode
  mode?: BandiaExtractMode
  outputPrefix?: string
  prefix?: string
  overwriteMode?: BandiaOverwriteMode
  overwrite?: BandiaOverwriteMode
  format?: BandiaArchiveFormat
  compressFormat?: BandiaArchiveFormat
  deleteSource?: boolean
  open?: boolean
  dryRun?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Batch extract, compress, repack, and export archive paths with Bandizip.",
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
    meta: { name: CLI_NAME, description: "Bandizip batch archive workflow with guided terminal mode." },
    subCommands: {
      extract: defineCommand({
        meta: { name: "extract", description: "Extract archive paths." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("extract", await inputFromArgs("extract", args as unknown as BandiaCliOptions), Boolean(args.json), host)
        },
      }),
      compress: defineCommand({
        meta: { name: "compress", description: "Compress source paths to archives." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("compress", await inputFromArgs("compress", args as unknown as BandiaCliOptions), Boolean(args.json), host)
        },
      }),
      repack: defineCommand({
        meta: { name: "repack", description: "Compress extracted folders back through archive mappings." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("repack", await inputFromArgs("repack", args as unknown as BandiaCliOptions), Boolean(args.json), host)
        },
      }),
      "export-efu": defineCommand({
        meta: { name: "export-efu", description: "Export archive or extracted paths to Everything EFU." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("export_efu", await inputFromArgs("export_efu", args as unknown as BandiaCliOptions), Boolean(args.json), host)
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
    path: { type: "string", description: "Single path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated paths." },
    mappings: { type: "string", description: "Mapping JSON or archive=>folder lines." },
    mappingFile: { type: "string", description: "Mapping JSON file." },
    outputDir: { type: "string", description: "Archive output directory for compress." },
    outputPath: { type: "string", description: "EFU output path." },
    deleteAfter: { type: "boolean", description: "Delete archive after successful extract." },
    useTrash: { type: "boolean", description: "Use recycle bin when deleting archives." },
    parallel: { type: "boolean", description: "Extract archives concurrently." },
    workers: { type: "string", description: "Parallel worker count." },
    extractMode: { type: "string", description: "auto or normal." },
    mode: { type: "string", description: "Alias for --extractMode." },
    outputPrefix: { type: "string", description: "Normal extract output folder prefix." },
    prefix: { type: "string", description: "Alias for --outputPrefix." },
    overwriteMode: { type: "string", description: "overwrite, skip, or rename." },
    overwrite: { type: "string", description: "Alias for --overwriteMode." },
    format: { type: "string", description: "zip or 7z." },
    compressFormat: { type: "string", description: "zip or 7z." },
    deleteSource: { type: "boolean", description: "Delete source after successful compression." },
    open: { type: "boolean", description: "Open EFU in Everything." },
    dryRun: { type: "boolean", description: "Plan commands without executing Bandizip." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function inputFromArgs(action: BandiaAction, args: BandiaCliOptions): Promise<BandiaInput> {
  const mappingText = args.mappingFile ? await readFile(args.mappingFile, "utf8") : args.mappings
  return {
    action,
    paths: splitArg(args.paths, args.path ? [args.path] : []),
    mappings: mappingText ? parsePathMappings(mappingText) : undefined,
    mappingText,
    deleteAfter: args.deleteAfter,
    useTrash: args.useTrash,
    parallel: args.parallel,
    workers: numberArg(args.workers),
    extractMode: args.extractMode || args.mode,
    outputPrefix: args.outputPrefix || args.prefix,
    overwriteMode: args.overwriteMode || args.overwrite,
    outputDir: args.outputDir,
    compressFormat: args.compressFormat || args.format,
    deleteSource: args.deleteSource,
    efuOutputPath: args.outputPath,
    openInEverything: args.open,
    dryRun: args.dryRun,
  }
}

async function runAction(action: BandiaAction, input: BandiaInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runBandia({ ...input, action }, createNodeBandiaRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  writeLine(host, `extracted=${result.data?.extractedCount ?? 0} compressed=${result.data?.compressedCount ?? 0} failed=${result.data?.failedCount ?? 0} exported=${result.data?.exportedCount ?? 0}`)
  for (const item of result.data?.results.slice(0, 50) ?? []) {
    writeLine(host, `${item.success ? "ok" : "fail"} ${item.sourcePath}${item.outputPath ? ` -> ${item.outputPath}` : ""}${item.error ? ` / ${item.error}` : ""}`)
  }
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `extract --path file.zip --dryRun --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedBandiaApp, { host }))
}

function GuidedBandiaApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "path" | "dry" | "running" | "done">("action")
  const [action, setAction] = useState<BandiaAction>("extract")
  const [path, setPath] = useState("")
  const [message, setMessage] = useState("Action: extract, compress, repack, export.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      setAction(normalizeAction(value))
      setMessage("Path, paths, or mapping JSON.")
      setStep("path")
      return
    }
    if (step === "path") {
      setPath(value)
      setMessage("Dry-run? yes/no.")
      setStep("dry")
      return
    }
    await execute(!/^n(o)?$/i.test(value))
  }

  async function execute(dryRun: boolean) {
    setStep("running")
    setMessage("Running...")
    const result = await runBandia({ action, paths: [path], mappingText: path, dryRun }, createNodeBandiaRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "bandia guided"),
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

function normalizeAction(value: string): BandiaAction {
  const action = value.trim().toLowerCase()
  if (action === "compress") return "compress"
  if (action === "repack") return "repack"
  if (action === "export" || action === "efu" || action === "export_efu" || action === "export-efu") return "export_efu"
  return "extract"
}

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: number | string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
