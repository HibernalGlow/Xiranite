#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  hasPipedInput,
  nodeCliName,
  promptPathLines,
  promptRich,
  readStdinText,
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
import { loadNodeConfigWithHints } from "@xiranite/config"

import type { TrenameAction, TrenameInput, TrenameOperation, TrenameResult, TrenameRuntime } from "./core.js"
import { runTrename } from "./core.js"
import { createNodeTrenameRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("trename")

interface TrenameNodeConfig {
  enable_undo?: boolean
  undo_path?: string
}

interface TrenameDefaults {
  enableUndo: boolean
  undoPath?: string
}

/**
 * Read trename defaults from xiranite.config.toml [nodes.trename] section.
 * - enable_undo: whether undo/history actions are allowed (default true)
 * - undo_path: default undo store path when --undoPath is not provided
 * Missing config file or section is treated as defaults (enableUndo=true, no override).
 */
async function resolveTrenameDefaults(host: CliHost, json: boolean): Promise<TrenameDefaults> {
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<TrenameNodeConfig>("trename", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      enableUndo: nodeConfig?.enable_undo !== false,
      undoPath: nodeConfig?.undo_path?.trim() || undefined,
    }
  } catch {
    return { enableUndo: true }
  }
}

interface TrenameCliOptions {
  path?: string
  paths?: string
  input?: string
  inputFile?: string
  output?: string
  base?: string
  basePath?: string
  includeHidden?: boolean
  hidden?: boolean
  includeRoot?: boolean
  noRoot?: boolean
  exclude?: string
  excludeExts?: string
  excludePattern?: string
  excludePatterns?: string
  split?: string | number
  maxLines?: string | number
  compact?: boolean
  mode?: "normal" | "leak"
  dryRun?: boolean
  execute?: boolean
  batchId?: string
  undoPath?: string
  jsonContent?: string
  json?: boolean
}

