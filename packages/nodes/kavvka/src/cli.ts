#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/contract"
import type { KavvkaInput } from "./core.js"
import { parseKavvkaKeywords, parseKavvkaPaths, runKavvka } from "./core.js"
import { createNodeKavvkaRuntime } from "./platform.js"

interface KavvkaCliOptions {
  path?: string
  paths?: string
  root?: string
  roots?: string
  keyword?: string
  keywords?: string
  depth?: string | number
  force?: boolean
  dryRun?: boolean
  strictArtist?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: "xiranite-kavvka",
  description: "Prepare Czkawka include paths from gallery folders.",
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
    meta: { name: "xiranite-kavvka", description: "Czkawka path helper with guided terminal mode." },
    subCommands: {
      process: defineCommand({
        meta: { name: "process", description: "Move sibling folders into #compare and print Czkawka paths." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "process", ...inputFromArgs(args as KavvkaCliOptions) }, Boolean(args.json), host)
        },
      }),
      plan: defineCommand({
        meta: { name: "plan", description: "Preview process results without moving folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "plan", ...inputFromArgs(args as KavvkaCliOptions), dryRun: true }, Boolean(args.json), host)
        },
      }),
      scan: defineCommand({
        meta: { name: "scan", description: "Find folders whose names contain gallery keywords." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "scan", ...inputFromArgs(args as KavvkaCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Semicolon, comma, or newline-separated source paths." },
    paths: { type: "string", description: "Semicolon, comma, or newline-separated source paths." },
    root: { type: "string", description: "Semicolon, comma, or newline-separated scan roots." },
    roots: { type: "string", description: "Semicolon, comma, or newline-separated scan roots." },
    keyword: { type: "string", description: "Comma-separated scan keywords." },
    keywords: { type: "string", description: "Comma-separated scan keywords." },
    depth: { type: "string", description: "Scan depth." },
    force: { type: "boolean", description: "Move without confirmation. Non-interactive commands default to force." },
    dryRun: { type: "boolean", description: "Preview without moving folders." },
    strictArtist: { type: "boolean", description: "Require an ancestor or child folder with [] marker." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: KavvkaCliOptions): KavvkaInput {
  return {
    paths: parseList(args.paths || args.path),
    scanRoots: parseList(args.roots || args.root),
    keywords: parseKavvkaKeywords(args.keywords || args.keyword),
    scanDepth: parseDepth(args.depth),
    force: args.force ?? true,
    dryRun: Boolean(args.dryRun),
    strictArtist: Boolean(args.strictArtist),
  }
}

async function runAction(input: KavvkaInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runKavvka(input, createNodeKavvkaRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })
  if (json) {
    writeJson(host, result)
    return
  }
  writeLine(host, result.message)
  for (const path of result.data?.matchedPaths ?? []) writeLine(host, path)
  for (const path of result.data?.allCombinedPaths ?? []) writeLine(host, path)
  for (const item of result.data?.processResults ?? []) {
    for (const moved of item.movedFolders) writeLine(host, `${moved.success ? "moved" : "planned"} ${moved.source} -> ${moved.target}`)
    for (const warning of item.warnings) writeLine(host, `warning: ${warning}`)
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use `scan`, `plan`, or `process` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedKavvkaApp, { host }))
}

function GuidedKavvkaApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "path" | "running" | "done">("action")
  const [action, setAction] = useState<"scan" | "plan" | "process">("scan")
  const [message, setMessage] = useState("Action: scan, plan, process.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const next = value === "process" || value === "plan" ? value : "scan"
      setAction(next)
      setMessage(next === "scan" ? "Scan roots, comma-separated." : "Source folders, comma-separated.")
      setStep("path")
      return
    }
    if (step === "path") {
      const paths = parseList(value)
      await execute(action === "scan" ? { action, scanRoots: paths } : { action, paths, dryRun: action === "plan", force: true })
    }
  }

  async function execute(input: KavvkaInput) {
    setStep("running")
    setMessage("Running...")
    const result = await runKavvka(input, createNodeKavvkaRuntime(), (event) => {
      setLines((current) => [...current.slice(-8), `[${event.progress ?? 0}%] ${event.message}`])
    })
    setLines((current) => [...current.slice(-8), result.message, ...(result.data?.allCombinedPaths ?? result.data?.matchedPaths ?? []).slice(0, 4)])
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
    h(Text, { color: "cyan", bold: true }, "kavvka guided"),
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

function parseList(value?: string): string[] {
  return parseKavvkaPaths((value ?? "").replace(/,/g, "\n"))
}

function parseDepth(value?: string | number): number {
  const next = Number(value ?? 3)
  return Number.isFinite(next) ? next : 3
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
