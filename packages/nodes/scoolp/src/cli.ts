#!/usr/bin/env node
import { lstat } from "node:fs/promises"
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
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { loadNodeConfigWithHints, stringifyToml } from "@xiranite/config"

import type { ScoolpAction, ScoolpInput, ScoolpResult } from "./core.js"
import { formatSize, runScoolp } from "./core.js"
import { createNodeScoolpRuntime, readClipboardText } from "./platform.js"

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

type GuidedPathKind = "bucket" | "config" | "cache"

interface GuidedTask {
  name: string
  description: string
  action: ScoolpAction
  pathKind?: GuidedPathKind
  dryRun?: boolean
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "path"; path: string; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "status",
    description: "检查 Scoop 安装状态、已装包与 bucket 列表",
    action: "status",
  },
  {
    name: "list",
    description: "列出本地 bucket 中的清单（bucket 根目录）",
    action: "list_packages",
    pathKind: "bucket",
  },
  {
    name: "sync",
    description: "按 TOML 配置 dry-run 同步 bucket（仅预览命令）",
    action: "sync",
    pathKind: "config",
    dryRun: true,
  },
  {
    name: "cache-list",
    description: "扫描 Scoop cache 中的过期文件",
    action: "cache_list",
    pathKind: "cache",
  },
]