interface GuidedTask {
  name: string
  description: string
  action: TrenameAction
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "paths"; paths: string[]; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "scan",
    description: "扫描目录生成 rename JSON，默认读取剪贴板路径",
    action: "scan",
  },
  {
    name: "rename",
    description: "从剪贴板读取 JSON 并执行批量重命名（先预览再确认）",
    action: "rename",
  },
  {
    name: "undo",
    description: "撤销最近一次重命名操作",
    action: "undo",
  },
  {
    name: "history",
    description: "查看重命名操作历史",
    action: "history",
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Batch rename JSON workflow for scan, validate, rename, and undo.",
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
    meta: { name: CLI_NAME, description: "Batch rename JSON workflow with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan folders into rename JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("scan", args as TrenameCliOptions, host)
        },
      }),
      import: defineCommand({
        meta: { name: "import", description: "Import and count rename JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("import", args as TrenameCliOptions, host)
        },
      }),
      validate: defineCommand({
        meta: { name: "validate", description: "Validate rename JSON against the filesystem." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("validate", args as TrenameCliOptions, host)
        },
      }),
      rename: defineCommand({
        meta: { name: "rename", description: "Plan or execute batch rename." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("rename", args as TrenameCliOptions, host)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo a previous executed rename batch." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("undo", args as TrenameCliOptions, host)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "List undo batches." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("history", args as TrenameCliOptions, host)
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
    path: { type: "string", description: "Folder path." },
    paths: { type: "string", description: "One or more paths. Quoted paths are supported." },
    input: { type: "string", description: "JSON input file." },
    inputFile: { type: "string", description: "JSON input file." },
    output: { type: "string", description: "Write scan JSON to this file." },
    base: { type: "string", description: "Base path for validate/rename." },
    basePath: { type: "string", description: "Base path for validate/rename." },
    includeHidden: { type: "boolean", description: "Include hidden files." },
    hidden: { type: "boolean", description: "Alias for --includeHidden." },
    includeRoot: { type: "boolean", description: "Include scanned folder as root node." },
    noRoot: { type: "boolean", description: "Scan children directly." },
    exclude: { type: "string", description: "Comma-separated excluded extensions." },
    excludeExts: { type: "string", description: "Comma-separated excluded extensions." },
    excludePattern: { type: "string", description: "Comma-separated excluded name patterns." },
    excludePatterns: { type: "string", description: "Comma-separated excluded name patterns." },
    split: { type: "string", description: "Max JSON lines per segment." },
    maxLines: { type: "string", description: "Max JSON lines per segment." },
    compact: { type: "boolean", description: "Use compact JSON output." },
    mode: { type: "string", description: "Scan mode: normal or leak." },
    dryRun: { type: "boolean", description: "Preview file operations." },
    execute: { type: "boolean", description: "Execute rename instead of dry-run." },
    batchId: { type: "string", description: "Undo batch id." },
    undoPath: { type: "string", description: "Undo JSON store path." },
    jsonContent: { type: "string", description: "Inline rename JSON content." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function runSingleAction(action: TrenameAction, args: TrenameCliOptions, host: CliHost): Promise<boolean> {
  const defaults = await resolveTrenameDefaults(host, Boolean(args.json))

  if (!defaults.enableUndo && (action === "undo" || action === "history")) {
    writeLine(host, rich(host, "Undo 功能已被配置禁用（[nodes.trename] enable_undo = false）。", "yellow"))
    process.exitCode = 1
    return false
  }

  const input = await inputFromArgs(action, args, defaults, host)
  const result = await runAction(input, Boolean(args.json), host)
  if (args.output && action === "scan" && result.success) await writeSegments(args.output, result.data?.segments ?? [])
  return result.success
}

async function runAction(input: TrenameInput, json: boolean, host: CliHost): Promise<TrenameResult> {
  let progressActive = false
  const result = await runTrename(input, createNodeTrenameRuntime(), (event) => {
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
  writeTrenameSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result
}

async function inputFromArgs(action: TrenameAction, args: TrenameCliOptions, defaults: TrenameDefaults, host: CliHost): Promise<TrenameInput> {
  const inputFile = args.inputFile || args.input
  let jsonContent = args.jsonContent
  if (jsonContent === undefined) {
    if (inputFile === "-" || (!inputFile && hasPipedInput(host.stdin))) {
      jsonContent = await readStdinText(host.stdin)
    } else if (inputFile) {
      jsonContent = await readFile(inputFile, "utf8")
    } else {
      jsonContent = ""
    }
  }
  return {
    action,
    paths: args.paths || args.path,
    includeHidden: args.includeHidden ?? args.hidden,
    includeRoot: args.noRoot ? false : args.includeRoot,
    excludeExts: args.excludeExts || args.exclude,
    excludePatterns: args.excludePatterns || args.excludePattern,
    maxLines: numberArg(args.maxLines ?? args.split),
    compact: args.compact,
    mode: args.mode === "leak" ? "leak" : "normal",
    jsonContent,
    basePath: args.basePath || args.base,
    dryRun: args.execute ? false : args.dryRun ?? true,
    batchId: args.batchId,
    undoPath: args.undoPath ?? defaults.undoPath,
  }
}

async function writeSegments(output: string, segments: string[]): Promise<void> {
  if (segments.length <= 1) {
    await writeFile(output, `${segments[0] ?? ""}\n`, "utf8")
    return
  }
  const dot = output.lastIndexOf(".")
  const base = dot >= 0 ? output.slice(0, dot) : output
  const ext = dot >= 0 ? output.slice(dot) : ".json"
  await Promise.all(segments.map((segment, index) => writeFile(`${base}_${index + 1}${ext}`, `${segment}\n`, "utf8")))
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} scan --path <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const runtime = createNodeTrenameRuntime()
  const defaults = await resolveTrenameDefaults(host, false)
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

      const needsPaths = choice.task.action === "scan"
      const paths = choice.kind === "paths"
        ? choice.paths
        : needsPaths ? await resolvePaths(host, runtime) : []

      if (needsPaths && !paths.length) {
        writeRichPanel(host, "Path", "未提供有效文件夹路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        paths.length ? `path: ${paths.join("; ")}` : "",
        "mode: direct core call, no Taskfile shell hop",
      ].filter(Boolean), { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const ok = await runGuidedTask(choice.task, paths, host, defaults)
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
  writeRichPanel(host, "Xiranite Trename", [
    `${rich(host, "入口", "cyan")}  文件批量重命名工具，提供扫描、重命名、撤销和历史功能`,
    `${rich(host, "执行", "cyan")}  直接调用 trename core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；扫描默认包含根节点`,
    `${rich(host, "JSON", "cyan")}  重命名从剪贴板读取 JSON；先预览再确认执行`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认保持原 trename 习惯，扫描结果复制到剪贴板；需要预演请用 \`${CLI_NAME} rename --dry-run\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask, runtime: TrenameRuntime): Promise<ResolvedGuidedChoice> {
  const first = cleanPath(await promptRich(host, "粘贴文件夹路径直接执行扫描（可逐行输入多个）；留空进入任务选择", ""))
  if (first) {
    const inputs: string[] = [first]
    writeLine(host, rich(host, "继续输入路径，逐行回车；直接回车空行结束。", "grey"))
    while (true) {
      const suffix = ` (已收集 ${inputs.length} 条，留空结束)`
      const answer = cleanPath(await promptRich(host, `输入下一个路径${suffix}`, ""))
      if (!answer) break
      if (!inputs.includes(answer)) inputs.push(answer)
    }
    const verified = await validDirectoryPaths(inputs, runtime)
    if (verified.length) return { kind: "paths", paths: verified, task: defaultTask }
    writeRichPanel(host, "Path", "输入的路径均无效，进入任务选择。", { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 trename 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入路径并执行扫描" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 8 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") return { kind: "task", task: defaultTask }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolvePaths(host: CliHost, runtime: TrenameRuntime): Promise<string[]> {
  const clipboardPaths = await pathsFromClipboard(runtime)
  if (clipboardPaths.length) {
    writeLine(host, rich(host, `已从剪贴板读取 ${clipboardPaths.length} 个路径。`, "yellow"))
    for (const path of clipboardPaths) writeLine(host, rich(host, `  ${path}`, "green"))
    return clipboardPaths
  }

  const inputs = await promptPathLines(host, "输入要扫描的文件夹路径")
  return await validDirectoryPaths(inputs, runtime)
}

async function runGuidedTask(task: GuidedTask, paths: string[], host: CliHost, defaults: TrenameDefaults): Promise<boolean> {
  if (task.action === "scan") {
    return (await runAction({ action: "scan", paths }, false, host)).success
  }
  if (task.action === "rename") {
    return await runGuidedRename(host, defaults)
  }
  if (task.action === "undo" || task.action === "history") {
    if (!defaults.enableUndo) {
      writeLine(host, rich(host, "Undo 功能已被配置禁用（[nodes.trename] enable_undo = false）。", "yellow"))
      return false
    }
    return (await runAction({ action: task.action, undoPath: defaults.undoPath }, false, host)).success
  }
  return false
}

async function runGuidedRename(host: CliHost, defaults: TrenameDefaults): Promise<boolean> {
  const jsonContent = await resolveJsonContent(host)
  if (!jsonContent) {
    writeLine(host, rich(host, "未提供有效 JSON 内容。", "yellow"))
    return false
  }

  const basePath = (await promptRich(host, "输入基础路径（留空使用当前目录）", "")).trim() || process.cwd()

  writeLine(host)
  writeRichPanel(host, "Preview", [
    `base: ${basePath}`,
    "mode: dry-run preview",
  ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

  const previewResult = await runAction({ action: "rename", jsonContent, basePath, dryRun: true }, false, host)
  if (!previewResult.success) return false

  const operationCount = previewResult.data?.successCount ?? 0
  if (operationCount === 0) {
    writeLine(host, rich(host, "没有可重命名的项目。", "yellow"))
    return false
  }

  const confirmed = await confirmRich(host, `确认执行 ${operationCount} 个重命名操作?`, true)
  if (!confirmed) {
    writeLine(host, rich(host, "用户取消了重命名操作。", "yellow"))
    return false
  }

  return (await runAction({ action: "rename", jsonContent, basePath, dryRun: false, undoPath: defaults.undoPath }, false, host)).success
}

async function resolveJsonContent(host: CliHost): Promise<string> {
  const clipboard = (await readClipboardText()).trim()
  if (clipboard.startsWith("{")) {
    writeLine(host, rich(host, "已从剪贴板读取 JSON 内容。", "yellow"))
    return clipboard
  }

  const answer = (await promptRich(host, "输入 JSON 文件路径或直接粘贴 JSON 内容", "")).trim()
  if (!answer) return ""
  if (answer.startsWith("{")) return answer
  try {
    return await readFile(answer, "utf8")
  } catch {
    writeLine(host, rich(host, `无法读取文件: ${answer}`, "red"))
    return ""
  }
}

function writeTrenameSummary(host: CliHost, result: TrenameResult): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const summaryLines = [
    `总计: ${rich(host, String(data.totalItems), "green")}  待翻译: ${rich(host, String(data.pendingCount), "yellow")}  可重命名: ${rich(host, String(data.readyCount), "green")}`,
    `成功: ${rich(host, String(data.successCount), "green")}  失败: ${rich(host, String(data.failedCount), "red")}  跳过: ${rich(host, String(data.skippedCount), "yellow")}`,
  ]
  if (data.basePath) summaryLines.push(`基础路径: ${data.basePath}`)
  if (data.operationId) summaryLines.push(`操作 ID: ${rich(host, data.operationId, "cyan")}`)
  writeRichPanel(host, "执行总结", summaryLines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })

  if (data.operations.length) {
    writeLine(host)
    writeLine(host, rich(host, "操作详情：", "cyan"))
    for (const operation of data.operations.slice(0, 30)) writeLine(host, `  ${formatOperation(operation, host)}`)
    if (data.operations.length > 30) writeLine(host, rich(host, `  ... 还有 ${data.operations.length - 30} 个操作`, "grey"))
  }

  if (data.conflicts.length) {
    writeLine(host)
    writeLine(host, rich(host, `冲突详情 (${data.conflicts.length})：`, "yellow"))
    for (const conflict of data.conflicts.slice(0, 30)) writeLine(host, `  ${rich(host, "•", "red")} ${conflict.message}`)
    if (data.conflicts.length > 30) writeLine(host, rich(host, `  ... 还有 ${data.conflicts.length - 30} 个冲突`, "grey"))
  }

  if (data.history.length) {
    writeLine(host)
    writeLine(host, rich(host, "操作历史：", "cyan"))
    for (const batch of data.history.slice(0, 20)) {
      const status = batch.undone ? rich(host, "已撤销", "grey") : rich(host, "活跃", "green")
      writeLine(host, `  ${rich(host, batch.id, "cyan")}  ${status}  ${batch.operations.length} 项  ${batch.timestamp}`)
    }
  }

  if (data.segments.length && data.jsonContent) {
    writeLine(host)
    writeLine(host, rich(host, "JSON 预览：", "cyan"))
    const previewLines = data.jsonContent.split("\n").slice(0, 12)
    for (const line of previewLines) writeLine(host, rich(host, `  ${truncateVisible(line, columns - 4)}`, "grey"))
    if (data.jsonContent.split("\n").length > 12) writeLine(host, rich(host, "  ...", "grey"))
  }
}

function formatOperation(operation: TrenameOperation, host: CliHost): string {
  if (!host.stdout.isTTY) return `${operation.originalPath} -> ${operation.newPath}`
  const columns = terminalColumns(host)
  const arrow = rich(host, "->", "grey")
  const budget = Math.max(0, columns - 6)
  const sourceWidth = Math.max(8, Math.floor(budget * 0.48))
  const targetWidth = Math.max(0, budget - sourceWidth)
  return `${truncateVisible(operation.originalPath, sourceWidth)} ${arrow} ${truncateVisible(operation.newPath, targetWidth)}`
}

async function pathsFromClipboard(runtime: TrenameRuntime): Promise<string[]> {
  const text = await readClipboardText()
  if (!text) return []
  return await validDirectoryPaths(splitPaths(text), runtime)
}

async function validDirectoryPaths(candidates: string[], runtime: TrenameRuntime): Promise<string[]> {
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

function numberArg(value?: string | number): number | undefined {
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

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
