#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { LinkuInput } from "./core.js"
import { runLinku } from "./core.js"
import { createNodeLinkuRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("linku")

interface LinkuCliOptions {
  path?: string
  target?: string
  configPath?: string
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Create, move, list, and recover symlink records.",
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
    meta: { name: CLI_NAME, description: "Symlink manager with guided terminal mode." },
    subCommands: {
      info: defineCommand({
        meta: { name: "info", description: "Show file, directory, or symlink information." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "info", ...inputFromArgs(args as LinkuCliOptions) }, Boolean(args.json), host)
        },
      }),
      create: defineCommand({
        meta: { name: "create", description: "Create a symlink from --target to --path." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "create", ...inputFromArgs(args as LinkuCliOptions) }, Boolean(args.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move --path to --target and create a link at the original path." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "move_link", ...inputFromArgs(args as LinkuCliOptions) }, Boolean(args.json), host)
        },
      }),
      list: defineCommand({
        meta: { name: "list", description: "List recorded links." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "list", ...inputFromArgs(args as LinkuCliOptions) }, Boolean(args.json), host)
        },
      }),
      recover: defineCommand({
        meta: { name: "recover", description: "Recover missing or incorrect recorded symlinks." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "recover", ...inputFromArgs(args as LinkuCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Source path." },
    target: { type: "string", description: "Target path or symlink path." },
    configPath: { type: "string", description: "linku.toml path." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: LinkuCliOptions): LinkuInput {
  return { path: args.path, target: args.target, configPath: args.configPath }
}

async function runAction(input: LinkuInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runLinku(input, createNodeLinkuRuntime(input.configPath), (event) => {
    if (event.type === "progress") writeLine(host, `[${event.progress ?? 0}%] ${event.message}`)
    else writeLine(host, event.message)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  if (result.data?.links?.length) {
    for (const link of result.data.links) writeLine(host, `${link.link} -> ${link.target}`)
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `info --help` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedLinkuApp, { host }))
}

function GuidedLinkuApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "path" | "target" | "running" | "done">("action")
  const [action, setAction] = useState<LinkuInput["action"]>("info")
  const [path, setPath] = useState("")
  const [message, setMessage] = useState("Action: info, create, move, list, recover.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const next = value === "create" || value === "move" || value === "list" || value === "recover" ? value : "info"
      const mapped = next === "move" ? "move_link" : next
      setAction(mapped)
      if (mapped === "list" || mapped === "recover") {
        setStep("running")
        await execute({ action: mapped })
        return
      }
      setStep("path")
      setMessage("Source path.")
      return
    }
    if (step === "path") {
      setPath(value)
      if (action === "info") {
        setStep("running")
        await execute({ action, path: value })
        return
      }
      setStep("target")
      setMessage("Target path.")
      return
    }
    if (step === "target") {
      setStep("running")
      await execute({ action, path, target: value })
    }
  }

  async function execute(input: LinkuInput) {
    setMessage("Running...")
    const result = await runLinku(input, createNodeLinkuRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "linku guided"),
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