const DEFAULT_TASK = GUIDED_TASKS[0]!

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
          const opts = await resolveScoolpArgs(args as ScoolpCliOptions, host)
          await runAction({ action: "init", scoopDir: opts.dir, dryRun: Boolean(opts.dryRun) }, Boolean(args.json), host)
        },
      }),
      list: defineCommand({
        meta: { name: "list", description: "List manifests in a local bucket." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveScoolpArgs(args as ScoolpCliOptions, host)
          await runAction({ action: "list_packages", bucketPath: bucketPathArg(opts) ?? opts.path }, Boolean(args.json), host)
        },
      }),
      info: defineCommand({
        meta: { name: "info", description: "Show manifest info from a local bucket." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveScoolpArgs(args as ScoolpCliOptions, host)
          await runAction({ action: "package_info", bucketPath: bucketPathArg(opts) ?? opts.path, packageName: opts.package }, Boolean(args.json), host)
        },
      }),
      install: defineCommand({
        meta: { name: "install", description: "Install packages by name or local manifest path." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveScoolpArgs(args as ScoolpCliOptions, host)
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
          const opts = await resolveScoolpArgs(args as ScoolpCliOptions, host)
          const resolved = await resolveScoolpSyncConfig(opts, host, Boolean(args.json))
          await runAction({ action: "show_config", ...resolved }, Boolean(args.json), host)
        },
      }),
      sync: defineCommand({
        meta: { name: "sync", description: "Run or dry-run scoop bucket sync commands." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveScoolpArgs(args as ScoolpCliOptions, host)
          const resolved = await resolveScoolpSyncConfig(opts, host, Boolean(args.json))
          await runAction({ action: "sync", ...resolved, dryRun: Boolean(opts.dryRun) }, Boolean(args.json), host)
        },
      }),
      "cache-list": defineCommand({
        meta: { name: "cache-list", description: "List obsolete scoop cache files." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveScoolpArgs(args as ScoolpCliOptions, host)
          await runAction({ action: "cache_list", cachePath: opts.path, scoopRoot: opts.root }, Boolean(args.json), host)
        },
      }),
      "cache-backup": defineCommand({
        meta: { name: "cache-backup", description: "Move obsolete cache files into a timestamped backup folder." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveScoolpArgs(args as ScoolpCliOptions, host)
          await runAction({ action: "cache_backup", cachePath: opts.path, scoopRoot: opts.root, dryRun: Boolean(opts.dryRun) }, Boolean(args.json), host)
        },
      }),
      "cache-delete": defineCommand({
        meta: { name: "cache-delete", description: "Delete obsolete scoop cache files." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveScoolpArgs(args as ScoolpCliOptions, host)
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

async function resolveScoolpArgs(args: ScoolpCliOptions, host: CliHost): Promise<ScoolpCliOptions> {
  const pathFromStdin = args.path === "-" || (!args.path && hasPipedInput(host.stdin))
  const rootFromStdin = args.root === "-" || (!args.root && hasPipedInput(host.stdin))
  if (!pathFromStdin && !rootFromStdin) return args
  const stdinLines = await readStdinLines(host.stdin)
  const resolved: ScoolpCliOptions = { ...args }
  if (pathFromStdin) resolved.path = stdinLines[0] ?? ""
  if (rootFromStdin) resolved.root = stdinLines[0] ?? ""
  return resolved
}

interface ScoolpSyncTomlShape {
  scoop?: { root?: string; repo?: string }
  options?: Record<string, unknown>
  bucket?: Array<{ name?: string; url?: string }>
}

/**
 * Resolve sync config with priority:
 *   1. --config / -c explicit parameter (also accepts legacy --path)
 *   2. xiranite.config.toml [nodes.scoolp.sync] section
 *   3. built-in DEFAULT_SCOOLP_SYNC_TOML constant (handled by core.ts when neither is set)
 */
async function resolveScoolpSyncConfig(
  args: ScoolpCliOptions,
  host: CliHost,
  json: boolean,
): Promise<{ configPath?: string; configText?: string }> {
  const explicitConfig = args.config ?? args.path
  if (explicitConfig) {
    return { configPath: explicitConfig }
  }

  try {
    const { config: scoolpNode } = await loadNodeConfigWithHints<{ sync?: ScoolpSyncTomlShape }>("scoolp", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    const sync = scoolpNode?.sync
    if (sync && Object.keys(sync).length > 0) {
      return { configText: stringifyToml(sync) }
    }
  } catch {
    // ignore errors, fall through to default
  }

  return {}
}

async function runAction(input: ScoolpInput, json: boolean, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runScoolp(input, createNodeScoolpRuntime(), (event) => {
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
  writeScoolpSummary(host, result)
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} status --json\` or other subcommands for scripted use.`)
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

      const input = choice.kind === "path"
        ? buildGuidedInput(choice.task, choice.path)
        : await resolveGuidedInput(host, choice.task)
      if (!input) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        `action: ${choice.task.action}`,
        ...pathSummaryLine(input),
        "mode: direct core call, no shell hop",
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      await runAction(input, false, host)
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
  writeRichPanel(host, "Xiranite Scoolp", [
    `${rich(host, "入口", "cyan")}  内置 TypeScript guided flow`,
    `${rich(host, "工具", "cyan")}  Scoop 状态、包清单、bucket 同步、cache 清理`,
    `${rich(host, "任务", "cyan")}  ${GUIDED_TASKS.map((task) => task.name).join(" / ")}`,
    `${rich(host, "路径", "cyan")}  可直接粘贴路径；否则读取剪贴板，失败时手动输入`,
    `${rich(host, "提示", "cyan")}  sync 默认 dry-run；如需实际执行请用 \`${CLI_NAME} sync --config <path>\``,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认 dry-run sync；如需脚本化请用 \`${CLI_NAME} status --json\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost): Promise<ResolvedGuidedChoice> {
  const directPath = cleanPath(await promptRich(host, "粘贴路径直接执行对应任务（.toml 文件→sync dry-run；目录→list）；留空进入任务选择", ""))
  if (directPath) {
    const task = inferTaskFromPath(directPath)
    if (task?.pathKind) {
      const verified = await verifyPath(directPath, task.pathKind)
      if (verified) return { kind: "path", path: verified, task }
      writeRichPanel(host, "Path", `不是有效${pathKindLabel(task.pathKind)}: ${directPath}`, { color: "red", minWidth: 48 })
    } else {
      writeRichPanel(host, "Path", `无法识别路径类型: ${directPath}`, { color: "yellow", minWidth: 48 })
    }
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 scoolp 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入路径，并按类型推断任务" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${DEFAULT_TASK.name}`, maxItems: 7 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") {
    const answer = cleanPath(await promptRich(host, "输入路径（.toml 文件或目录）", ""))
    if (!answer) {
      writeRichPanel(host, "Path", "未提供有效路径。", { color: "yellow", minWidth: 48 })
      return { kind: "task", task: DEFAULT_TASK }
    }
    const task = inferTaskFromPath(answer) ?? DEFAULT_TASK
    if (task.pathKind) {
      const verified = await verifyPath(answer, task.pathKind)
      if (verified) return { kind: "path", path: verified, task }
      writeRichPanel(host, "Path", `不是有效${pathKindLabel(task.pathKind)}: ${answer}`, { color: "red", minWidth: 48 })
    }
    return { kind: "task", task: DEFAULT_TASK }
  }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? DEFAULT_TASK }
}

async function resolveGuidedInput(host: CliHost, task: GuidedTask): Promise<ScoolpInput | undefined> {
  if (!task.pathKind) return buildGuidedInput(task, "")

  const path = await resolveGuidedPath(host, task.pathKind)
  if (!path) return undefined
  return buildGuidedInput(task, path)
}

async function resolveGuidedPath(host: CliHost, pathKind: GuidedPathKind): Promise<string | undefined> {
  const clipboard = cleanPath(await readClipboardText())
  if (clipboard) {
    const verified = await verifyPath(clipboard, pathKind)
    if (verified) {
      writeLine(host, rich(host, `已从剪贴板读取路径: ${verified}`, "yellow"))
      return verified
    }
  }

  const answer = cleanPath(await promptRich(host, pathPrompt(pathKind), ""))
  if (!answer) {
    writeRichPanel(host, "Path", "未提供有效路径。", { color: "yellow", minWidth: 48 })
    return undefined
  }
  const verified = await verifyPath(answer, pathKind)
  if (!verified) {
    writeRichPanel(host, "Path", `不是有效${pathKindLabel(pathKind)}: ${answer}`, { color: "red", minWidth: 48 })
    return undefined
  }
  return verified
}

function buildGuidedInput(task: GuidedTask, path: string): ScoolpInput {
  const input: ScoolpInput = { action: task.action }
  if (task.dryRun) input.dryRun = true
  if (task.pathKind === "bucket") input.bucketPath = path
  else if (task.pathKind === "config") input.configPath = path
  else if (task.pathKind === "cache") input.cachePath = path
  return input
}

function inferTaskFromPath(path: string): GuidedTask | undefined {
  if (path.toLowerCase().endsWith(".toml")) {
    return GUIDED_TASKS.find((task) => task.name === "sync")
  }
  return GUIDED_TASKS.find((task) => task.name === "list")
}

async function verifyPath(path: string, pathKind: GuidedPathKind): Promise<string | undefined> {
  try {
    const info = await lstat(path)
    if (pathKind === "config") return info.isFile() ? path : undefined
    return info.isDirectory() ? path : undefined
  } catch {
    return undefined
  }
}

function pathPrompt(pathKind: GuidedPathKind): string {
  switch (pathKind) {
    case "bucket": return "输入本地 bucket 根目录路径"
    case "config": return "输入 scoop 同步 TOML 配置文件路径"
    case "cache": return "输入 Scoop cache 目录路径"
  }
}

function pathKindLabel(pathKind: GuidedPathKind): string {
  switch (pathKind) {
    case "bucket": return "bucket 目录"
    case "config": return "TOML 文件"
    case "cache": return "cache 目录"
  }
}

function pathSummaryLine(input: ScoolpInput): string[] {
  if (input.bucketPath) return [`bucket: ${input.bucketPath}`]
  if (input.configPath) return [`config: ${input.configPath}`]
  if (input.cachePath) return [`cache: ${input.cachePath}`]
  return ["path: (none)"]
}

function writeScoolpSummary(host: CliHost, result: ScoolpResult): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const summaryLines: string[] = []

  if (data.scoopInstalled !== undefined) summaryLines.push(`scoop installed: ${data.scoopInstalled}`)
  if (data.installedPackages.length) summaryLines.push(`installed packages: ${data.installedPackages.length}`)
  if (data.buckets.length) summaryLines.push(`buckets: ${data.buckets.length}`)
  if (data.availablePackages.length) summaryLines.push(`available manifests: ${data.availablePackages.length}`)
  if (data.packageInfo) summaryLines.push(`package: ${data.packageInfo.name} ${data.packageInfo.version ?? ""}`)
  if (data.syncPlan.length) summaryLines.push(`sync plan: ${data.syncPlan.length} command(s)`)
  if (data.commandResults.length) {
    summaryLines.push(`commands: ${data.commandResults.length}  failed: ${data.failedCount}`)
  }
  if (data.installedCount) summaryLines.push(`installed: ${data.installedCount}  failed: ${data.failedCount}`)
  if (data.cleanedCount) summaryLines.push(`cleaned: ${data.cleanedCount} (${formatSize(data.cleanedSizeBytes)})`)
  if (data.cache) {
    summaryLines.push(`cache: ${data.cache.obsoleteCount} obsolete, ${formatSize(data.cache.obsoleteSize)} (${data.cache.fileCount} files, ${data.cache.softwareCount} software)`)
  }

  if (summaryLines.length) {
    writeRichPanel(host, "Summary", summaryLines, {
      color: result.success ? "green" : "yellow",
      minWidth: Math.min(76, columns - 6),
    })
  }

  if (data.installedPackages.length) {
    writeLine(host, rich(host, "已安装包：", "cyan"))
    for (const name of data.installedPackages.slice(0, 40)) writeLine(host, `  ${rich(host, name, "green")}`)
    if (data.installedPackages.length > 40) writeLine(host, rich(host, `  ... 还有 ${data.installedPackages.length - 40} 个`, "grey"))
  }

  if (data.buckets.length) {
    writeLine(host, rich(host, "已配置 bucket：", "cyan"))
    for (const name of data.buckets.slice(0, 40)) writeLine(host, `  ${rich(host, name, "green")}`)
    if (data.buckets.length > 40) writeLine(host, rich(host, `  ... 还有 ${data.buckets.length - 40} 个`, "grey"))
  }

  if (data.availablePackages.length) {
    writeLine(host, rich(host, "bucket 清单：", "cyan"))
    for (const item of data.availablePackages.slice(0, 30)) {
      writeLine(host, `  ${rich(host, item.name, "magenta")}  ${item.version ?? ""}  ${item.description ?? ""}`)
    }
    if (data.availablePackages.length > 30) writeLine(host, rich(host, `  ... 还有 ${data.availablePackages.length - 30} 个`, "grey"))
  }

  if (data.syncPlan.length) {
    writeLine(host, rich(host, "sync 命令预览：", "cyan"))
    for (const item of data.syncPlan.slice(0, 30)) {
      writeLine(host, `  ${rich(host, item.label, "magenta")}: ${item.command} ${item.args.join(" ")}`)
    }
    if (data.syncPlan.length > 30) writeLine(host, rich(host, `  ... 还有 ${data.syncPlan.length - 30} 条`, "grey"))
  }

  if (data.cache?.obsoletePackages.length) {
    writeLine(host, rich(host, "过期 cache 文件：", "cyan"))
    for (const item of data.cache.obsoletePackages.slice(0, 30)) {
      writeLine(host, `  ${rich(host, item.name, "magenta")}  ${item.version}  ${formatSize(item.size)}`)
    }
    if (data.cache.obsoletePackages.length > 30) writeLine(host, rich(host, `  ... 还有 ${data.cache.obsoletePackages.length - 30} 个`, "grey"))
  }

  if (data.errors.length) writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })
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

function cleanPath(value = ""): string {
  return value.trim().replace(/^["']|["']$/g, "")
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
