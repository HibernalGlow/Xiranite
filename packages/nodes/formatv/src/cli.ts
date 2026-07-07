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
  truncateVisible,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"

import type { FormatvAction, FormatvInput, FormatvResult, FormatvRuntime } from "./core.js"
import { DEFAULT_PREFIXES, runFormatv } from "./core.js"
import { createNodeFormatvRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("formatv")

interface FormatvCliOptions {
  path?: string
  paths?: string
  recursive?: boolean
  prefixName?: string
  prefix?: string
  dryRun?: boolean
  reportPath?: string
  json?: boolean
}

interface GuidedTask {
  name: string
  description: string
  action: FormatvAction
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "path"; path: string; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`
type PathSource = "clipboard" | "manual" | "exit"

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "scan",
    description: "扫描视频文件，输出统计",
    action: "scan",
  },
  {
    name: "add-nov",
    description: "添加 .nov 后缀",
    action: "add_nov",
  },
  {
    name: "remove-nov",
    description: "移除 .nov 后缀",
    action: "remove_nov",
  },
  {
    name: "duplicates",
    description: "检查重复视频",
    action: "check_duplicates",
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Scan video folders, add/remove .nov suffixes, and check prefixed duplicates.",
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
    meta: { name: CLI_NAME, description: "Video .nov suffix and duplicate checker with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan video files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "scan", ...inputFromArgs(args as FormatvCliOptions) }, Boolean(args.json), host)
        },
      }),
      "add-nov": defineCommand({
        meta: { name: "add-nov", description: "Add .nov suffix to normal video files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "add_nov", ...inputFromArgs(args as FormatvCliOptions) }, Boolean(args.json), host)
        },
      }),
      "remove-nov": defineCommand({
        meta: { name: "remove-nov", description: "Remove .nov suffix from .nov video files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "remove_nov", ...inputFromArgs(args as FormatvCliOptions) }, Boolean(args.json), host)
        },
      }),
      duplicates: defineCommand({
        meta: { name: "duplicates", description: "Check prefixed files against original duplicates." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "check_duplicates", ...inputFromArgs(args as FormatvCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Input file or folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated paths." },
    recursive: { type: "boolean", description: "Recurse into folders." },
    prefixName: { type: "string", description: "Prefix config name, default hb." },
    prefix: { type: "string", description: "Alias for --prefixName." },
    dryRun: { type: "boolean", description: "Plan renames or skip duplicate report writing." },
    reportPath: { type: "string", description: "Duplicate report JSON path." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: FormatvCliOptions): FormatvInput {
  return {
    paths: splitArg(args.paths, args.path ? [args.path] : []),
    recursive: args.recursive,
    prefixName: args.prefixName || args.prefix,
    dryRun: args.dryRun,
    reportPath: args.reportPath,
  }
}

async function runAction(input: FormatvInput & { action: FormatvAction }, json: boolean, host: CliHost): Promise<FormatvResult> {
  let progressActive = false
  const result = await runFormatv(input, createNodeFormatvRuntime(), (event) => {
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
    return result
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeFormatvSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result
}

function writeFormatvSummary(host: CliHost, result: FormatvResult): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const divider = rich(host, "─".repeat(Math.min(70, columns - 8)), "grey")

  const lines: string[] = [
    `${rich(host, "普通", "green")}  ${data.normalCount} 个`,
    `${rich(host, "后缀", "yellow")}  ${data.novCount} 个`,
  ]

  for (const [name, count] of Object.entries(data.prefixedCounts)) {
    const prefix = DEFAULT_PREFIXES.find((item) => item.name === name)
    const label = prefix?.prefix ?? name
    const desc = prefix?.description ?? ""
    lines.push(`${rich(host, "前缀", "blue")}  ${count} 个 ${label} (${desc})`)
  }

  if (data.duplicateCount > 0 || data.prefixedLarger.length > 0) {
    lines.push(divider)
    lines.push(`${rich(host, "重复", "magenta")}  ${data.duplicateCount} 个`)
    lines.push(`${rich(host, "前缀大于原件", "red")}  ${data.prefixedLarger.length} 对`)
  }

  if (data.successCount > 0 || data.errorCount > 0 || data.skippedCount > 0) {
    lines.push(divider)
    lines.push(`${rich(host, "成功", "green")}  ${data.successCount}   ${rich(host, "跳过", "yellow")}  ${data.skippedCount}   ${rich(host, "失败", "red")}  ${data.errorCount}`)
  }

  if (data.reportPath) {
    lines.push(divider)
    lines.push(`${rich(host, "报告", "cyan")}  ${data.reportPath}`)
  }

  writeRichPanel(host, "Summary", lines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })

  for (const item of data.operations.slice(0, 50)) {
    const status = item.status === "success"
      ? rich(host, "success", "green")
      : item.status === "error"
        ? rich(host, "error", "red")
        : item.status === "skipped"
          ? rich(host, "skipped", "yellow")
          : rich(host, "planned", "cyan")
    writeLine(host, `  ${status} ${item.sourcePath} ${rich(host, "->", "grey")} ${item.targetPath}${item.reason ? ` / ${item.reason}` : ""}`)
  }
  if (data.operations.length > 50) {
    writeLine(host, rich(host, `  ... 还有 ${data.operations.length - 50} 个操作`, "grey"))
  }

  for (const item of data.duplicates.slice(0, 50)) {
    writeLine(host, `  ${rich(host, "duplicate", "magenta")} ${truncateVisible(item, columns - 6)}`)
  }
  if (data.duplicates.length > 50) {
    writeLine(host, rich(host, `  ... 还有 ${data.duplicates.length - 50} 个重复`, "grey"))
  }

  if (data.errors.length) {
    writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} scan --path <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const runtime = createNodeFormatvRuntime()
  const defaultTask = GUIDED_TASKS[0]!
  let firstRender = true

  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const choice = await readGuidedChoice(host, defaultTask, runtime)
      if (choice.kind === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const paths = choice.kind === "path" ? [choice.path] : await resolvePaths(host, runtime)
      if (!paths.length) {
        writeRichPanel(host, "Path", "未提供有效文件夹路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      const recursive = await confirmRich(host, "是否递归处理子文件夹?", false)

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        `path: ${paths.join("; ")}`,
        `recursive: ${recursive ? "yes" : "no"}`,
        "mode: direct core call, no Taskfile shell hop",
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const ok = await runGuidedTask(choice.task, paths, recursive, host)
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
  writeRichPanel(host, "Xiranite Formatv", [
    `${rich(host, "工具", "cyan")}  视频格式处理工具，扫描视频文件并管理 .nov 后缀与前缀重复检查`,
    `${rich(host, "入口", "cyan")}  内置 TypeScript guided flow`,
    `${rich(host, "执行", "cyan")}  直接调用 formatv core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  可直接粘贴路径；否则读取剪贴板，失败时再手动输入`,
    `${rich(host, "递归", "cyan")}  默认只处理当前层级，确认后可递归子文件夹`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认使用 hb 前缀检查重复；需要预演请用 \`${CLI_NAME} add-nov --dry-run\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask, runtime: FormatvRuntime): Promise<ResolvedGuidedChoice> {
  const directPath = cleanPath(await promptRich(host, "粘贴文件夹路径直接执行扫描；留空进入任务选择", ""))
  if (directPath) {
    const info = await runtime.pathInfo(directPath)
    if (info.exists && (info.isDirectory || info.isFile)) return { kind: "path", path: info.path, task: defaultTask }
    writeRichPanel(host, "Path", `不是有效路径: ${directPath}`, { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 formatv 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入路径，并使用默认 scan 任务" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 8 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") {
    const answer = await promptRich(host, "输入文件夹路径", "")
    const [path] = await validPaths(splitPaths(answer), runtime)
    if (path) return { kind: "path", path, task: defaultTask }
    writeRichPanel(host, "Path", "未提供有效路径。", { color: "yellow", minWidth: 48 })
    return { kind: "task", task: defaultTask }
  }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolvePaths(host: CliHost, runtime: FormatvRuntime): Promise<string[]> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的多行路径" },
      { value: "manual", label: "手动输入路径", hint: "每行一个，空行结束" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return []
  }

  if (source === "clipboard") {
    const clipboard = (await readClipboardText()).trim()
    if (!clipboard) {
      writeRichPanel(host, "Clipboard", "剪贴板为空，请改用手动输入。", { color: "yellow", minWidth: 48 })
      return []
    }
    const paths = splitPaths(clipboard)
    if (!paths.length) {
      writeRichPanel(host, "Clipboard", "剪贴板中未找到有效路径。", { color: "yellow", minWidth: 48 })
      return []
    }
    const verified = await validPaths(paths, runtime)
    if (!verified.length) {
      writeRichPanel(host, "Clipboard", "剪贴板中的路径均不存在。", { color: "red", minWidth: 48 })
      return []
    }
    writeLine(host, rich(host, `已从剪贴板读取 ${verified.length} 个有效路径。`, "yellow"))
    for (const path of verified) writeLine(host, rich(host, `  ${path}`, "green"))
    return verified
  }

  const answer = (await promptRich(host, "输入要处理的文件夹路径，用分号或换行分隔", "")).trim()
  if (!answer) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return []
  }
  const paths = splitPaths(answer)
  const verified = await validPaths(paths, runtime)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在。", { color: "red", minWidth: 48 })
    return []
  }
  return verified
}

async function runGuidedTask(task: GuidedTask, paths: string[], recursive: boolean, host: CliHost): Promise<boolean> {
  const input: FormatvInput & { action: FormatvAction } = {
    action: task.action,
    paths,
    recursive,
    prefixName: "hb",
  }
  const result = await runAction(input, false, host)
  return result.success
}

async function validPaths(candidates: string[], runtime: FormatvRuntime): Promise<string[]> {
  const paths: string[] = []
  for (const candidate of candidates) {
    const info = await runtime.pathInfo(candidate)
    if (info.exists && (info.isDirectory || info.isFile)) paths.push(info.path)
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

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
