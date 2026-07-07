#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeCliEvent, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { DissolvefAction, DissolvefConflictMode, DissolvefInput, DissolvefMediaType } from "./core.js"
import { runDissolvef } from "./core.js"
import { createNodeDissolvefRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("dissolvef")

interface DissolvefCliOptions {
  path?: string
  exclude?: string
  nested?: boolean
  media?: boolean
  archive?: boolean
  direct?: boolean
  preview?: boolean
  dryRun?: boolean
  fileConflict?: DissolvefConflictMode
  dirConflict?: DissolvefConflictMode
  similarityThreshold?: string | number
  enableSimilarity?: boolean
  protectFirstLevel?: boolean
  historyPath?: string
  historyLimit?: string | number
  undoId?: string
  mediaTypes?: string
  skipBlacklist?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Dissolve nested, single-media, single-archive, or direct folders.",
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
    meta: { name: CLI_NAME, description: "Folder dissolve utility with guided terminal mode." },
    subCommands: {
      plan: defineCommand({
        meta: { name: "plan", description: "Preview the operations without changing files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "plan", ...inputFromArgs(args as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      dissolve: defineCommand({
        meta: { name: "dissolve", description: "Run the selected dissolve modes." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "dissolve", ...inputFromArgs(args as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      nested: defineCommand({
        meta: { name: "nested", description: "Flatten single-subfolder chains." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "nested", ...inputFromArgs(args as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      media: defineCommand({
        meta: { name: "media", description: "Release folders containing exactly one media file." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "media", ...inputFromArgs(args as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      archive: defineCommand({
        meta: { name: "archive", description: "Release folders containing exactly one archive." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "archive", ...inputFromArgs(args as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      direct: defineCommand({
        meta: { name: "direct", description: "Move a folder's contents to its parent." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "direct", ...inputFromArgs(args as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      "collect-archives": defineCommand({
        meta: { name: "collect-archives", description: "Print matching single-archive paths." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "collect_archives", ...inputFromArgs(args as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "Show undo history." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "history", ...inputFromArgs(args as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo the latest or selected dissolve record." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "undo", ...inputFromArgs(args as DissolvefCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Root folder path." },
    exclude: { type: "string", description: "Comma-separated exclude keywords." },
    nested: { type: "boolean", description: "Enable nested mode." },
    media: { type: "boolean", description: "Enable single-media mode." },
    archive: { type: "boolean", description: "Enable single-archive mode." },
    direct: { type: "boolean", description: "Enable direct mode." },
    preview: { type: "boolean", description: "Preview without changing files." },
    dryRun: { type: "boolean", description: "Alias for preview." },
    fileConflict: { type: "string", description: "auto, skip, overwrite, or rename." },
    dirConflict: { type: "string", description: "auto, skip, overwrite, or rename." },
    similarityThreshold: { type: "string", description: "Similarity threshold from 0 to 1." },
    enableSimilarity: { type: "boolean", description: "Enable similarity filter." },
    protectFirstLevel: { type: "boolean", description: "Do not dissolve first-level folders below --path." },
    historyPath: { type: "string", description: "Undo history JSON path." },
    historyLimit: { type: "string", description: "Maximum history records." },
    undoId: { type: "string", description: "Undo record id." },
    mediaTypes: { type: "string", description: "Comma-separated media types: video, archive, image." },
    skipBlacklist: { type: "boolean", description: "Disable built-in archive/nested blacklists." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: DissolvefCliOptions): DissolvefInput {
  return {
    path: args.path,
    exclude: splitArg(args.exclude),
    nested: args.nested,
    media: args.media,
    archive: args.archive,
    direct: args.direct,
    preview: Boolean(args.preview || args.dryRun),
    fileConflict: args.fileConflict,
    dirConflict: args.dirConflict,
    similarityThreshold: numberArg(args.similarityThreshold),
    enableSimilarity: args.enableSimilarity,
    protectFirstLevel: args.protectFirstLevel,
    historyPath: args.historyPath,
    historyLimit: numberArg(args.historyLimit),
    undoId: args.undoId,
    mediaTypes: splitArg(args.mediaTypes).filter(isMediaType),
    skipBlacklist: args.skipBlacklist,
  }
}

async function runAction(input: DissolvefInput & { action: DissolvefAction }, json: boolean, host: CliHost): Promise<void> {
  const result = await runDissolvef(input, createNodeDissolvefRuntime(), (event) => {
    if (!json) writeCliEvent(host, event, { label: CLI_NAME })
  })
  if (json) {
    writeJson(host, result)
    return
  }
  writeLine(host, result.message)
  for (const item of result.data?.plan?.slice(0, 40) ?? []) {
    writeLine(host, `${item.status} ${item.mode} ${item.operation} ${item.sourcePath}${item.targetPath ? ` -> ${item.targetPath}` : item.reason ? ` / ${item.reason}` : ""}`)
  }
  for (const item of result.data?.archivePaths?.slice(0, 80) ?? []) writeLine(host, item)
  for (const item of result.data?.history?.slice(0, 20) ?? []) writeLine(host, `${item.id} ${item.mode} ${item.count}${item.undone ? " undone" : ""}`)
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `plan --path . --json` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedDissolvefApp, { host }))
}

function GuidedDissolvefApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"path" | "mode" | "running" | "done">("path")
  const [path, setPath] = useState("")
  const [message, setMessage] = useState("Folder path.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "path") {
      setPath(value)
      setMessage("Mode: plan, dissolve, nested, media, archive, direct.")
      setStep("mode")
      return
    }
    const action = normalizeGuidedAction(value)
    await execute({ action, path, preview: action === "plan" })
  }

  async function execute(input: DissolvefInput & { action: DissolvefAction }) {
    setStep("running")
    setMessage("Running...")
    const result = await runDissolvef(input, createNodeDissolvefRuntime(), (event) => {
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
    { flexDirection: "column" },
    h(Text, { color: "cyan", bold: true }, "dissolvef guided"),
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

function normalizeGuidedAction(value: string): DissolvefAction {
  const action = value.trim().toLowerCase()
  if (action === "nested" || action === "media" || action === "archive" || action === "direct" || action === "plan") return action
  return "dissolve"
}

function splitArg(value?: string): string[] {
  return (value ?? "").split(/[,;\r\n]/).map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: string | number): number | undefined {
  if (typeof value === "number") return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isMediaType(value: string): value is DissolvefMediaType {
  return value === "video" || value === "archive" || value === "image"
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
