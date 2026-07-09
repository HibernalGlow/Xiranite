#!/usr/bin/env node
import { lstat } from "node:fs/promises"
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
import { loadNodeConfigWithHints } from "@xiranite/config"

import type { MoveaInput, MoveaResult, MoveaScanItem } from "./core.js"
import { matchMoveaArchiveToFolders, runMovea } from "./core.js"
import { createNodeMoveaRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("movea")
const DEFAULT_ROOT_PATH = "E:\\1Hub\\EH\\1EHV"

interface MoveaNodeConfig {
  root_path?: string
  regex_patterns?: string[]
  priority_keywords?: string[]
  blacklist?: string[]
  allow_move_to_unnumbered?: boolean
  enable_folder_moving?: boolean
  dry_run?: boolean
}

interface MoveaDefaults {
  rootPath?: string
  regexPatterns?: string[]
  priorityKeywords?: string[]
  blacklist?: string[]
  allowMoveToUnnumbered?: boolean
  enableFolderMoving?: boolean
  dryRun?: boolean
}

async function resolveMoveaDefaults(host: CliHost, json = false): Promise<MoveaDefaults> {
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<MoveaNodeConfig>("movea", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      rootPath: nodeConfig?.root_path?.trim() || undefined,
      regexPatterns: nodeConfig?.regex_patterns,
      priorityKeywords: nodeConfig?.priority_keywords,
      blacklist: nodeConfig?.blacklist,
      allowMoveToUnnumbered: nodeConfig?.allow_move_to_unnumbered,
      enableFolderMoving: nodeConfig?.enable_folder_moving,
      dryRun: nodeConfig?.dry_run,
    }
  } catch {
    return {}
  }
}

interface MoveaCliOptions {
  path?: string
  root?: string
  level1?: string
  archive?: string
  folders?: string
  regex?: string
  plan?: string
  dryRun?: boolean
  json?: boolean
}

type GuidedTaskName = "scan" | "match" | "move-single" | "move-all"

