#!/usr/bin/env node
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
  readStdinLines,
  renderProgressBar,
  rich,
  runMain,
  selectRich,
  terminalColumns,
  truncateVisible,
  visibleWidth,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
  runGuidedInteraction,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"

import type { MigratefAction, MigratefInput, MigratefMode, MigratefResult, MigratefRuntime } from "./core.js"
import type { MigratePlanItem } from "./core.js"
import { runMigratef } from "./core.js"
import { createNodeMigratefRuntime, readClipboardText } from "./platform.js"
import { createMigratefInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("migratef")
const DEFAULT_TARGET_DIR = "E:\\1Hub\\EH\\2EHV"

interface MigratefCliOptions {
  path?: string
  source?: string
  target?: string
  mode?: MigratefMode
  historyPath?: string
  batchId?: string
  dryRun?: boolean
  json?: boolean
}

interface MigratefNodeConfig extends CliInteractionPreferencesSource {
  enable_undo?: boolean
  history_path?: string
}

interface MigratefDefaults {
  enableUndo: boolean
  historyPath: string | undefined
}

/**
 * Resolve migratef defaults from xiranite.config.toml [nodes.migratef] section.
 * Falls back to safe defaults (enable_undo=true, no history_path override) when the
 * config file is missing or unreadable.
 */
async function resolveMigratefDefaults(host: CliHost, json: boolean): Promise<MigratefDefaults> {
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<MigratefNodeConfig>("migratef", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      enableUndo: nodeConfig?.enable_undo ?? true,
      historyPath: nodeConfig?.history_path,
    }
  } catch {
    return { enableUndo: true, historyPath: undefined }
  }
}

