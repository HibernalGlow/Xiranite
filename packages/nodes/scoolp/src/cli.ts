#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import type { ScoolpAction, ScoolpInput } from "./core.js"
import { formatSize, runScoolp } from "./core.js"
import { createNodeScoolpRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("scoolp")

interface ScoolpCliOptions {
  path?: string
  config?: string
  bucketPath?: string
  "bucket-path"?: string
  package?: string
  packages?: string
  dir?: string
  root?: string
  dryRun?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Scoop status, package, sync, and cache management.",
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
    meta: { name: CLI_NAME, description: "Scoop management helper." },
    subCommands: {
      status: defineCommand({
        meta: { name: "status", description: "Check scoop installation, installed packages, and buckets." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "status" }, Boolean(args.json), host)
        },
      }),
      init: defineCommand({
        meta: { name: "init", description: "Install scoop, optionally into --dir." },
        args: commonArgs(),
        async run({ args }) {
          const opts = args as ScoolpCliOptions
          await runAction({ action: "init", scoopDir: opts.dir, dryRun: Boolean(opts.dryRun) }, Boolean(args.json), host)
        },
      }),
      list: defineCommand({
        meta: { name: "list", description: "List manifests in a local bucket." },
        args: commonArgs(),
        async run({ args }) {
          const opts = args as ScoolpCliOptions
          await runAction({ action: "list_packages", bucketPath: bucketPathArg(opts) ?? opts.path }, Boolean(args.json), host)
        },
      }),
      info: defineCommand({
        meta: { name: "info", description: "Show manifest info from a local bucket." },
        args: commonArgs(),
        async run({ args }) {
          const opts = args as ScoolpCliOptions
          await runAction({ action: "package_info", bucketPath: bucketPathArg(opts) ?? opts.path, packageName: opts.package }, Boolean(args.json), host)
        },
      }),
      install: defineCommand({
        meta: { name: "install", description: "Install packages by name or local manifest path." },
        args: commonArgs(),
        async run({ args }) {
          const opts = args as ScoolpCliOptions
          await runAction({
            action: "install",
            bucketPath: bucketPathArg(opts) ?? opts.path,
            packageName: opts.package,
            packages: parseList(opts.packages),
            dryRun: Boolean(opts.dryRun),
          }, Boolean(args.json), host)
        },
      }),
      "show-config": defineCommand({
        meta: { name: "show-config", description: "Parse and show a scoop sync TOML config." },
        args: commonArgs(),
        async run({ args }) {
          const opts = args as ScoolpCliOptions
          await runAction({ action: "show_config", configPath: opts.config ?? opts.path }, Boolean(args.json), host)
        },
      }),
      sync: defineCommand({
        meta: { name: "sync", description: "Run or dry-run scoop bucket sync commands." },
        args: commonArgs(),
        async run({ args }) {
          const opts = args as ScoolpCliOptions
          await runAction({ action: "sync", configPath: opts.config ?? opts.path, dryRun: Boolean(opts.dryRun) }, Boolean(args.json), host)
        },
      }),
      "cache-list": defineCommand({
        meta: { name: "cache-list", description: "List obsolete scoop cache files." },
        args: commonArgs(),
        async run({ args }) {
          const opts = args as ScoolpCliOptions
          await runAction({ action: "cache_list", cachePath: opts.path, scoopRoot: opts.root }, Boolean(args.json), host)
        },
      }),
      "cache-backup": defineCommand({
        meta: { name: "cache-backup", description: "Move obsolete cache files into a timestamped backup folder." },
        args: commonArgs(),
        async run({ args }) {
          const opts = args as ScoolpCliOptions
          await runAction({ action: "cache_backup", cachePath: opts.path, scoopRoot: opts.root, dryRun: Boolean(opts.dryRun) }, Boolean(args.json), host)
        },
      }),
      "cache-delete": defineCommand({
        meta: { name: "cache-delete", description: "Delete obsolete scoop cache files." },
        args: commonArgs(),
        async run({ args }) {
          const opts = args as ScoolpCliOptions
          await runAction({ action: "cache_delete", cachePath: opts.path, scoopRoot: opts.root, dryRun: Boolean(opts.dryRun) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Path used by the selected command." },
    config: { type: "string", alias: "c", description: "Sync TOML config path." },
    bucketPath: { type: "string", description: "Local scoop bucket root containing bucket/*.json." },
    package: { type: "string", description: "Package name." },
    packages: { type: "string", description: "Package names separated by comma or semicolon." },
    dir: { type: "string", description: "Scoop install directory." },
    root: { type: "string", description: "Scoop root directory." },
    dryRun: { type: "boolean", description: "Preview commands or file operations." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function parseList(value?: string): string[] {
  return (value ?? "").split(/[;,]/).map((item) => item.trim()).filter(Boolean)
}

function bucketPathArg(args: ScoolpCliOptions): string | undefined {
  return args.bucketPath ?? args["bucket-path"]
}

async function runAction(input: ScoolpInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runScoolp(input, createNodeScoolpRuntime(), (event) => {
    if (!json) writeLine(host, `[${event.progress ?? 0}%] ${event.message}`)
  })

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  if (result.data?.availablePackages.length) {
    for (const item of result.data.availablePackages) writeLine(host, `${item.name}\t${item.version ?? ""}\t${item.description ?? ""}`)
  }
  if (result.data?.syncPlan.length) {
    for (const item of result.data.syncPlan) writeLine(host, `${item.label}: ${item.command} ${item.args.join(" ")}`)
  }
  if (result.data?.cache) {
    writeLine(host, `obsolete=${result.data.cache.obsoleteCount} size=${formatSize(result.data.cache.obsoleteSize)}`)
    for (const item of result.data.cache.obsoletePackages.slice(0, 50)) writeLine(host, `${item.name}\t${item.version}\t${formatSize(item.size)}`)
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `status --help` for scripted use.")
    process.exitCode = 2
    return
  }
  await runInkApp(h(GuidedScoolpApp, { host }))
}

function GuidedScoolpApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "path" | "running" | "done">("action")
  const [action, setAction] = useState<ScoolpAction>("status")
  const [message, setMessage] = useState("Action: status, list, sync, cache-list.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const next = mapGuidedAction(value)
      setAction(next)
      if (next === "status") {
        await execute({ action: next })
        return
      }
      setStep("path")
      setMessage(next === "sync" ? "Config path, or blank for default." : "Path.")
      return
    }

    const input: ScoolpInput = action === "list_packages"
      ? { action, bucketPath: value }
      : action === "sync"
        ? { action, configPath: value, dryRun: true }
        : { action, cachePath: value }
    await execute(input)
  }

  async function execute(input: ScoolpInput) {
    setStep("running")
    setMessage("Running...")
    const result = await runScoolp(input, createNodeScoolpRuntime(), (event) => {
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
    h(Text, { color: "cyan", bold: true }, "scoolp guided"),
    h(Text, null, message),
    step === "action" || step === "path" ? h(InputLine, { onSubmit: submit }) : null,
    ...lines.map((line) => h(Text, { key: line, color: "gray" }, line)),
  )
}

function mapGuidedAction(value: string): ScoolpAction {
  if (value === "list") return "list_packages"
  if (value === "sync") return "sync"
  if (value === "cache-list" || value === "cache") return "cache_list"
  return "status"
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
