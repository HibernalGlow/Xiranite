#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeCliEvent, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { EncodebInput, EncodebStrategy } from "./core.js"
import { ENCODEB_PRESETS, parseEncodebPaths, runEncodeb } from "./core.js"
import { createNodeEncodebRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("encodeb")

interface EncodebCliOptions {
  paths?: string
  preset?: string
  srcEncoding?: string
  dstEncoding?: string
  strategy?: string
  limit?: string
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Preview and recover garbled filenames by re-decoding path components.",
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
    meta: {
      name: CLI_NAME,
      description: "Filename encoding recovery with Typer-style commands and an Ink guided mode.",
    },
    subCommands: {
      find: defineCommand({
        meta: { name: "find", description: "Find suspicious garbled filenames." },
        args: encodebArgs(),
        async run({ args }) {
          await runAction({ ...inputFromArgs(args as EncodebCliOptions), action: "find" }, Boolean(args.json), host)
        },
      }),
      preview: defineCommand({
        meta: { name: "preview", description: "Preview filename re-encoding mappings." },
        args: encodebArgs(),
        async run({ args }) {
          await runAction({ ...inputFromArgs(args as EncodebCliOptions), action: "preview" }, Boolean(args.json), host)
        },
      }),
      recover: defineCommand({
        meta: { name: "recover", description: "Apply filename recovery." },
        args: encodebArgs(),
        async run({ args }) {
          await runAction({ ...inputFromArgs(args as EncodebCliOptions), action: "recover" }, Boolean(args.json), host)
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

function encodebArgs() {
  return {
    paths: { type: "string", description: "Paths separated by semicolon or new lines." },
    preset: { type: "string", default: "cn", description: "cn, jp, kr, or custom." },
    srcEncoding: { type: "string", description: "Source encoding, e.g. cp437." },
    dstEncoding: { type: "string", description: "Destination encoding, e.g. cp936." },
    strategy: { type: "string", default: "replace", description: "replace or copy." },
    limit: { type: "string", default: "200", description: "Maximum preview/find results." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: EncodebCliOptions): EncodebInput {
  const preset = ENCODEB_PRESETS[args.preset as keyof typeof ENCODEB_PRESETS]
  return {
    paths: parseEncodebPaths((args.paths ?? "").split(";")),
    srcEncoding: args.srcEncoding ?? preset?.srcEncoding ?? "cp437",
    dstEncoding: args.dstEncoding ?? preset?.dstEncoding ?? "cp936",
    strategy: args.strategy === "copy" ? "copy" : "replace",
    limit: Number(args.limit ?? 200),
  }
}

async function runAction(input: EncodebInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runEncodeb(input, createNodeEncodebRuntime(), (event) => {
    if (json) return
    if (event.type === "progress") writeCliEvent(host, event, { label: CLI_NAME })
    else writeLine(host, event.message)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  if (input.action === "find") {
    writeLine(host, result.data?.matches.join("\n") ?? "")
  } else if (input.action === "preview") {
    for (const mapping of result.data?.mappings ?? []) {
      writeLine(host, `${mapping.src} -> ${mapping.dst}`)
    }
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `preview --help` for scripted use.")
    process.exitCode = 2
    return
  }

  await runInkApp(h(GuidedEncodebApp, { host }))
}

function GuidedEncodebApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"paths" | "action" | "strategy" | "running" | "done">("paths")
  const [paths, setPaths] = useState("")
  const [action, setAction] = useState<"find" | "preview" | "recover">("preview")
  const [message, setMessage] = useState("Enter path(s), separated by semicolon.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "paths") {
      setPaths(value)
      setStep("action")
      setMessage("Action: find, preview, recover.")
      return
    }

    if (step === "action") {
      const nextAction = value === "find" || value === "recover" ? value : "preview"
      setAction(nextAction)
      if (nextAction === "recover") {
        setStep("strategy")
        setMessage("Strategy: replace or copy.")
        return
      }
      setStep("running")
      await execute({ action: nextAction, paths: parseEncodebPaths(paths.split(";")) })
      return
    }

    if (step === "strategy") {
      setStep("running")
      await execute({ action, paths: parseEncodebPaths(paths.split(";")), strategy: strategy(value) })
    }
  }

  async function execute(input: EncodebInput) {
    setMessage("Running...")
    const result = await runEncodeb(input, createNodeEncodebRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "encodeb guided"),
    h(Text, null, message),
    step !== "done" && step !== "running" ? h(InputLine, { onSubmit: submit }) : null,
    ...lines.map((line) => h(Text, { key: line, color: "gray" }, line)),
  )
}

function strategy(value: string): EncodebStrategy {
  return value === "copy" ? "copy" : "replace"
}

function InputLine({ onSubmit }: { onSubmit: (value: string) => void | Promise<void> }) {
  const [value, setValue] = useState("")
  useInput((input, key) => {
    if (key.return) {
      void onSubmit(value.trim())
      setValue("")
      return
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1))
      return
    }
    if (!key.ctrl && input) {
      setValue((current) => current + input)
    }
  })
  return h(Text, null, "> ", value, h(Text, { inverse: true }, " "))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
