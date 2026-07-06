#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { EngineVAction, EngineVExportFormat, EngineVInput, EngineVSortField, EngineVSortOrder } from "./core.js"
import { runEngineV } from "./core.js"
import { createNodeEngineVRuntime } from "./platform.js"

interface EngineVCliOptions {
  path?: string
  wallpapersFile?: string
  title?: string
  contentRating?: string
  rating?: string
  type?: string
  tags?: string
  ids?: string
  template?: string
  descMaxLength?: string | number
  nameMaxLength?: string | number
  dryRun?: boolean
  execute?: boolean
  permanent?: boolean
  copyMode?: boolean
  targetPath?: string
  output?: string
  exportPath?: string
  format?: EngineVExportFormat
  exportFormat?: EngineVExportFormat
  sortField?: EngineVSortField
  sortOrder?: EngineVSortOrder
  json?: boolean
}

export const cli: CliCommand = {
  name: "xiranite-enginev",
  description: "Wallpaper Engine workshop scanner and batch folder manager.",
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
    meta: { name: "xiranite-enginev", description: "Wallpaper Engine workshop workflow with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan a Wallpaper Engine workshop folder." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("scan", args as EngineVCliOptions, Boolean(args.json), host)
        },
      }),
      filter: defineCommand({
        meta: { name: "filter", description: "Filter scanned or freshly scanned wallpapers." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("filter", args as EngineVCliOptions, Boolean(args.json), host)
        },
      }),
      rename: defineCommand({
        meta: { name: "rename", description: "Plan or execute batch folder rename/copy." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("rename", args as EngineVCliOptions, Boolean(args.json), host)
        },
      }),
      delete: defineCommand({
        meta: { name: "delete", description: "Plan or execute wallpaper folder deletion." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("delete", args as EngineVCliOptions, Boolean(args.json), host)
        },
      }),
      export: defineCommand({
        meta: { name: "export", description: "Export filtered wallpapers as JSON or paths." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("export", args as EngineVCliOptions, Boolean(args.json), host)
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
    path: { type: "string", description: "Workshop folder path." },
    wallpapersFile: { type: "string", description: "JSON file containing wallpapers from a previous scan." },
    title: { type: "string", description: "Title filter." },
    contentRating: { type: "string", description: "Content rating filter." },
    rating: { type: "string", description: "Alias for --contentRating." },
    type: { type: "string", description: "Wallpaper type filter." },
    tags: { type: "string", description: "Comma-separated tag filter." },
    ids: { type: "string", description: "Comma-separated workshop ids." },
    template: { type: "string", description: "Rename template." },
    descMaxLength: { type: "string", description: "Description placeholder max length." },
    nameMaxLength: { type: "string", description: "Final folder name max length." },
    dryRun: { type: "boolean", description: "Preview file operations." },
    execute: { type: "boolean", description: "Execute rename/delete instead of dry-run." },
    permanent: { type: "boolean", description: "Delete permanently instead of trash." },
    copyMode: { type: "boolean", description: "Copy folders to --targetPath instead of renaming in place." },
    targetPath: { type: "string", description: "Target folder for copy mode." },
    output: { type: "string", description: "Export output path." },
    exportPath: { type: "string", description: "Export output path." },
    format: { type: "string", description: "Export format: json or paths." },
    exportFormat: { type: "string", description: "Export format: json or paths." },
    sortField: { type: "string", description: "Sort field." },
    sortOrder: { type: "string", description: "asc or desc." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function runAction(action: EngineVAction, args: EngineVCliOptions, json: boolean, host: CliHost): Promise<void> {
  const input = await inputFromArgs(action, args)
  const result = await runEngineV(input, createNodeEngineVRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })
  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  const data = result.data
  if (data) {
    writeLine(host, `total=${data.totalCount} filtered=${data.filteredCount} success=${data.successCount} failed=${data.failedCount}`)
    for (const wallpaper of data.filteredWallpapers.slice(0, 30)) writeLine(host, `${wallpaper.workshopId}\t${wallpaper.wallpaperType}\t${wallpaper.contentRating}\t${wallpaper.title}`)
    for (const item of data.renameResults.slice(0, 50)) writeLine(host, `${item.status} ${item.oldPath} -> ${item.newPath}${item.error ? ` / ${item.error}` : ""}`)
    for (const item of data.deleteResults.slice(0, 50)) writeLine(host, `${item.status} ${item.path} / ${item.message}`)
    if (data.exportPath) writeLine(host, `export=${data.exportPath}`)
    for (const error of data.errors) writeLine(host, `error: ${error}`)
  }
  if (!result.success) process.exitCode = 1
}

async function inputFromArgs(action: EngineVAction, args: EngineVCliOptions): Promise<EngineVInput> {
  const wallpapers = args.wallpapersFile ? await readWallpapersFile(args.wallpapersFile) : undefined
  return {
    action,
    path: args.path,
    wallpapers,
    filters: {
      title: args.title,
      contentRating: args.contentRating || args.rating,
      type: args.type,
      tags: args.tags,
    },
    ids: args.ids,
    template: args.template,
    descMaxLength: numberArg(args.descMaxLength),
    nameMaxLength: numberArg(args.nameMaxLength),
    dryRun: args.execute ? false : args.dryRun ?? true,
    permanent: args.permanent,
    copyMode: args.copyMode,
    targetPath: args.targetPath,
    exportPath: args.exportPath || args.output,
    exportFormat: normalizeFormat(args.exportFormat || args.format),
    sortField: args.sortField,
    sortOrder: args.sortOrder,
  }
}

async function readWallpapersFile(file: string): Promise<Array<Record<string, unknown>>> {
  const parsed = JSON.parse(await readFile(file, "utf8")) as unknown
  const wallpapers = Array.isArray(parsed) ? parsed : asRecord(parsed).wallpapers
  if (!Array.isArray(wallpapers)) throw new Error("wallpapersFile must contain an array or an object with a wallpapers array.")
  return wallpapers.map((item) => asRecord(item)).filter((item) => Object.keys(item).length > 0)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `scan --path ... --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedEngineVApp, { host }))
}

function GuidedEngineVApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "path" | "extra" | "running" | "done">("action")
  const [action, setAction] = useState<EngineVAction>("scan")
  const [path, setPath] = useState("")
  const [message, setMessage] = useState("Action: scan, filter, rename, delete, export.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const next = normalizeAction(value)
      setAction(next)
      setMessage("Workshop folder path.")
      setStep("path")
      return
    }
    if (step === "path") {
      setPath(value)
      setMessage(action === "scan" ? "Press enter to run." : "Extra value: title filter, ids, or output path.")
      setStep("extra")
      return
    }
    await execute(value)
  }

  async function execute(extra: string) {
    setStep("running")
    setMessage("Running...")
    const input: EngineVInput = { action, path }
    if (action === "filter") input.filters = { title: extra }
    if (action === "rename" || action === "delete") input.ids = extra
    if (action === "export") input.exportPath = extra || "enginev_export.json"
    const result = await runEngineV(input, createNodeEngineVRuntime(), (event) => setLines((current) => [...current.slice(-8), event.message]))
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
    h(Text, { color: "cyan", bold: true }, "enginev guided"),
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

function normalizeAction(value: string): EngineVAction {
  const action = value.trim().toLowerCase()
  if (action === "filter") return "filter"
  if (action === "rename") return "rename"
  if (action === "delete") return "delete"
  if (action === "export") return "export"
  return "scan"
}

function normalizeFormat(value?: string): EngineVExportFormat {
  return value === "paths" ? "paths" : "json"
}

function numberArg(value?: string | number): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
