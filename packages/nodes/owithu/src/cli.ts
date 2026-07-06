#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { OwithuInput, RegistryHive } from "./core.js"
import { runOwithu } from "./core.js"
import { createNodeOwithuRuntime } from "./platform.js"

interface OwithuCliOptions {
  config?: string
  hive?: RegistryHive
  key?: string
  json?: boolean
}

export const cli: CliCommand = {
  name: "xiranite-owithu",
  description: "Manage Windows Open-with context menu entries from TOML.",
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
    meta: { name: "xiranite-owithu", description: "Windows context-menu registry helper." },
    subCommands: {
      preview: defineCommand({
        meta: { name: "preview", description: "Preview registry operations from TOML." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "preview", ...inputFromArgs(args as OwithuCliOptions) }, Boolean(args.json), host)
        },
      }),
      register: defineCommand({
        meta: { name: "register", description: "Register enabled context-menu entries." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "register", ...inputFromArgs(args as OwithuCliOptions) }, Boolean(args.json), host)
        },
      }),
      unregister: defineCommand({
        meta: { name: "unregister", description: "Remove context-menu entries." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "unregister", ...inputFromArgs(args as OwithuCliOptions) }, Boolean(args.json), host)
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
    config: { type: "string", alias: "c", description: "Path to owithu.toml." },
    hive: { type: "string", description: "Registry hive override: HKCU, HKCR, or HKLM." },
    key: { type: "string", description: "Only process this entry key." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: OwithuCliOptions): OwithuInput {
  return {
    path: args.config,
    hive: args.hive,
    onlyKey: args.key,
  }
}

async function runAction(input: OwithuInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runOwithu(input, createNodeOwithuRuntime(), (event) => {
    if (!json) writeLine(host, `[${event.progress ?? 0}%] ${event.message}`)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  for (const item of result.data?.plan ?? []) {
    writeLine(host, `${item.hive} ${item.scope} ${item.entryKey}: ${item.command}`)
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `preview --help` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedOwithuApp, { host }))
}

function GuidedOwithuApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "config" | "running" | "done">("action")
  const [action, setAction] = useState<OwithuInput["action"]>("preview")
  const [message, setMessage] = useState("Action: preview, register, unregister.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const next = value === "register" || value === "unregister" ? value : "preview"
      setAction(next)
      setStep("config")
      setMessage("Config path.")
      return
    }

    setStep("running")
    setMessage("Running...")
    const result = await runOwithu({ action, path: value }, createNodeOwithuRuntime(), (event) => {
      setLines((current) => [...current.slice(-8), `[${event.progress ?? 0}%] ${event.message}`])
    })
    writeLine(host, result.message)
    setLines((current) => [...current.slice(-8), result.message])
    setMessage("Completed. Press q to exit.")
    setStep("done")
  }

  useInput((input) => {
    if (step === "done" && (input === "q" || input === "\u0003")) app.exit()
  })

  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { color: "cyan", bold: true }, "owithu guided"),
    h(Text, null, message),
    step === "action" || step === "config" ? h(InputLine, { onSubmit: submit }) : null,
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
