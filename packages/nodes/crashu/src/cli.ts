#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  hasPipedInput,
  nodeCliName,
  promptRich,
  readStdinLines,
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

import type { CrashuAction, CrashuConflictPolicy, CrashuInput, CrashuMoveDirection } from "./core.js"
import { runCrashu } from "./core.js"
import { createNodeCrashuRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("crashu")
const DEFAULT_TARGET_PATH = "E:\\1Hub\\EH\\1EHV"
const DEFAULT_DESTINATION_PATH = "E:\\1Hub\\EH\\2EHV\\crash"
const DEFAULT_THRESHOLD = 0.8
const DEFAULT_PAIRS_FILE = "folder_pairs.json"

interface CrashuCliOptions {
  source?: string
  sourcePaths?: string
  targetPath?: string
  targetNames?: string
  destinationPath?: string
  threshold?: string | number
  similarityThreshold?: string | number
  autoMove?: boolean
  moveDirection?: CrashuMoveDirection
  conflictPolicy?: CrashuConflictPolicy
  pairsFileName?: string
  dryRun?: boolean
  json?: boolean
}

interface CrashuNodeConfig {
  enabled?: boolean
  output?: {
    pairs_file_name?: string
    directory?: string
    overwrite?: boolean
  }
}

interface CrashuOutputDefaults {
  pairsFileName: string
  directory?: string
  overwrite: boolean
}

interface GuidedTask {
  name: string
  description: string
  action: CrashuAction
  autoMove: boolean
  moveDirection?: CrashuMoveDirection
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "path"; path: string; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "scan",
    description: "扫描相似文件夹（只读预览，不移动）",
    action: "scan",
    autoMove: false,
  },
  {
    name: "plan",
    description: "生成移动计划（预演，不写盘）",
    action: "plan",
    autoMove: false,
  },
  {
    name: "move-to-source",
    description: "把相似文件夹从目标侧移到源侧（原版默认 target_to_source）",
    action: "move",
    autoMove: true,
    moveDirection: "to_source",
  },
  {
    name: "move-to-target",
    description: "把相似文件夹从源侧移到 destinationPath（1=源->目标）",
    action: "move",
    autoMove: true,
    moveDirection: "to_target",
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Match similar folder names and optionally move matched folders.",
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

/**
 * Resolve crashu default output parameters from xiranite.config.toml [nodes.crashu.output].
 * Falls back to hardcoded defaults when the config file or section is missing.
 */
async function resolveCrashuDefaults(host: CliHost, json: boolean): Promise<CrashuOutputDefaults> {
  const fallback: CrashuOutputDefaults = {
    pairsFileName: DEFAULT_PAIRS_FILE,
    directory: undefined,
    overwrite: false,
  }
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<CrashuNodeConfig>("crashu", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    const output = nodeConfig?.output
    if (!output) return fallback
    return {
      pairsFileName: output.pairs_file_name ?? DEFAULT_PAIRS_FILE,
      directory: output.directory,
      overwrite: output.overwrite ?? false,
    }
  } catch {
    return fallback
  }
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "Folder similarity matcher with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Find similar folders." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveCrashuDefaults(host, Boolean(args.json))
          await runAction({ action: "scan", ...inputFromArgs({ ...args, sourcePaths: (args.sourcePaths === "-" || (!args.sourcePaths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.sourcePaths, source: (args.source === "-" || (!args.source && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.source } as CrashuCliOptions, defaults) }, Boolean(args.json), host)
        },
      }),
      plan: defineCommand({
        meta: { name: "plan", description: "Preview move operations." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveCrashuDefaults(host, Boolean(args.json))
          await runAction({ action: "plan", ...inputFromArgs({ ...args, sourcePaths: (args.sourcePaths === "-" || (!args.sourcePaths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.sourcePaths, source: (args.source === "-" || (!args.source && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.source } as CrashuCliOptions, defaults) }, Boolean(args.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move matched folders." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveCrashuDefaults(host, Boolean(args.json))
          await runAction({ action: "move", ...inputFromArgs({ ...args, sourcePaths: (args.sourcePaths === "-" || (!args.sourcePaths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.sourcePaths, source: (args.source === "-" || (!args.source && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.source } as CrashuCliOptions, defaults), autoMove: true }, Boolean(args.json), host)
        },
      }),
      execute: defineCommand({
        meta: { name: "execute", description: "Alias for move." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveCrashuDefaults(host, Boolean(args.json))
          await runAction({ action: "execute", ...inputFromArgs({ ...args, sourcePaths: (args.sourcePaths === "-" || (!args.sourcePaths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.sourcePaths, source: (args.source === "-" || (!args.source && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.source } as CrashuCliOptions, defaults), autoMove: true }, Boolean(args.json), host)
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
    source: { type: "string", description: "Source directory. Repeat with --sourcePaths for more." },
    sourcePaths: { type: "string", description: "Comma, semicolon, or newline separated source directories." },
    targetPath: { type: "string", description: "Directory whose child folder names are targets." },
    targetNames: { type: "string", description: "Comma, semicolon, or newline separated target names." },
    destinationPath: { type: "string", description: "Move destination root." },
    threshold: { type: "string", description: "Similarity threshold from 0 to 1." },
    similarityThreshold: { type: "string", description: "Similarity threshold from 0 to 1." },
    autoMove: { type: "boolean", description: "Allow move actions." },
    moveDirection: { type: "string", description: "to_target or to_source." },
    conflictPolicy: { type: "string", description: "skip, overwrite, or rename." },
    pairsFileName: { type: "string", description: "Pairs JSON file name." },
    dryRun: { type: "boolean", description: "Preview without moving." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: CrashuCliOptions, defaults: CrashuOutputDefaults): CrashuInput {
  return {
    sourcePaths: splitArg(args.sourcePaths, args.source ? [args.source] : []),
    targetPath: args.targetPath,
    targetNames: splitArg(args.targetNames),
    destinationPath: args.destinationPath ?? defaults.directory,
    similarityThreshold: numberArg(args.similarityThreshold ?? args.threshold),
    autoMove: args.autoMove,
    moveDirection: isDirection(args.moveDirection) ? args.moveDirection : undefined,
    conflictPolicy: resolveConflictPolicy(args.conflictPolicy, defaults.overwrite),
    pairsFileName: args.pairsFileName ?? defaults.pairsFileName,
    dryRun: args.dryRun,
  }
}

async function runAction(input: CrashuInput & { action: CrashuAction }, json: boolean, host: CliHost): Promise<boolean> {
  let progressActive = false
  const result = await runCrashu(input, createNodeCrashuRuntime(), (event) => {
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
    return result.success
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeCrashuSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result.success
}

function writeCrashuSummary(host: CliHost, result: { success: boolean; message: string; data?: CrashuDataLike }): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const summaryLines = [
    `matched: ${rich(host, String(data.similarFound), "yellow")}  moved: ${rich(host, String(data.movedCount), "green")}  skipped: ${rich(host, String(data.skippedCount), "grey")}  errors: ${rich(host, String(data.errorCount), data.errorCount ? "red" : "grey")}`,
    data.pairsFile ? `pairsFile: ${data.pairsFile}` : "",
  ].filter(Boolean)
  writeRichPanel(host, "Summary", summaryLines, { color: result.success ? "green" : "yellow", minWidth: Math.min(76, columns - 6) })

  if (data.similarFolders.length) {
    writeLine(host)
    writeLine(host, rich(host, "相似文件夹：", "cyan"))
    for (const item of data.similarFolders.slice(0, 40)) {
      const percent = rich(host, `${Math.round(item.similarity * 100)}%`, "yellow")
      const arrow = rich(host, "->", "grey")
      writeLine(host, `  ${percent}  ${truncateVisible(item.path, Math.max(20, columns - 32))}  ${arrow}  ${item.target}`)
    }
    if (data.similarFolders.length > 40) writeLine(host, rich(host, `  ... 还有 ${data.similarFolders.length - 40} 个匹配`, "grey"))
  }

  if (data.plan.length) {
    writeLine(host)
    writeLine(host, rich(host, "移动计划：", "cyan"))
    for (const item of data.plan.slice(0, 40)) {
      const status = item.status === "success"
        ? rich(host, "success", "green")
        : item.status === "error"
          ? rich(host, "error", "red")
          : item.status === "skipped"
            ? rich(host, "skipped", "yellow")
            : rich(host, "planned", "cyan")
      const tail = item.destinationPath
        ? `  ${rich(host, "->", "grey")}  ${truncateVisible(item.destinationPath, Math.max(20, columns - 40))}`
        : `  ${rich(host, "/", "grey")}  ${item.reason}`
      writeLine(host, `  ${status}  ${truncateVisible(item.sourcePath, Math.max(20, columns - 40))}${tail}`)
    }
    if (data.plan.length > 40) writeLine(host, rich(host, `  ... 还有 ${data.plan.length - 40} 条计划`, "grey"))
  }

  if (data.errors.length) {
    writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: Math.min(76, columns - 6) })
  }
}

interface CrashuDataLike {
  similarFound: number
  movedCount: number
  skippedCount: number
  errorCount: number
  pairsFile: string
  similarFolders: Array<{ name: string; path: string; target: string; similarity: number }>
  plan: Array<{ sourcePath: string; destinationPath: string; status: string; reason: string }>
  errors: string[]
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} scan --source <folder> --targetPath <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const runtime = createNodeCrashuRuntime()
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

      const paths = choice.kind === "path" ? [choice.path] : await resolveGuidedPaths(host, runtime)
      if (!paths.length) {
        writeRichPanel(host, "Path", "未提供有效文件夹路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      const task = choice.task
      writeRichPanel(host, "Run", [
        `task: ${task.name}`,
        `path: ${paths.join("; ")}`,
        "mode: direct core call, no Taskfile shell hop",
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const ok = await runGuidedTask(task, paths, host)
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
  writeRichPanel(host, "Xiranite Crashu", [
    `${rich(host, "工具", "cyan")}  文件夹相似度检测与批量移动`,
    `${rich(host, "入口", "cyan")}  内置 TypeScript guided flow`,
    `${rich(host, "执行", "cyan")}  直接调用 crashu core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；移动前需确认`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认目标目录 ${DEFAULT_TARGET_PATH}；移动任务会单独询问 destinationPath、阈值并要求确认。`, "grey"))
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask, runtime: CrashuRuntimeLike): Promise<ResolvedGuidedChoice> {
  const directPath = cleanPath(await promptRich(host, "粘贴 auto_dir 路径直接执行默认 scan 任务；留空进入任务选择", ""))
  if (directPath) {
    const info = await runtime.pathInfo(directPath)
    if (info.exists && info.isDirectory) return { kind: "path", path: info.path, task: defaultTask }
    writeRichPanel(host, "Path", `不是有效文件夹: ${directPath}`, { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 crashu 任务",
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
    const answer = await promptRich(host, "输入 auto_dir 文件夹路径", DEFAULT_TARGET_PATH)
    const [path] = await validDirectoryPaths(splitPaths(answer), runtime)
    if (path) return { kind: "path", path, task: defaultTask }
    writeRichPanel(host, "Path", "未提供有效文件夹路径。", { color: "yellow", minWidth: 48 })
    return { kind: "task", task: defaultTask }
  }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolveGuidedPaths(host: CliHost, runtime: CrashuRuntimeLike): Promise<string[]> {
  const clipboardText = await readClipboardText()
  if (clipboardText) {
    const clipboardPaths = await validDirectoryPaths(splitPaths(clipboardText), runtime)
    if (clipboardPaths.length) {
      writeLine(host, rich(host, `已从剪贴板读取 ${clipboardPaths.length} 个路径。`, "yellow"))
      return clipboardPaths
    }
  }

  const answer = await promptRich(host, "输入 auto_dir 文件夹路径", DEFAULT_TARGET_PATH)
  return await validDirectoryPaths(splitPaths(answer), runtime)
}

async function runGuidedTask(task: GuidedTask, paths: string[], host: CliHost): Promise<boolean> {
  const defaults = await resolveCrashuDefaults(host, false)
  const targetPath = paths[0]!
  const sourcePaths = paths
  let destinationPath: string | undefined
  let threshold = DEFAULT_THRESHOLD

  if (task.autoMove) {
    destinationPath = (await promptRich(host, "destinationPath（移动目标根目录）", defaults.directory ?? DEFAULT_DESTINATION_PATH)).trim() || undefined
    const thresholdInput = await promptRich(host, "相似度阈值 (0-1)", String(DEFAULT_THRESHOLD))
    const parsed = Number(thresholdInput)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) threshold = parsed

    const confirmed = await confirmRich(host, "确认执行移动?（默认否，安全门）", false)
    if (!confirmed) {
      writeLine(host, rich(host, "已取消移动，未写盘。", "yellow"))
      return true
    }
  }

  const input: CrashuInput & { action: CrashuAction } = {
    action: task.action,
    sourcePaths,
    targetPath,
    destinationPath,
    similarityThreshold: threshold,
    autoMove: task.autoMove,
    moveDirection: task.moveDirection,
    conflictPolicy: defaults.overwrite ? "overwrite" : "skip",
    pairsFileName: defaults.pairsFileName,
  }
  return await runAction(input, false, host)
}

interface CrashuRuntimeLike {
  pathInfo: (path: string) => Promise<{ path: string; exists: boolean; isDirectory: boolean }>
}

async function validDirectoryPaths(candidates: string[], runtime: CrashuRuntimeLike): Promise<string[]> {
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

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: string | number): number | undefined {
  if (typeof value === "number") return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isDirection(value?: string): value is CrashuMoveDirection {
  return value === "to_target" || value === "to_source"
}

function isConflict(value?: string): value is CrashuConflictPolicy {
  return value === "skip" || value === "overwrite" || value === "rename"
}

function resolveConflictPolicy(value: string | undefined, overwriteDefault: boolean): CrashuConflictPolicy | undefined {
  if (isConflict(value)) return value
  if (value === undefined && overwriteDefault) return "overwrite"
  return undefined
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
