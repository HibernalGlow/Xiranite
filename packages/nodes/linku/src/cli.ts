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
import { loadNodeConfigWithHints } from "@xiranite/config"

import type { LinkuAction, LinkuInput, LinkuPathKind, LinkuResult } from "./core.js"
import { runLinku } from "./core.js"
import { createNodeLinkuRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("linku")

interface LinkuCliOptions {
  path?: string
  target?: string
  configPath?: string
  json?: boolean
}

interface LinkuNodeConfig {
  default_path?: string
  default_target?: string
}

interface LinkuDefaults {
  defaultPath?: string
  defaultTarget?: string
}

/**
 * Resolve linku defaults from xiranite.config.toml [nodes.linku].
 */
async function resolveLinkuDefaults(host: CliHost, json = false): Promise<LinkuDefaults> {
  try {
    const { config } = await loadNodeConfigWithHints<LinkuNodeConfig>("linku", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      defaultPath: config?.default_path,
      defaultTarget: config?.default_target,
    }
  } catch {
    return {}
  }
}

interface GuidedTask {
  name: string
  description: string
  action: LinkuAction
  needsPath: boolean
  needsTarget: boolean
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "info",
    description: "查看文件/目录/符号链接的路径信息",
    action: "info",
    needsPath: true,
    needsTarget: false,
  },
  {
    name: "create",
    description: "创建直接软链接，不移动源文件",
    action: "create",
    needsPath: true,
    needsTarget: true,
  },
  {
    name: "move-link",
    description: "移动源到目标位置，并在原位置创建软链接",
    action: "move_link",
    needsPath: true,
    needsTarget: true,
  },
  {
    name: "list",
    description: "列出 xiranite.config.toml 中已记录的所有链接",
    action: "list",
    needsPath: false,
    needsTarget: false,
  },
  {
    name: "recover",
    description: "检查并恢复/修复已记录的链接",
    action: "recover",
    needsPath: false,
    needsTarget: false,
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Create, move, list, and recover symlink records.",
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
    meta: { name: CLI_NAME, description: "Symlink manager with guided terminal mode." },
    subCommands: {
      info: defineCommand({
        meta: { name: "info", description: "Show file, directory, or symlink information." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveLinkuDefaults(host, Boolean(args.json))
          await runAction({ action: "info", ...inputFromArgs(args as LinkuCliOptions, defaults) }, Boolean(args.json), host)
        },
      }),
      create: defineCommand({
        meta: { name: "create", description: "Create a symlink from --target to --path." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveLinkuDefaults(host, Boolean(args.json))
          await runAction({ action: "create", ...inputFromArgs(args as LinkuCliOptions, defaults) }, Boolean(args.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move --path to --target and create a link at the original path." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveLinkuDefaults(host, Boolean(args.json))
          await runAction({ action: "move_link", ...inputFromArgs(args as LinkuCliOptions, defaults) }, Boolean(args.json), host)
        },
      }),
      list: defineCommand({
        meta: { name: "list", description: "List recorded links." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveLinkuDefaults(host, Boolean(args.json))
          await runAction({ action: "list", ...inputFromArgs(args as LinkuCliOptions, defaults) }, Boolean(args.json), host)
        },
      }),
      recover: defineCommand({
        meta: { name: "recover", description: "Recover missing or incorrect recorded symlinks." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveLinkuDefaults(host, Boolean(args.json))
          await runAction({ action: "recover", ...inputFromArgs(args as LinkuCliOptions, defaults) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Source path." },
    target: { type: "string", description: "Target path or symlink path." },
    configPath: { type: "string", description: "xiranite.config.toml path (defaults to XIRANITE_CONFIG_PATH / XIRANITE_DATA_DIR / system dir)." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: LinkuCliOptions, defaults: LinkuDefaults = {}): LinkuInput {
  return {
    path: args.path ?? defaults.defaultPath,
    target: args.target ?? defaults.defaultTarget,
    configPath: args.configPath,
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} info --path <path> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const defaultTask = GUIDED_TASKS[0]!
  let firstRender = true

  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const choice = await readGuidedChoice(host, defaultTask)
      if (choice.kind === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const defaults = await resolveLinkuDefaults(host)
      const ok = await runGuidedTask(choice.task, host, defaults)
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
  const taskLines = GUIDED_TASKS.map((task) => `${rich(host, "•", "cyan")} ${rich(host, task.name, "magenta")}  ${task.description}`)
  writeRichPanel(host, "Xiranite Linku", [
    `${rich(host, "入口", "cyan")}  软链接管理工具，提供创建、移动、查看、列表、恢复操作`,
    `${rich(host, "任务", "cyan")}  ${GUIDED_TASKS.length} 个内置任务，下方列出全部可用任务`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；创建/移动前会预览确认`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    ...taskLines,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认读取 xiranite.config.toml 的 [nodes.linku]；可用 --config 覆盖；需要预演请用 \`${CLI_NAME} info --path <path> --json\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask): Promise<ResolvedGuidedChoice> {
  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 linku 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 8 },
  )

  if (selection === "exit") return { kind: "exit" }
  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolvePaths(host: CliHost, label: string, mustExist: boolean, defaultPath?: string): Promise<string | undefined> {
  const clipboard = (await readClipboardText()).trim()
  if (clipboard) {
    const info = await createNodeLinkuRuntime().pathInfo(clipboard)
    if (info.exists) {
      writeLine(host, rich(host, `已从剪贴板读取路径: ${info.path}`, "yellow"))
      return info.path
    }
  }

  const answer = (await promptRich(host, `输入${label}（留空取消）`, defaultPath ?? "")).trim()
  if (!answer) {
    writeLine(host, rich(host, "未输入路径。", "yellow"))
    return undefined
  }
  const info = await createNodeLinkuRuntime().pathInfo(answer)
  if (mustExist && !info.exists) {
    writeRichPanel(host, "Path", `路径不存在: ${answer}`, { color: "red", minWidth: 48 })
    return undefined
  }
  return info.path
}

async function resolveTarget(host: CliHost, label: string, defaultTarget?: string): Promise<string | undefined> {
  const answer = (await promptRich(host, `输入${label}（留空取消）`, defaultTarget ?? "")).trim()
  if (!answer) {
    writeLine(host, rich(host, "未输入目标路径。", "yellow"))
    return undefined
  }
  return answer
}

async function runGuidedTask(task: GuidedTask, host: CliHost, defaults: LinkuDefaults = {}): Promise<boolean> {
  let path: string | undefined
  let target: string | undefined

  if (task.needsPath) {
    path = await resolvePaths(host, task.action === "info" ? "要查看的路径" : "源路径", true, defaults.defaultPath)
    if (!path) return false
  }
  if (task.needsTarget) {
    const label = task.action === "create" ? "链接路径（软链接位置）" : "目标路径（移动到的位置）"
    target = await resolveTarget(host, label, defaults.defaultTarget)
    if (!target) return false
  }

  writeLine(host)
  writeRichPanel(host, "Run", [
    `task: ${task.name}`,
    path ? `path: ${path}` : "",
    target ? `target: ${target}` : "",
    "mode: direct core call, no Taskfile shell hop",
  ].filter(Boolean), { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

  const confirmed = await confirmRich(host, "确认执行?", true)
  if (!confirmed) {
    writeLine(host, rich(host, "已取消。", "yellow"))
    return false
  }

  const result = await runAction({ action: task.action, path, target }, false, host)
  return result.success
}

async function runAction(input: LinkuInput, json: boolean, host: CliHost): Promise<LinkuResult> {
  let progressActive = false
  const result = await runLinku(input, createNodeLinkuRuntime(input.configPath), (event) => {
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
  writeLinkuSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result
}

function writeLinkuSummary(host: CliHost, result: LinkuResult): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)

  if (data.pathInfo) {
    const info = data.pathInfo
    const lines = [
      `${rich(host, "路径", "cyan")}: ${info.path}`,
      `${rich(host, "存在", "cyan")}: ${info.exists ? "是" : "否"}`,
      `${rich(host, "类型", "cyan")}: ${kindLabel(info.kind)}`,
      `${rich(host, "软链接", "cyan")}: ${info.isSymlink ? "是" : "否"}`,
    ]
    if (info.linkTarget) lines.push(`${rich(host, "链接目标", "cyan")}: ${info.linkTarget}`)
    if (typeof info.targetExists === "boolean") lines.push(`${rich(host, "目标存在", "cyan")}: ${info.targetExists ? "是" : "否"}`)
    if (typeof info.sizeMb === "number") lines.push(`${rich(host, "大小", "cyan")}: ${info.sizeMb.toFixed(2)} MB`)
    if (typeof info.fileCount === "number") lines.push(`${rich(host, "文件数", "cyan")}: ${info.fileCount}`)
    writeRichPanel(host, "Path Info", lines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  }

  if (data.links.length) {
    const lines = data.links.map((link) => [
      `${rich(host, "•", "cyan")} ${truncateVisible(link.link, Math.max(20, columns - 24))}`,
      `  ${rich(host, "->", "grey")} ${truncateVisible(link.target, Math.max(20, columns - 8))}`,
      `  ${rich(host, link.type || "unknown", "magenta")}  ${link.createdAt ? rich(host, link.createdAt, "yellow") : ""}`,
    ].join("\n"))
    writeRichPanel(host, `Recorded Links (${data.links.length})`, lines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  }

  if (result.success && (data.recoveredCount > 0 || data.failedCount > 0)) {
    writeRichPanel(host, "Recovery Summary", [
      `${rich(host, "恢复", "green")}: ${data.recoveredCount}  ${rich(host, "失败", "red")}: ${data.failedCount}`,
    ], { color: data.failedCount ? "yellow" : "green", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  }
}

function kindLabel(kind: LinkuPathKind): string {
  switch (kind) {
    case "dir": return "目录"
    case "file": return "文件"
    case "missing": return "缺失"
    default: return "其他"
  }
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
