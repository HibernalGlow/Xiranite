#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  nodeCliName,
  promptRich,
  renderProgressBar,
  rich,
  runMain,
  selectRich,
  terminalColumns,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"

import type { RecycleuAction, RecycleuInput, RecycleuResult } from "./core.js"
import { normalizeDriveLetter, runRecycleu } from "./core.js"
import { createNodeRecycleuRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("recycleu")

interface RecycleuCliOptions {
  drive?: string
  interval?: string | number
  cycles?: string | number
  json?: boolean
}

interface GuidedTask {
  name: string
  description: string
  input: Omit<RecycleuInput, "driveLetter">
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "auto-clean",
    description: "按间隔自动清理回收站，可配置间隔与循环次数",
    input: { action: "start", interval: 10, maxCycles: 360 },
  },
  {
    name: "clean-now",
    description: "立即清空回收站一次",
    input: { action: "clean_now" },
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
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
      name: CLI_NAME,
      description: "Recycle bin cleaner with a Clack guided mode and Typer-style commands.",
    },
    subCommands: {
      status: defineCommand({
        meta: { name: "status", description: "Print current cleaner status." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "status" }, Boolean(args.json), host)
        },
      }),
      clean: defineCommand({
        meta: { name: "clean", description: "Empty the recycle bin once." },
        args: commonArgs(),
        async run({ args }) {
          await runAction(inputFromArgs(args as RecycleuCliOptions, "clean_now"), Boolean(args.json), host)
        },
      }),
      start: defineCommand({
        meta: { name: "start", description: "Run auto-clean for a bounded number of cycles." },
        args: commonArgs(),
        async run({ args }) {
          await runAction(inputFromArgs(args as RecycleuCliOptions, "start"), Boolean(args.json), host)
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
    drive: { type: "string", description: "Limit cleanup to one drive letter, for example C." },
    interval: { type: "string", default: "10", description: "Clean interval in seconds, minimum 5." },
    cycles: { type: "string", default: "360", description: "Maximum clean cycles." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: RecycleuCliOptions, action: RecycleuAction): RecycleuInput {
  return {
    action,
    interval: Number(args.interval ?? 10),
    maxCycles: Number(args.cycles ?? 360),
    driveLetter: String(args.drive ?? ""),
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} clean --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  let firstRender = true
  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const choice = await readGuidedChoice(host)
      if (choice.kind === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const input = await resolveTaskInput(host, choice.task)

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        input.driveLetter ? `drive: ${input.driveLetter}:` : "drive: all",
        ...(choice.task.name === "auto-clean" ? [`interval: ${input.interval}s`, `cycles: ${input.maxCycles}`] : []),
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const confirmed = await confirmRich(host, `确认执行 ${choice.task.name}?`, true)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const ok = await runGuidedTask(input, host)
      if (!ok) process.exitCode = 1
      if (!await confirmRich(host, "继续选择其他任务?", false)) return
    }
  } catch (error) {
    if (error instanceof CliPromptExitError) {
      writeLine(host, rich(host, "已退出。", "yellow"))
      return
    }
    throw error
  }
}

function renderGuidedIntro(host: CliHost, includeHeader: boolean): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  writeRichPanel(host, "Xiranite Recycleu", [
    `${rich(host, "入口", "cyan")}  回收站清理工具，提供立即清理与定时自动清理两种模式`,
    `${rich(host, "执行", "cyan")}  直接调用 recycleu core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "间隔", "cyan")}  默认 10 秒，最小 5 秒，自动清理可配置循环次数`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: 自动清理会持续运行直到完成；需要查看状态请用 \`${CLI_NAME} status --json\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost): Promise<ResolvedGuidedChoice> {
  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 recycleu 任务",
    [
      ...GUIDED_TASKS.map((task) => ({ value: `task:${task.name}` as GuidedSelection, label: task.name, hint: task.description })),
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${GUIDED_TASKS[0]!.name}`, maxItems: 6 },
  )

  if (selection === "exit") return { kind: "exit" }
  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? GUIDED_TASKS[0]! }
}

async function resolveTaskInput(host: CliHost, task: GuidedTask): Promise<RecycleuInput> {
  const input: RecycleuInput = { ...task.input }
  if (task.name === "auto-clean") {
    input.interval = await resolveInterval(host, task.input.interval ?? 10)
    input.maxCycles = await resolveCycles(host, task.input.maxCycles ?? 360)
  }
  input.driveLetter = await resolveDriveLetter(host)
  return input
}

async function resolveInterval(host: CliHost, defaultValue: number): Promise<number> {
  const answer = await promptRich(host, "清理间隔秒数，最小 5", String(defaultValue))
  const parsed = Number(answer)
  return Number.isFinite(parsed) ? Math.max(5, Math.floor(parsed)) : defaultValue
}

async function resolveCycles(host: CliHost, defaultValue: number): Promise<number> {
  const answer = await promptRich(host, "最大循环次数", String(defaultValue))
  const parsed = Number(answer)
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : defaultValue
}

async function resolveDriveLetter(host: CliHost): Promise<string> {
  const wantsDrive = await confirmRich(host, "是否限定到某个驱动器?", false)
  if (!wantsDrive) return ""
  const clipboard = (await readClipboardText()).trim()
  const clipboardDrive = normalizeDriveLetter(clipboard)
  const answer = (await promptRich(host, "输入盘符，例如 C 或 D", clipboardDrive)).trim()
  return normalizeDriveLetter(answer)
}

async function runGuidedTask(input: RecycleuInput, host: CliHost): Promise<boolean> {
  let progressActive = false
  const result = await runRecycleu(input, createNodeRecycleuRuntime(), (event) => {
    if (event.type === "progress") {
      writeProgress(host, renderProgressBar(host, event.progress ?? 0, event.message, { label: CLI_NAME }))
      progressActive = true
      return
    }
    endProgress(host, progressActive)
    progressActive = false
    if (event.message.trim()) writeLine(host, rich(host, event.message, "grey"))
  })
  endProgress(host, progressActive)

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeRecycleuSummary(host, result)
  if (!result.success) return false
  return true
}

async function runAction(input: RecycleuInput, json: boolean, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runRecycleu(input, createNodeRecycleuRuntime(), (event) => {
    if (json) return
    if (event.type === "progress") {
      writeProgress(host, renderProgressBar(host, event.progress ?? 0, event.message, { label: CLI_NAME }))
      progressActive = true
      return
    }
    endProgress(host, progressActive)
    progressActive = false
    if (event.message.trim()) writeLine(host, rich(host, event.message, "grey"))
  })
  endProgress(host, progressActive)

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeRecycleuSummary(host, result)
  if (!result.success) process.exitCode = 1
}

function writeRecycleuSummary(host: CliHost, result: RecycleuResult): void {
  const data = result.data
  if (!data) return
  writeRichPanel(host, "Summary", [
    `status: ${data.timerStatus}  cleaned: ${data.cleanCount}  remaining: ${data.remainingSeconds}s`,
    data.lastCleanTime ? `last clean: ${data.lastCleanTime}` : "last clean: -",
  ], { color: result.success ? "green" : "yellow", minWidth: 56 })
}

function writeProgress(host: CliHost, line: string): void {
  if (host.stdout.isTTY) {
    host.stdout.write(`\r\u001b[2K${line}`)
    return
  }
  writeLine(host, line)
}

function endProgress(host: CliHost, active: boolean): void {
  if (active && host.stdout.isTTY) host.stdout.write("\n")
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