interface GuidedTask {
  name: string
  description: string
  defaultMode: MigratefMode
  defaultAction: "copy" | "move"
  classify?: "auto"
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "paths"; paths: string[]; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`
type ModeSelection = MigratefMode | "exit"
type ActionSelection = "copy" | "move" | "exit"

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "preserve-move",
    description: "保持目录结构移动文件（默认）",
    defaultMode: "preserve",
    defaultAction: "move",
  },
  {
    name: "flat-move",
    description: "扁平迁移文件，不保持目录结构",
    defaultMode: "flat",
    defaultAction: "move",
  },
  {
    name: "direct-move",
    description: "整体移动文件/文件夹（mv 风格）",
    defaultMode: "direct",
    defaultAction: "move",
  },
  {
    name: "direct-copy",
    description: "整体复制文件/文件夹",
    defaultMode: "direct",
    defaultAction: "copy",
  },
  {
    name: "classify-auto",
    description: "direct + classify=auto，自动路由 already/wait（classify 路由为后续工作）",
    defaultMode: "direct",
    defaultAction: "move",
    classify: "auto",
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Copy or move files with preserve, flat, direct, and undo modes.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

async function legacyRunProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  if (args.length === 0) {
    await runGuided(host)
    return
  }
  await runMain(createProgram(host), { rawArgs: args })
}

export async function runProgram(args=process.argv.slice(2),host:CliHost=createDefaultHost()):Promise<void>{await runInteractionCli({args,host,cliName:CLI_NAME,loadContext:async()=>{const{config}=await loadNodeConfigWithHints<MigratefNodeConfig>("migratef",{env:host.env,cwd:host.cwd,hintSink:{stderr:host.stderr},jsonMode:true});return{preferences:resolveInteractionPreferences(config),value:config??{}}},createDefinition:(d,language)=>({schema:createMigratefInteractionSchema({historyPath:d.history_path,dryRun:true},language),run:(input,event)=>runMigratef(input,createNodeMigratefRuntime(),event)}),runPipe:(pipeArgs,pipeHost)=>pipeArgs.length?runMain(createProgram(pipeHost),{rawArgs:pipeArgs}):Promise.resolve(writeLine(pipeHost,`${CLI_NAME} ui | gd | plan | move | copy | history | undo`)),runGuide:runGuidedInteraction,runUi:runTerminalUi,loadScreen:async()=>(await import("./Tui.js")).MigratefTui,createPreferences:(_d,current)=>migratefPreferences(host,current),reexecEntrypoint:process.argv[1],help})}
function migratefPreferences(host:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:host.env,cwd:host.cwd};return{nodeId:"migratef",current,async save(v){await updateNodeConfigFile("migratef", {cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}, o)},async restore(){const{config}=await loadNodeConfigWithHints<MigratefNodeConfig>("migratef",{...o,jsonMode:true});const p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

function createDefaultHost(): CliHost {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

async function runSubcommand(action: MigratefAction, args: MigratefCliOptions, host: CliHost): Promise<void> {
  const defaults = await resolveMigratefDefaults(host, Boolean(args.json))
  const resolvedArgs: MigratefCliOptions = { ...args }
  const readablePipe = hasPipedInput(host.stdin) && Symbol.asyncIterator in Object(host.stdin)
  const sourceFromStdin = args.source === "-" || (!args.source && readablePipe)
  const pathFromStdin = args.path === "-" || (!args.path && readablePipe)
  if (sourceFromStdin || pathFromStdin) {
    const stdinValue = (await readStdinLines(host.stdin)).join(";")
    if (sourceFromStdin) resolvedArgs.source = stdinValue
    if (pathFromStdin) resolvedArgs.path = stdinValue
  }
  await runAction({ action, ...inputFromArgs(resolvedArgs, defaults) }, Boolean(args.json), host)
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "File migrator with guided terminal mode." },
    subCommands: {
      plan: defineCommand({
        meta: { name: "plan", description: "Preview a migration plan." },
        args: commonArgs(),
        async run({ args }) {
          await runSubcommand("plan", args as MigratefCliOptions, host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move files or folders." },
        args: commonArgs(),
        async run({ args }) {
          await runSubcommand("move", args as MigratefCliOptions, host)
        },
      }),
      copy: defineCommand({
        meta: { name: "copy", description: "Copy files or folders." },
        args: commonArgs(),
        async run({ args }) {
          await runSubcommand("copy", args as MigratefCliOptions, host)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "Show undo history." },
        args: commonArgs(),
        async run({ args }) {
          await runSubcommand("history", args as MigratefCliOptions, host)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo a migration batch." },
        args: commonArgs(),
        async run({ args }) {
          await runSubcommand("undo", args as MigratefCliOptions, host)
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
    path: { type: "string", description: "Comma-separated source paths." },
    source: { type: "string", description: "Comma-separated source paths." },
    target: { type: "string", description: "Target directory." },
    mode: { type: "string", description: "preserve, flat, or direct." },
    historyPath: { type: "string", description: "Undo history JSON path." },
    batchId: { type: "string", description: "Undo batch id." },
    dryRun: { type: "boolean", description: "Preview without changing files." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: MigratefCliOptions, defaults: MigratefDefaults): MigratefInput {
  return {
    sourcePaths: splitArg(args.source || args.path),
    targetPath: args.target,
    mode: args.mode ?? "preserve",
    historyPath: args.historyPath ?? defaults.historyPath,
    batchId: args.batchId,
    dryRun: Boolean(args.dryRun),
  }
}

async function runAction(input: MigratefInput, json: boolean, host: CliHost): Promise<void> {
  const result = json
    ? await runMigratef(input, createNodeMigratefRuntime())
    : await runMigratefWithProgress(input, host)

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeMigratefSummary(host, result)
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} plan --source a --target b --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const runtime = createNodeMigratefRuntime()
  const defaults = await resolveMigratefDefaults(host, false)
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

      const sourcePaths = choice.kind === "paths" ? choice.paths : await resolveSourcePaths(host, runtime)
      if (!sourcePaths.length) {
        writeRichPanel(host, "Path", "未提供有效源路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      const targetPath = await resolveTargetDir(host)
      if (!targetPath) {
        writeLine(host, rich(host, "未提供目标目录。", "yellow"))
        continue
      }

      const mode = await selectMode(host, choice.task.defaultMode)
      if (mode === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const action = await selectAction(host, choice.task.defaultAction)
      if (action === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const dryRun = await confirmRich(host, "以 dry-run 预演此次迁移?", false)

      if (choice.task.classify === "auto") {
        writeRichPanel(host, "Classify", "classify=auto 已选；当前仅执行 direct 迁移，already/wait 路由为后续工作。", { color: "yellow", minWidth: 56 })
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        `sources: ${sourcePaths.join("; ")}`,
        `target: ${targetPath}`,
        `mode: ${mode}  action: ${action}  dry-run: ${dryRun ? "yes" : "no"}`,
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const ok = await runGuidedTask({ sourcePaths, targetPath, mode, action, dryRun }, host, defaults)
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
  writeRichPanel(host, "Xiranite Migratef", [
    `${rich(host, "入口", "cyan")}  文件迁移工具，支持 preserve/flat/direct 三种模式与 undo 回滚`,
    `${rich(host, "执行", "cyan")}  直接调用 migratef core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；默认 dry-run 关闭`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认 preserve-move；需要预演请用 \`${CLI_NAME} plan --source a --target b --json\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask, runtime: MigratefRuntime): Promise<ResolvedGuidedChoice> {
  const first = cleanPath(await promptRich(host, "粘贴源路径直接执行默认任务（可逐行输入多个）；留空进入任务选择", ""))

  if (first) {
    const paths: string[] = [first]
    writeLine(host, rich(host, "继续输入路径，逐行回车；直接回车空行结束。", "grey"))
    while (true) {
      const suffix = ` (已收集 ${paths.length} 条，留空结束)`
      const answer = cleanPath(await promptRich(host, `输入下一个源路径${suffix}`, ""))
      if (!answer) break
      if (!paths.includes(answer)) paths.push(answer)
    }
    const verified = await validPaths(paths, runtime)
    if (verified.length) return { kind: "paths", paths: verified, task: defaultTask }
    writeRichPanel(host, "Path", "输入的路径均无效，进入任务选择。", { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 migratef 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入源路径，并使用默认 preserve-move 任务" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 8 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") return { kind: "task", task: defaultTask }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolveSourcePaths(host: CliHost, runtime: MigratefRuntime): Promise<string[]> {
  const clipboardPaths = await pathsFromClipboard(runtime)
  if (clipboardPaths.length) {
    writeLine(host, rich(host, `已从剪贴板读取 ${clipboardPaths.length} 个路径。`, "yellow"))
    return clipboardPaths
  }

  const inputs = await promptPathLines(host, "输入源路径")
  return await validPaths(inputs, runtime)
}

async function resolveTargetDir(host: CliHost): Promise<string> {
  return await promptRich(host, "输入目标根目录路径", DEFAULT_TARGET_DIR)
}

async function selectMode(host: CliHost, defaultMode: MigratefMode): Promise<ModeSelection> {
  return await selectRich<ModeSelection>(
    host,
    "选择迁移模式",
    [
      { value: "preserve", label: "preserve", hint: "保持目录结构迁移" },
      { value: "flat", label: "flat", hint: "扁平迁移，不保持结构" },
      { value: "direct", label: "direct", hint: "整体迁移（mv 风格）" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: defaultMode, maxItems: 5 },
  )
}

async function selectAction(host: CliHost, defaultAction: "copy" | "move"): Promise<ActionSelection> {
  return await selectRich<ActionSelection>(
    host,
    "选择操作类型",
    [
      { value: "move", label: "move", hint: "移动文件/文件夹" },
      { value: "copy", label: "copy", hint: "复制文件/文件夹" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: defaultAction, maxItems: 4 },
  )
}

async function runGuidedTask(input: { sourcePaths: string[]; targetPath: string; mode: MigratefMode; action: "copy" | "move"; dryRun: boolean }, host: CliHost, defaults: MigratefDefaults): Promise<boolean> {
  const migratefInput: MigratefInput = {
    action: input.action,
    sourcePaths: input.sourcePaths,
    targetPath: input.targetPath,
    mode: input.mode,
    dryRun: input.dryRun,
    historyPath: defaults.historyPath,
  }
  const result = await runMigratefWithProgress(migratefInput, host)
  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeMigratefSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result.success
}

async function runMigratefWithProgress(input: MigratefInput, host: CliHost): Promise<MigratefResult> {
  let progressActive = false
  const result = await runMigratef(input, createNodeMigratefRuntime(), (event) => {
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

function writeMigratefSummary(host: CliHost, result: MigratefResult): void {
  const data = result.data
  if (!data) return
  const columns = terminalColumns(host)
  const plan = data.plan ?? []
  const pendingCount = plan.filter((item) => item.status === "pending").length

  writeRichPanel(host, "Summary", [
    `moved/copied: ${data.migratedCount}`,
    `skipped: ${data.skippedCount}`,
    `errors: ${data.errorCount}`,
    pendingCount ? `pending: ${pendingCount}` : "",
    `total: ${data.totalCount}`,
  ].filter(Boolean), { color: result.success ? "green" : "yellow", minWidth: Math.min(76, columns - 6) })

  for (const item of plan.slice(0, 30)) writeLine(host, formatPlanItem(item, host))
  if (plan.length > 30) writeLine(host, rich(host, `... ${plan.length - 30} more item(s)`, "grey"))
  if (data.errors.length) writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })

  const history = data.history ?? []
  if (history.length) {
    writeLine(host)
    writeLine(host, rich(host, "Undo history:", "cyan"))
    for (const item of history.slice(0, 20)) {
      const undone = item.undone ? rich(host, " (undone)", "grey") : ""
      writeLine(host, `  ${rich(host, item.id, "magenta")} ${item.action} ${item.operations.length}${undone}`)
    }
    if (history.length > 20) writeLine(host, rich(host, `... ${history.length - 20} more record(s)`, "grey"))
  }
}

function formatPlanItem(item: MigratePlanItem, host: CliHost): string {
  const status = item.status === "success"
    ? rich(host, "success", "green")
    : item.status === "error"
      ? rich(host, "error", "red")
      : item.status === "skipped"
        ? rich(host, "skipped", "yellow")
        : rich(host, "pending", "cyan")
  const arrow = ` ${rich(host, "->", "grey")} `
  const prefix = `${status} `
  if (!host.stdout.isTTY) return `${prefix}${item.sourcePath}${arrow}${item.targetPath || item.reason || ""}`

  const columns = terminalColumns(host)
  const budget = Math.max(0, columns - visibleWidth(prefix) - visibleWidth(arrow))
  if (budget < 20) return `${prefix}${truncateVisible(item.sourcePath, budget)}`

  const sourceWidth = Math.max(8, Math.floor(budget * 0.48))
  const targetWidth = Math.max(0, budget - sourceWidth)
  const source = truncateVisible(item.sourcePath, sourceWidth)
  const target = truncateVisible(item.targetPath || item.reason || "", targetWidth)
  return `${prefix}${source}${arrow}${target}`
}

async function pathsFromClipboard(runtime: MigratefRuntime): Promise<string[]> {
  const text = await readClipboardText()
  if (!text) return []
  return await validPaths(splitPaths(text), runtime)
}

async function validPaths(candidates: string[], runtime: MigratefRuntime): Promise<string[]> {
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

function splitArg(value?: string): string[] {
  return (value ?? "").split(/[,;\r\n]/).map((item) => item.trim()).filter(Boolean)
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
