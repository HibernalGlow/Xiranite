#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { ReinstallpInput } from "./core.js"
import { runReinstallp } from "./core.js"
import { createNodeReinstallpRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("reinstallp")

interface ReinstallpCliOptions {
  path?: string
  projects?: string
  system?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Scan and reinstall Python editable packages with uv.",
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
    meta: { name: CLI_NAME, description: "Python editable package reinstall helper." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Find pyproject.toml projects." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "scan", path: String(args.path ?? "") }, Boolean(args.json), host)
        },
      }),
      install: defineCommand({
        meta: { name: "install", description: "Run uv pip install -e for projects." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({
            action: "install",
            projects: parseProjects((args as ReinstallpCliOptions).projects),
            useSystem: Boolean(args.system ?? true),
          }, Boolean(args.json), host)
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
    path: { type: "string", description: "Root path for scan." },
    projects: { type: "string", description: "Project paths separated by semicolon." },
    system: { type: "boolean", default: true, description: "Use uv --system." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function parseProjects(value?: string): string[] {
  return (value ?? "").split(";").map((item) => item.trim()).filter(Boolean)
}

async function runAction(input: ReinstallpInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runReinstallp(input, createNodeReinstallpRuntime(), (event) => {
    if (event.type === "progress") writeLine(host, `[${event.progress ?? 0}%] ${event.message}`)
    else writeLine(host, event.message)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  for (const project of result.data?.projects ?? result.data?.results ?? []) {
    writeLine(host, `${project.name}: ${project.path}`)
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `scan --help` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedReinstallpApp, { host }))
}

function GuidedReinstallpApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"root" | "running" | "done">("root")
  const [message, setMessage] = useState("Root path to scan.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    setStep("running")
    setMessage("Scanning...")
    const result = await runReinstallp({ action: "scan", path: value }, createNodeReinstallpRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "reinstallp guided"),
    h(Text, null, message),
    step === "root" ? h(InputLine, { onSubmit: submit }) : null,
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