interface GuidedTask {
  name: GuidedTaskName
  description: string
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "path"; path: string; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${GuidedTaskName}`

const GUIDED_TASKS: readonly GuidedTask[] = [
  { name: "scan", description: "扫描根路径，输出文件夹/压缩包/可移动文件夹统计" },
  { name: "match", description: "预览单个压缩包匹配的目标文件夹" },
  { name: "move-single", description: "对指定 level1 执行 JSON 移动计划" },
  { name: "move-all", description: "对扫描结果全部执行（带二次确认）" },
]

const DEFAULT_TASK = GUIDED_TASKS[0]!

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Scan and move archives or folders into numbered target folders.",
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
    meta: { name: CLI_NAME, description: "Archive classifier mover with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan a root path for movable archives and folders." },
        args: commonArgs(),
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveMoveaDefaults(host, json)
          await runAction({ action: "scan", ...inputFromArgs(args as MoveaCliOptions, defaults) }, json, host)
        },
      }),
      match: defineCommand({
        meta: { name: "match", description: "Preview target folders for an archive name." },
        args: commonArgs(),
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveMoveaDefaults(host, json)
          await runAction({ action: "match", ...inputFromArgs(args as MoveaCliOptions, defaults) }, json, host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move items according to --plan JSON inside --level1." },
        args: commonArgs(),
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveMoveaDefaults(host, json)
          await runAction({ action: "move_single", ...inputFromArgs(args as MoveaCliOptions, defaults) }, json, host)
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
    path: { type: "string", description: "Root path." },
    root: { type: "string", description: "Root path." },
    level1: { type: "string", description: "First-level folder name." },
    archive: { type: "string", description: "Archive name to match." },
    folders: { type: "string", description: "Comma-separated target folder names." },
    regex: { type: "string", description: "Comma-separated regex patterns." },
    plan: { type: "string", description: "Move plan JSON, for example {\"book.zip\":\"1. comics\"}." },
    dryRun: { type: "boolean", description: "Preview moves without changing files." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: MoveaCliOptions, defaults: MoveaDefaults = {}): MoveaInput {
  const regexPatterns = splitArg(args.regex)
  return {
    rootPath: args.root || args.path || defaults.rootPath,
    level1Name: args.level1,
    archiveName: args.archive,
    subfolders: splitArg(args.folders),
    regexPatterns: regexPatterns.length ? regexPatterns : defaults.regexPatterns,
    priorityKeywords: defaults.priorityKeywords,
    blacklist: defaults.blacklist,
    allowMoveToUnnumbered: defaults.allowMoveToUnnumbered,
    enableFolderMoving: defaults.enableFolderMoving,
    movePlan: parsePlan(args.plan),
    dryRun: args.dryRun ?? defaults.dryRun,
  }
}

async function runAction(input: MoveaInput, json: boolean, host: CliHost): Promise<MoveaResult> {
  if (json) {
    const result = await runMovea(input, createNodeMoveaRuntime())
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return result
  }

  const result = await runWithProgress(input, host)
  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeMoveaSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result
}

async function runWithProgress(input: MoveaInput, host: CliHost): Promise<MoveaResult> {
  let progressActive = false
  const result = await runMovea(input, createNodeMoveaRuntime(), (event) => {
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
  return result
}

function writeMoveaSummary(host: CliHost, result: MoveaResult): void {
  const data = result.data
  if (!data) return
  const columns = terminalColumns(host)
  const lines = [
    `folders: ${data.totalFolders}  archives: ${data.totalArchives}  movable: ${data.totalMovableFolders}`,
    data.moveItems.length ? `moved: ${data.moveSuccess}  failed: ${data.moveFailed}` : "",
  ].filter(Boolean)
  writeRichPanel(host, "Summary", lines, { color: result.success ? "green" : "yellow", minWidth: Math.min(76, columns - 6) })

  const scanItems = Object.values(data.scanResults)
  if (scanItems.length) {
    for (const item of scanItems.slice(0, 40)) writeLine(host, formatScanItem(item, host))
    if (scanItems.length > 40) writeLine(host, rich(host, `... ${scanItems.length - 40} more folder(s)`, "grey"))
  }

  if (data.matchedFolders.length) {
    writeLine(host, rich(host, "matched folders:", "cyan"))
    for (const folder of data.matchedFolders) writeLine(host, `  ${rich(host, "•", "cyan")} ${folder}`)
  }

  if (data.moveItems.length) {
    for (const item of data.moveItems) {
      const status = item.success ? rich(host, "OK", "green") : rich(host, "FAIL", "red")
      writeLine(host, `  ${status} ${item.itemName} ${rich(host, "->", "grey")} ${item.targetFolder}`)
    }
  }

  if (data.errors.length) writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })
}

function formatScanItem(item: MoveaScanItem, host: CliHost): string {
  const name = rich(host, item.name, "blue")
  const stats = rich(host, `archives=${item.archives.length} movable=${item.movableFolders.length} targets=${item.subfolders.length}`, "grey")
  const warning = item.warning ? ` ${rich(host, item.warning, "yellow")}` : ""
  return `  ${name}  ${stats}${warning}`
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} scan --path <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const defaults = await resolveMoveaDefaults(host, false)
  const defaultRoot = defaults.rootPath ?? DEFAULT_ROOT_PATH

  let firstRender = true
  try {
    while (true) {
      renderGuidedIntro(host, firstRender, defaultRoot)
      firstRender = false

      const choice = await readGuidedChoice(host)
      if (choice.kind === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const rootPath = choice.kind === "path" ? choice.path : await resolveRootPath(host, defaultRoot)
      if (!rootPath) {
        writeRichPanel(host, "Path", "未提供有效根路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        `root: ${rootPath}`,
        "mode: direct core call, no Taskfile shell hop",
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const ok = await runGuidedTask(choice.task, rootPath, host)
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

function renderGuidedIntro(host: CliHost, includeHeader: boolean, defaultRoot = DEFAULT_ROOT_PATH): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  const taskLines = GUIDED_TASKS.map((task) => `${rich(host, "•", "cyan")} ${rich(host, task.name, "magenta")}  ${task.description}`)
  writeRichPanel(host, "Xiranite Movea", [
    `${rich(host, "入口", "cyan")}  压缩包归档工具，按一级文件夹扫描、正则匹配压缩包到目标文件夹、执行移动`,
    `${rich(host, "执行", "cyan")}  直接调用 movea core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  可直接粘贴路径；否则读取剪贴板，失败时再手动输入`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    `${rich(host, "任务", "cyan")}  ${GUIDED_TASKS.length} 个 guided 任务，下方列出全部可用任务`,
    ...taskLines,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认根路径 ${defaultRoot}；需要预演请用 \`${CLI_NAME} move --dry-run\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost): Promise<ResolvedGuidedChoice> {
  const directPath = cleanPath(await promptRich(host, "粘贴根路径直接执行 scan 任务；留空进入任务选择", ""))
  if (directPath) {
    if (await verifyDirectory(directPath)) return { kind: "path", path: directPath, task: DEFAULT_TASK }
    writeRichPanel(host, "Path", `不是有效文件夹: ${directPath}`, { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 movea 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入根路径，并使用默认 scan 任务" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${DEFAULT_TASK.name}`, maxItems: 8 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") {
    const answer = await promptRich(host, "输入根路径", "")
    const path = cleanPath(answer)
    if (path && await verifyDirectory(path)) return { kind: "path", path, task: DEFAULT_TASK }
    writeRichPanel(host, "Path", "未提供有效根路径。", { color: "yellow", minWidth: 48 })
    return { kind: "task", task: DEFAULT_TASK }
  }

  const taskName = selection.slice("task:".length) as GuidedTaskName
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? DEFAULT_TASK }
}

