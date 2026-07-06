#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  nodeCliName,
  padVisibleEnd,
  promptRich,
  renderProgressBar,
  rich,
  runMain,
  terminalColumns,
  truncateVisible,
  visibleWidth,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { RepackuAction, RepackuInput, RepackuOperation, RepackuResult, RepackuRuntime } from "./core.js"
import { runRepacku } from "./core.js"
import { createNodeRepackuRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("repacku")


interface RepackuCliOptions {
  path?: string
  paths?: string
  config?: string
  configPath?: string
  types?: string
  output?: string
  outputPath?: string
  clipboard?: boolean
  deleteAfter?: boolean
  dryRun?: boolean
  gallery?: boolean
  json?: boolean
  minCount?: string | number
  galleryMarker?: string
  single?: boolean
}

interface GuidedTask {
  name: string
  description: string
  inputs: Array<Omit<RepackuInput, "path" | "paths">>
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "invalid"; value: string }
  | { kind: "path"; path: string; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "image-only",
    description: "图片规则压缩，默认读取剪贴板路径，成功后删除源文件",
    inputs: [{ action: "compress", types: "image", deleteAfter: true }],
  },
  {
    name: "gallery-pack",
    description: "查找画集目录并批量执行单层打包",
    inputs: [{ action: "gallery-pack", deleteAfter: true }],
  },
  {
    name: "gallery-and-single",
    description: "先处理画集目录，再处理当前目录单层打包",
    inputs: [
      { action: "gallery-pack", deleteAfter: true },
      { action: "single-pack", deleteAfter: true },
    ],
  },
  {
    name: "single-pack",
    description: "对子目录和散图执行单层打包",
    inputs: [{ action: "single-pack", deleteAfter: true }],
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Analyze folder trees and repack folders into zip archives.",
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
    meta: { name: CLI_NAME, description: "Folder repacking workflow with built-in guided mode." },
    subCommands: {
      analyze: defineCommand({
        meta: { name: "analyze", description: "Analyze a folder and write a repacku config JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("analyze", args as RepackuCliOptions, host)
        },
      }),
      compress: defineCommand({
        meta: { name: "compress", description: "Compress from an existing config, or run gallery/single pack modes." },
        args: commonArgs(),
        async run({ args }) {
          await runCompressCommand(args as RepackuCliOptions, host)
        },
      }),
      full: defineCommand({
        meta: { name: "full", description: "Analyze and then compress in one flow." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("full", args as RepackuCliOptions, host)
        },
      }),
      "single-pack": defineCommand({
        meta: { name: "single-pack", description: "Pack first-level child folders and loose image files." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("single-pack", args as RepackuCliOptions, host)
        },
      }),
      "gallery-pack": defineCommand({
        meta: { name: "gallery-pack", description: "Find gallery folders and run single-pack in each one." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("gallery-pack", args as RepackuCliOptions, host)
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Open the guided repacku workflow." },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

function commonArgs() {
  return {
    path: { type: "string", description: "Folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated folder paths." },
    config: { type: "string", description: "Config JSON path." },
    configPath: { type: "string", description: "Config JSON path." },
    types: { type: "string", description: "Target file types, comma separated, for example image,document." },
    output: { type: "string", description: "Config output path." },
    outputPath: { type: "string", description: "Config output path." },
    clipboard: { type: "boolean", description: "Read folder path from clipboard when --path is omitted." },
    deleteAfter: { type: "boolean", description: "Delete source files after successful compression." },
    dryRun: { type: "boolean", description: "Plan operations without writing archives." },
    gallery: { type: "boolean", description: "Compatibility alias for gallery-pack under compress." },
    single: { type: "boolean", description: "Compatibility alias for single-pack under compress." },
    minCount: { type: "string", description: "Minimum matching direct files before compression." },
    galleryMarker: { type: "string", description: "Folder name marker used by gallery-pack." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use `xrepacku compress --path <folder>` for scripted use.")
    process.exitCode = 2
    return
  }

  const runtime = createNodeRepackuRuntime()
  const defaultTask = GUIDED_TASKS[0]!
  let firstRender = true
  try {
    while (true) {
      renderGuidedSelector(host, firstRender)
      firstRender = false

      const rawChoice = await promptRich(host, `选择任务、输入任务名，或粘贴路径 ${rich(host, "[0/1/2/3/4]", "magenta")}`, "1")
      const choice = await resolveGuidedChoice(rawChoice, defaultTask, runtime)
      if (choice.kind === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }
      if (choice.kind === "invalid") {
        writeRichPanel(host, "Input", `无法识别: ${choice.value}`, { color: "red", minWidth: 48 })
        continue
      }

      const paths = choice.kind === "path" ? [choice.path] : await resolveGuidedPaths(host, runtime)
      if (!paths.length) {
        writeRichPanel(host, "Path", "未提供有效文件夹路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        `path: ${paths.join("; ")}`,
        "mode: direct core call, no Taskfile shell hop",
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const ok = await runGuidedTask(choice.task, paths, host)
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

function renderGuidedSelector(host: CliHost, includeHeader: boolean): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  writeRichPanel(host, "Xiranite Repacku", [
    `${rich(host, "入口", "cyan")}  内置 TypeScript guided flow`,
    `${rich(host, "执行", "cyan")}  直接调用 repacku core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  可直接粘贴路径；否则读取剪贴板，失败时再手动输入`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, "可执行任务", "white", "bold"))
  GUIDED_TASKS.forEach((task, index) => {
    writeLine(host, renderGuidedTaskRow(host, task, index + 1, index === 0))
  })
  writeLine(host, renderGuidedTaskRow(host, { name: "exit", description: "离开引导模式", inputs: [] }, 0, false))
  writeLine(host)
  writeLine(host, rich(host, "提示: guided 默认保持原 repacku 习惯，成功后删除源文件；需要预演请用 `xrepacku compress --dry-run`。", "grey"))
}

function renderGuidedTaskRow(host: CliHost, task: GuidedTask, index: number, isDefault: boolean): string {
  const columns = terminalColumns(host)
  const number = padVisibleEnd(rich(host, String(index).padStart(2), "cyan"), 4)
  const name = padVisibleEnd(rich(host, task.name, isDefault ? "green" : "white"), 26)
  const badge = isDefault ? rich(host, "default", "yellow") : ""
  const badgeCell = padVisibleEnd(badge, 9)
  const prefix = `  ${number}${name}${badgeCell}`
  const descWidth = Math.max(0, columns - visibleWidth(prefix) - 1)
  return `${prefix}${rich(host, truncateVisible(task.description, descWidth), index === 0 ? "grey" : "white")}`
}

async function resolveGuidedChoice(rawChoice: string, defaultTask: GuidedTask, runtime: RepackuRuntime): Promise<ResolvedGuidedChoice> {
  const text = cleanPath(rawChoice)
  if (!text) return { kind: "task", task: defaultTask }
  if (/^\d+$/.test(text)) {
    const index = Number(text)
    if (index === 0) return { kind: "exit" }
    const task = GUIDED_TASKS[index - 1]
    return task ? { kind: "task", task } : { kind: "invalid", value: rawChoice }
  }

  const namedTask = GUIDED_TASKS.find((task) => task.name.toLowerCase() === text.toLowerCase())
  if (namedTask) return { kind: "task", task: namedTask }

  const info = await runtime.pathInfo(text)
  if (info.exists && info.isDirectory) return { kind: "path", path: info.path, task: defaultTask }
  return { kind: "invalid", value: rawChoice }
}

async function resolveGuidedPaths(host: CliHost, runtime: RepackuRuntime): Promise<string[]> {
  const clipboardPaths = await pathsFromClipboard(runtime)
  if (clipboardPaths.length) {
    writeLine(host, rich(host, `已从剪贴板读取 ${clipboardPaths.length} 个路径。`, "yellow"))
    return clipboardPaths
  }

  const answer = await promptRich(host, "输入文件夹路径", "")
  return await validDirectoryPaths(splitPaths(answer), runtime)
}

async function runGuidedTask(task: GuidedTask, paths: string[], host: CliHost): Promise<boolean> {
  const inputs = task.inputs.flatMap((input) => paths.map((path) => ({ ...input, paths: [path] })))
  return await runActions(inputs, false, host)
}

async function runSingleAction(action: RepackuAction, args: RepackuCliOptions, host: CliHost): Promise<boolean> {
  const input = await inputFromArgs(args)
  return await runActions([{ action, ...input }], Boolean(args.json), host)
}

async function runCompressCommand(args: RepackuCliOptions, host: CliHost): Promise<boolean> {
  const input = await inputFromArgs(args)
  const actions: RepackuAction[] = []
  if (args.gallery) actions.push("gallery-pack")
  if (args.single) actions.push("single-pack")
  if (!actions.length) actions.push("compress")
  return await runActions(actions.map((action) => ({ action, ...input })), Boolean(args.json), host)
}

async function inputFromArgs(args: RepackuCliOptions): Promise<Omit<RepackuInput, "action">> {
  let paths = splitPaths(args.paths, args.path ? [args.path] : [])
  if (args.clipboard && !paths.length) {
    paths = await pathsFromClipboard()
  }

  return {
    paths,
    configPath: args.configPath || args.config,
    types: args.types,
    outputPath: args.outputPath || args.output,
    deleteAfter: args.deleteAfter,
    dryRun: args.dryRun,
    minCount: numberArg(args.minCount),
    galleryMarker: args.galleryMarker,
  }
}

async function runActions(inputs: RepackuInput[], json: boolean, host: CliHost): Promise<boolean> {
  if (json && inputs.length > 1) {
    const results = await Promise.all(inputs.map((input) => runRepacku(input, createNodeRepackuRuntime())))
    writeJson(host, results)
    if (results.some((result) => !result.success)) process.exitCode = 1
    return results.every((result) => result.success)
  }

  let ok = true
  for (const input of inputs) {
    const result = await runAction(input, json, host)
    ok = ok && result.success
    if (!result.success) break
  }
  return ok
}

async function runAction(input: RepackuInput, json: boolean, host: CliHost): Promise<RepackuResult> {
  let progressActive = false
  const result = await runRepacku(input, createNodeRepackuRuntime(), (event) => {
    if (json) return
    if (event.type === "progress") {
      writeProgress(host, renderProgressBar(host, event.progress ?? 0, event.message, { label: "repacku" }))
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
    return result
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  const data = result.data
  if (data) {
    writeRichPanel(host, "Summary", [
      data.configPath ? `config: ${data.configPath}` : "",
      `folders: ${data.totalFolders}  entire: ${data.entireCount}  selective: ${data.selectiveCount}  skip: ${data.skipCount}`,
      `operations: ${data.totalOperations}  planned: ${data.plannedCount}  compressed: ${data.compressedCount}  failed: ${data.failedCount}  skipped: ${data.skippedCount}`,
    ].filter(Boolean), { color: result.success ? "green" : "yellow", minWidth: 76 })
    for (const operation of data.operations.slice(0, 80)) writeLine(host, formatOperation(operation, host))
    if (data.operations.length > 80) writeLine(host, rich(host, `... ${data.operations.length - 80} more operation(s)`, "grey"))
    if (data.errors.length) writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })
  }
  if (!result.success) process.exitCode = 1
  return result
}

async function pathsFromClipboard(runtime: RepackuRuntime = createNodeRepackuRuntime()): Promise<string[]> {
  const text = await readClipboardText()
  if (!text) return []
  return await validDirectoryPaths(splitPaths(text), runtime)
}

async function validDirectoryPaths(candidates: string[], runtime: RepackuRuntime): Promise<string[]> {
  const paths: string[] = []
  for (const candidate of candidates) {
    const info = await runtime.pathInfo(candidate)
    if (info.exists && info.isDirectory) paths.push(info.path)
  }
  return paths
}

function splitPaths(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)]
    .map(cleanPath)
    .filter(Boolean)
}

function cleanPath(value = ""): string {
  return value.trim().replace(/^["']|["']$/g, "")
}

function numberArg(value?: number | string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
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

function formatOperation(operation: RepackuOperation, host: CliHost): string {
  const extensions = operation.extensions.length ? ` [${operation.extensions.join(",")}]` : ""
  const status = operation.status === "success"
    ? rich(host, "success", "green")
    : operation.status === "error"
      ? rich(host, "error", "red")
      : operation.status === "skipped"
        ? rich(host, "skipped", "yellow")
        : rich(host, "planned", "cyan")
  const mode = rich(host, operation.mode, operation.mode === "entire" ? "blue" : "magenta")
  if (!host.stdout.isTTY) return `${status} ${mode}${extensions} ${operation.sourcePath} ${rich(host, "->", "grey")} ${operation.targetPath}`

  const prefix = `${status} ${mode}${extensions} `
  const arrow = ` ${rich(host, "->", "grey")} `
  const pathBudget = Math.max(0, terminalColumns(host) - visibleWidth(prefix) - visibleWidth(arrow))
  if (pathBudget < 20) return `${prefix}${truncateVisible(operation.sourcePath, pathBudget)}`

  const sourceWidth = Math.max(8, Math.floor(pathBudget * 0.48))
  const targetWidth = Math.max(0, pathBudget - sourceWidth)
  return `${prefix}${truncateVisible(operation.sourcePath, sourceWidth)}${arrow}${truncateVisible(operation.targetPath, targetWidth)}`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
