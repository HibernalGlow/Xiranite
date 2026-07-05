#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/contract"
import type { PowerMode, SleeptAction, SleeptInput } from "./core.js"
import { runSleept } from "./core.js"
import { createNodeSleeptRuntime } from "./platform.js"

export const cli: CliCommand = {
  name: "xiranite-sleept",
  description: "System timer with countdown, scheduled time, network, and CPU triggers.",
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
      name: "xiranite-sleept",
      description: "Timer CLI with Typer-style commands and an Ink guided mode.",
    },
    subCommands: {
      status: defineCommand({
        meta: { name: "status", description: "Print current system status." },
        args: { json: { type: "boolean", description: "Print JSON result." } },
        async run({ args }) {
          await runAction({ action: "get_stats" }, Boolean(args.json), host)
        },
      }),
      countdown: defineCommand({
        meta: { name: "countdown", description: "Run a countdown timer." },
        args: timerArgs(),
        async run({ args }) {
          await runAction(inputFromArgs("countdown", args), Boolean(args.json), host)
        },
      }),
      at: defineCommand({
        meta: { name: "at", description: "Run at a specific datetime." },
        args: {
          target: { type: "string", required: true, description: "Target datetime: YYYY-MM-DD HH:MM:SS." },
          power: { type: "string", default: "sleep", description: "sleep, shutdown, or restart." },
          dryrun: { type: "boolean", default: true, description: "Simulate the power action." },
          json: { type: "boolean", description: "Print JSON result." },
        },
        async run({ args }) {
          await runAction({
            action: "specific_time",
            targetDatetime: String(args.target),
            powerMode: powerMode(args.power),
            dryrun: Boolean(args.dryrun),
          }, Boolean(args.json), host)
        },
      }),
      netspeed: defineCommand({
        meta: { name: "netspeed", description: "Trigger after sustained low network throughput." },
        args: {
          upload: { type: "string", default: "242", description: "Upload threshold in KB/s." },
          download: { type: "string", default: "242", description: "Download threshold in KB/s." },
          duration: { type: "string", default: "2", description: "Low-speed duration in minutes." },
          trigger: { type: "string", default: "both", description: "both or any." },
          power: { type: "string", default: "sleep", description: "sleep, shutdown, or restart." },
          dryrun: { type: "boolean", default: true, description: "Simulate the power action." },
          json: { type: "boolean", description: "Print JSON result." },
        },
        async run({ args }) {
          await runAction({
            action: "netspeed",
            uploadThreshold: Number(args.upload),
            downloadThreshold: Number(args.download),
            netDuration: Number(args.duration),
            netTriggerMode: args.trigger === "any" ? "any" : "both",
            powerMode: powerMode(args.power),
            dryrun: Boolean(args.dryrun),
          }, Boolean(args.json), host)
        },
      }),
      cpu: defineCommand({
        meta: { name: "cpu", description: "Trigger after sustained low CPU usage." },
        args: {
          threshold: { type: "string", default: "10", description: "CPU threshold percentage." },
          duration: { type: "string", default: "2", description: "Low-CPU duration in minutes." },
          power: { type: "string", default: "sleep", description: "sleep, shutdown, or restart." },
          dryrun: { type: "boolean", default: true, description: "Simulate the power action." },
          json: { type: "boolean", description: "Print JSON result." },
        },
        async run({ args }) {
          await runAction({
            action: "cpu",
            cpuThreshold: Number(args.threshold),
            cpuDuration: Number(args.duration),
            powerMode: powerMode(args.power),
            dryrun: Boolean(args.dryrun),
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

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `status --help` for scripted use.")
    process.exitCode = 2
    return
  }

  await runInkApp(h(GuidedSleeptApp, { host }))
}

function timerArgs() {
  return {
    hours: { type: "string", default: "0", description: "Hours." },
    minutes: { type: "string", default: "0", description: "Minutes." },
    seconds: { type: "string", default: "5", description: "Seconds." },
    power: { type: "string", default: "sleep", description: "sleep, shutdown, or restart." },
    dryrun: { type: "boolean", default: true, description: "Simulate the power action." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(action: SleeptAction, args: Record<string, unknown>): SleeptInput {
  return {
    action,
    hours: Number(args.hours ?? 0),
    minutes: Number(args.minutes ?? 0),
    seconds: Number(args.seconds ?? 5),
    powerMode: powerMode(args.power),
    dryrun: Boolean(args.dryrun),
  }
}

async function runAction(input: SleeptInput, json: boolean, host: CliHost): Promise<void> {
  const runtime = createNodeSleeptRuntime()
  const result = await runSleept(input, runtime, (event) => {
    if (event.type === "progress") {
      writeLine(host, `[${event.progress ?? 0}%] ${event.message}`)
    } else {
      writeLine(host, event.message)
    }
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
}

function powerMode(value: unknown): PowerMode {
  return value === "shutdown" || value === "restart" ? value : "sleep"
}

function GuidedSleeptApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"mode" | "seconds" | "power" | "dryrun" | "running" | "done">("mode")
  const [mode, setMode] = useState<SleeptAction>("countdown")
  const [seconds, setSeconds] = useState(5)
  const [power, setPower] = useState<PowerMode>("sleep")
  const [dryrun, setDryrun] = useState(true)
  const [message, setMessage] = useState("Choose mode: 1 countdown, 2 status.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "mode") {
      if (value === "2" || value.toLowerCase() === "status") {
        setMode("get_stats")
        setStep("running")
        await execute({ action: "get_stats" })
        return
      }
      setMode("countdown")
      setStep("seconds")
      setMessage("Countdown seconds.")
      return
    }

    if (step === "seconds") {
      setSeconds(Number(value) || 5)
      setStep("power")
      setMessage("Power action: sleep, shutdown, restart.")
      return
    }

    if (step === "power") {
      setPower(powerMode(value))
      setStep("dryrun")
      setMessage("Dry-run? yes/no.")
      return
    }

    if (step === "dryrun") {
      const nextDryrun = !["n", "no", "false", "0"].includes(value.toLowerCase())
      setDryrun(nextDryrun)
      setStep("running")
      await execute({ action: mode, seconds, powerMode: power, dryrun: nextDryrun })
    }
  }

  async function execute(input: SleeptInput) {
    const runtime = createNodeSleeptRuntime()
    setMessage("Running...")
    const result = await runSleept(input, runtime, (event) => {
      setLines((current) => [...current.slice(-8), `[${event.progress ?? 0}%] ${event.message}`])
    })
    setLines((current) => [...current.slice(-8), result.message])
    setMessage("Completed. Press q to exit.")
    setStep("done")
    writeLine(host, result.message)
  }

  useInput((input) => {
    if (step === "done" && (input === "q" || input === "\u0003")) {
      app.exit()
    }
  })

  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { color: "cyan", bold: true }, "sleept guided"),
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
