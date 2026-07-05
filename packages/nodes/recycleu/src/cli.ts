#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/contract"
import type { RecycleuInput } from "./core.js"
import { runRecycleu } from "./core.js"
import { createNodeRecycleuRuntime } from "./platform.js"

export const cli: CliCommand = {
  name: "xiranite-recycleu",
  description: "Empty the Windows recycle bin immediately or on a timer.",
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
      name: "xiranite-recycleu",
      description: "Recycle bin cleaner with Typer-style commands and an Ink guided mode.",
    },
    subCommands: {
      status: defineCommand({
        meta: { name: "status", description: "Print current cleaner status." },
        args: { json: { type: "boolean", description: "Print JSON result." } },
        async run({ args }) {
          await runAction({ action: "status" }, Boolean(args.json), host)
        },
      }),
      clean: defineCommand({
        meta: { name: "clean", description: "Empty the recycle bin once." },
        args: { json: { type: "boolean", description: "Print JSON result." } },
        async run({ args }) {
          await runAction({ action: "clean_now" }, Boolean(args.json), host)
        },
      }),
      start: defineCommand({
        meta: { name: "start", description: "Run auto-clean for a bounded number of cycles." },
        args: {
          interval: { type: "string", default: "10", description: "Clean interval in seconds, minimum 5." },
          cycles: { type: "string", default: "360", description: "Maximum clean cycles." },
          json: { type: "boolean", description: "Print JSON result." },
        },
        async run({ args }) {
          await runAction({
            action: "start",
            interval: Number(args.interval),
            maxCycles: Number(args.cycles),
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

async function runAction(input: RecycleuInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runRecycleu(input, createNodeRecycleuRuntime(), (event) => {
    if (event.type === "progress") writeLine(host, `[${event.progress ?? 0}%] ${event.message}`)
    else writeLine(host, event.message)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `clean --help` for scripted use.")
    process.exitCode = 2
    return
  }

  await runInkApp(h(GuidedRecycleuApp, { host }))
}

function GuidedRecycleuApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"mode" | "interval" | "cycles" | "running" | "done">("mode")
  const [interval, setIntervalValue] = useState(10)
  const [message, setMessage] = useState("Choose mode: 1 clean now, 2 auto-clean.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "mode") {
      if (value === "1" || value.toLowerCase() === "clean") {
        setStep("running")
        await execute({ action: "clean_now" })
        return
      }
      setStep("interval")
      setMessage("Clean interval in seconds, minimum 5.")
      return
    }

    if (step === "interval") {
      setIntervalValue(Math.max(5, Number(value) || 10))
      setStep("cycles")
      setMessage("Maximum cycles.")
      return
    }

    if (step === "cycles") {
      setStep("running")
      await execute({ action: "start", interval, maxCycles: Math.max(1, Number(value) || 1) })
    }
  }

  async function execute(input: RecycleuInput) {
    setMessage("Running...")
    const result = await runRecycleu(input, createNodeRecycleuRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "recycleu guided"),
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
