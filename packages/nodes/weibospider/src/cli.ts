#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, runInkApp, runMain, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/contract"
import type { WeiboSpiderAction, WeiboSpiderBrowser, WeiboSpiderInput } from "./core.js"
import { runWeiboSpider } from "./core.js"
import { createNodeWeiboSpiderRuntime } from "./platform.js"

interface WeiboSpiderCliOptions {
  users?: string
  userIds?: string
  config?: string
  configPath?: string
  import?: string
  importPath?: string
  export?: string
  exportPath?: string
  output?: string
  outputDir?: string
  cookie?: string
  cookieFile?: string
  since?: string
  sinceDate?: string
  end?: string
  endDate?: string
  all?: boolean
  original?: boolean
  pic?: boolean
  noPic?: boolean
  video?: boolean
  noVideo?: boolean
  writeMode?: string
  mode?: string
  browser?: WeiboSpiderBrowser
  maxPages?: string | number
  timeout?: string | number
  timeoutMs?: string | number
  offline?: boolean
  dryRun?: boolean
  noDownload?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: "xiranite-weibospider",
  description: "Weibo.cn crawler with config, cookie, guided, and crawl commands.",
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
    meta: { name: "xiranite-weibospider", description: "Weibo.cn crawler workflow with guided terminal mode." },
    subCommands: {
      status: defineCommand({
        meta: { name: "status", description: "Show config status." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("status", args as WeiboSpiderCliOptions, Boolean(args.json), host)
        },
      }),
      load: defineCommand({
        meta: { name: "load", description: "Load a config JSON file." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("load_config", args as WeiboSpiderCliOptions, Boolean(args.json), host)
        },
      }),
      save: defineCommand({
        meta: { name: "save", description: "Save crawler config." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("save_config", args as WeiboSpiderCliOptions, Boolean(args.json), host)
        },
      }),
      import: defineCommand({
        meta: { name: "import", description: "Import config into the active config path." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("import_config", args as WeiboSpiderCliOptions, Boolean(args.json), host)
        },
      }),
      export: defineCommand({
        meta: { name: "export", description: "Export the active config." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("export_config", args as WeiboSpiderCliOptions, Boolean(args.json), host)
        },
      }),
      cookie: defineCommand({
        meta: { name: "cookie", description: "Validate a cookie." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("validate_cookie", args as WeiboSpiderCliOptions, Boolean(args.json), host)
        },
      }),
      browser: defineCommand({
        meta: { name: "browser", description: "Read cookie from Chrome or Edge via DevTools." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("get_browser_cookie", args as WeiboSpiderCliOptions, Boolean(args.json), host)
        },
      }),
      crawl: defineCommand({
        meta: { name: "crawl", description: "Crawl configured Weibo users." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("crawl", args as WeiboSpiderCliOptions, Boolean(args.json), host)
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
    users: { type: "string", description: "Comma or space separated user ids." },
    userIds: { type: "string", description: "Comma or space separated user ids." },
    config: { type: "string", description: "Config JSON path." },
    configPath: { type: "string", description: "Config JSON path." },
    import: { type: "string", description: "Import config path." },
    importPath: { type: "string", description: "Import config path." },
    export: { type: "string", description: "Export config path." },
    exportPath: { type: "string", description: "Export config path." },
    output: { type: "string", description: "Output directory." },
    outputDir: { type: "string", description: "Output directory." },
    cookie: { type: "string", description: "Cookie string or JSON." },
    cookieFile: { type: "string", description: "File containing a cookie string or JSON." },
    since: { type: "string", description: "Since date." },
    sinceDate: { type: "string", description: "Since date." },
    end: { type: "string", description: "End date or now." },
    endDate: { type: "string", description: "End date or now." },
    all: { type: "boolean", description: "Include retweets." },
    original: { type: "boolean", description: "Only original posts." },
    pic: { type: "boolean", description: "Enable picture download." },
    noPic: { type: "boolean", description: "Disable picture download." },
    video: { type: "boolean", description: "Enable video download." },
    noVideo: { type: "boolean", description: "Disable video download." },
    writeMode: { type: "string", description: "Output modes: json,csv,txt." },
    mode: { type: "string", description: "Alias for --writeMode." },
    browser: { type: "string", description: "edge, chrome, or firefox." },
    maxPages: { type: "string", description: "Maximum pages per user." },
    timeout: { type: "string", description: "HTTP timeout in milliseconds." },
    timeoutMs: { type: "string", description: "HTTP timeout in milliseconds." },
    offline: { type: "boolean", description: "Skip online cookie validation." },
    dryRun: { type: "boolean", description: "Do not download media." },
    noDownload: { type: "boolean", description: "Do not download media." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function runAction(action: WeiboSpiderAction, args: WeiboSpiderCliOptions, json: boolean, host: CliHost): Promise<void> {
  const input = await inputFromArgs(action, args)
  const result = await runWeiboSpider(input, createNodeWeiboSpiderRuntime(), (event) => {
    if (!json) writeLine(host, event.type === "progress" ? `[${event.progress ?? 0}%] ${event.message}` : event.message)
  })
  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.message)
  const data = result.data
  if (data) {
    writeLine(host, `config=${data.configPath || "-"}`)
    if (data.outputDir) writeLine(host, `output=${data.outputDir}`)
    writeLine(host, `users=${data.crawledUsers} weibos=${data.crawledWeibos} cookie=${data.cookieValid ? "valid" : "unchecked"}`)
    for (const path of data.outputPaths.slice(0, 30)) writeLine(host, `write ${path}`)
    for (const path of data.downloadedFiles.slice(0, 30)) writeLine(host, `download ${path}`)
    for (const warning of data.warnings) writeLine(host, `warning: ${warning}`)
    for (const error of data.errors) writeLine(host, `error: ${error}`)
  }
  if (!result.success) process.exitCode = 1
}

async function inputFromArgs(action: WeiboSpiderAction, args: WeiboSpiderCliOptions): Promise<WeiboSpiderInput> {
  const cookie = args.cookieFile ? await readFile(args.cookieFile, "utf8") : args.cookie
  return {
    action,
    userIds: args.userIds || args.users,
    filterOriginal: args.all ? false : args.original ?? true,
    sinceDate: args.sinceDate || args.since,
    endDate: args.endDate || args.end,
    picDownload: args.noPic ? false : args.pic ?? true,
    videoDownload: args.noVideo ? false : args.video ?? true,
    writeMode: args.writeMode || args.mode,
    outputDir: args.outputDir || args.output,
    cookie,
    browser: args.browser,
    configPath: args.configPath || args.config,
    importPath: args.importPath || args.import,
    exportPath: args.exportPath || args.export,
    maxPages: numberArg(args.maxPages),
    timeoutMs: numberArg(args.timeoutMs ?? args.timeout),
    online: args.offline ? false : undefined,
    dryRun: args.dryRun,
    downloadMedia: args.noDownload ? false : undefined,
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `crawl --users ... --cookie ... --json` for scripted use.")
    process.exit(2)
    return
  }
  await runInkApp(h(GuidedWeiboSpiderApp, { host }))
}

function GuidedWeiboSpiderApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"action" | "users" | "cookie" | "running" | "done">("action")
  const [action, setAction] = useState<WeiboSpiderAction>("status")
  const [users, setUsers] = useState("")
  const [message, setMessage] = useState("Action: status, load, save, cookie, browser, crawl.")
  const [lines, setLines] = useState<string[]>([])

  async function submit(value: string) {
    if (step === "action") {
      const next = normalizeAction(value)
      setAction(next)
      if (next === "crawl") {
        setMessage("User ids.")
        setStep("users")
      } else {
        await execute(next, "", "")
      }
      return
    }
    if (step === "users") {
      setUsers(value)
      setMessage("Cookie string or JSON.")
      setStep("cookie")
      return
    }
    if (step === "cookie") await execute(action, users, value)
  }

  async function execute(nextAction: WeiboSpiderAction, nextUsers: string, cookie: string) {
    setStep("running")
    setMessage("Running...")
    const input: WeiboSpiderInput = nextAction === "crawl"
      ? { action: nextAction, userIds: nextUsers, cookie, maxPages: 1, downloadMedia: false }
      : { action: nextAction, cookie, online: false }
    const result = await runWeiboSpider(input, createNodeWeiboSpiderRuntime(), (event) => setLines((current) => [...current.slice(-8), event.message]))
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
    h(Text, { color: "cyan", bold: true }, "weibospider guided"),
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

function normalizeAction(value: string): WeiboSpiderAction {
  const action = value.trim().toLowerCase()
  if (action === "load") return "load_config"
  if (action === "save") return "save_config"
  if (action === "cookie" || action === "validate") return "validate_cookie"
  if (action === "browser") return "get_browser_cookie"
  if (action === "import") return "import_config"
  if (action === "export") return "export_config"
  if (action === "crawl") return "crawl"
  return "status"
}

function numberArg(value?: string | number): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