async function resolveRootPath(host: CliHost, defaultRoot = DEFAULT_ROOT_PATH): Promise<string> {
  const clipboard = cleanPath(await readClipboardText())
  if (clipboard && await verifyDirectory(clipboard)) {
    writeLine(host, rich(host, `已从剪贴板读取根路径: ${clipboard}`, "yellow"))
    return clipboard
  }

  const answer = await promptRich(host, "输入根路径", defaultRoot)
  const path = cleanPath(answer)
  if (!path) return ""
  if (!await verifyDirectory(path)) {
    writeRichPanel(host, "Path", `不是有效文件夹: ${path}`, { color: "red", minWidth: 48 })
    return ""
  }
  return path
}

async function runGuidedTask(task: GuidedTask, rootPath: string, host: CliHost): Promise<boolean> {
  switch (task.name) {
    case "scan": {
      const result = await runAction({ action: "scan", rootPath }, false, host)
      return result.success
    }

    case "match": {
      const archiveName = cleanPath(await promptRich(host, "输入压缩包文件名", ""))
      if (!archiveName) {
        writeLine(host, rich(host, "未提供压缩包文件名。", "yellow"))
        return false
      }
      const foldersAnswer = await promptRich(host, "输入候选目标文件夹，逗号或换行分隔", "")
      const subfolders = splitArg(foldersAnswer)
      if (!subfolders.length) {
        writeLine(host, rich(host, "未提供候选文件夹。", "yellow"))
        return false
      }
      const result = await runAction({ action: "match", archiveName, subfolders }, false, host)
      return result.success
    }

    case "move-single": {
      const level1Name = cleanPath(await promptRich(host, "输入一级文件夹名 (level1)", ""))
      if (!level1Name) {
        writeLine(host, rich(host, "未提供一级文件夹名。", "yellow"))
        return false
      }
      const planAnswer = await promptRich(host, "输入移动计划 JSON，例如 {\"book.zip\":\"1. comics\"}", "")
      const movePlan = parsePlan(planAnswer)
      if (!Object.keys(movePlan).length) {
        writeLine(host, rich(host, "未提供有效移动计划。", "yellow"))
        return false
      }
      const result = await runAction({ action: "move_single", rootPath, level1Name, movePlan }, false, host)
      return result.success
    }

    case "move-all": {
      const scanResult = await runWithProgress({ action: "scan", rootPath }, host)
      if (!scanResult.success || !scanResult.data) {
        writeLine(host, rich(host, scanResult.message, "red", "bold"))
        return false
      }

      const scanItems = Object.values(scanResult.data.scanResults)
      if (!scanItems.length) {
        writeLine(host, rich(host, "未发现可移动的文件夹。", "yellow"))
        return true
      }

      const totalItems = scanItems.reduce((sum, item) => sum + item.archives.length + item.movableFolders.length, 0)
      writeRichPanel(host, "Scan", [
        `folders: ${scanResult.data.totalFolders}`,
        `archives: ${scanResult.data.totalArchives}`,
        `movable: ${scanResult.data.totalMovableFolders}`,
        `total move targets: ${totalItems}`,
      ], { color: "cyan", minWidth: Math.min(56, terminalColumns(host) - 6) })

      if (!totalItems) {
        writeLine(host, rich(host, "没有需要移动的压缩包或文件夹。", "yellow"))
        return true
      }

      const confirmed = await confirmRich(host, `确定移动所有 ${scanResult.data.totalFolders} 个文件夹下的 ${totalItems} 个项目?`, false)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        return true
      }

      let ok = true
      for (const item of scanItems) {
        const movePlan = buildMovePlanFromScanItem(item)
        if (!Object.keys(movePlan).length) continue
        const result = await runAction({ action: "move_single", rootPath, level1Name: item.name, movePlan }, false, host)
        if (!result.success) ok = false
      }
      return ok
    }
  }
}

function buildMovePlanFromScanItem(item: MoveaScanItem): Record<string, string | null> {
  const plan: Record<string, string | null> = {}
  for (const archive of item.archives) {
    const matched = matchMoveaArchiveToFolders(archive, item.subfolders, [".*"])
    const target = matched[0] ?? item.subfolders[0]
    if (target) plan[archive] = target
  }
  for (const folder of item.movableFolders) {
    const matched = matchMoveaArchiveToFolders(folder, item.subfolders, [".*"])
    const target = matched[0] ?? item.subfolders[0]
    if (target) plan[`folder_${folder}`] = target
  }
  return plan
}

async function verifyDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

function splitArg(value?: string): string[] {
  return (value ?? "").split(/[,;\r\n]/).map((item) => item.trim()).filter(Boolean)
}

function parsePlan(value?: string): Record<string, string | null | undefined> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string | null | undefined> : {}
  } catch {
    return {}
  }
}

function cleanPath(value = ""): string {
  return value.trim().replace(/^["']|["']$/g, "")
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
