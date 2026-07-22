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
  truncateVisible,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
  runGuidedInteraction,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, stringifyToml, updateNodeConfigFile } from "@xiranite/config"

import type { SeriexInput, SeriexResult } from "./core.js"
import { runSeriex } from "./core.js"
import { createNodeSeriexRuntime, readClipboardText } from "./platform.js"
import { createSeriexInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("seriex")

interface SeriexCliOptions {
  path?: string
  config?: string
  prefix?: string
  known?: string
  knownDir?: string
  noPrefix?: boolean
  dryRun?: boolean
  json?: boolean
  threshold?: number | string
  ratio?: number | string
  partial?: number | string
  token?: number | string
  lengthDiff?: number | string
}

type PathSource = "clipboard" | "manual" | "current" | "exit"

interface GuidedSeriexOptions {
  configPath?: string
  configText?: string
  addPrefix: boolean
  prefix: string
  knownSeriesDirs: string[]
  threshold: number
  ratioThreshold: number
  partialThreshold: number
  tokenThreshold: number
  lengthDiffMax: number
}

const DEFAULT_GUIDED_OPTIONS: GuidedSeriexOptions = {
  addPrefix: true,
  prefix: "[#s]",
  knownSeriesDirs: [],
  threshold: 75,
  ratioThreshold: 75,
  partialThreshold: 85,
  tokenThreshold: 80,
  lengthDiffMax: 0.3,
}

export interface ResolvedSeriexConfig {
  configPath?: string
  configText?: string
}

/**
 * Resolve seriex config with priority: --config explicit > xiranite.config.toml [nodes.seriex] > none.
 */
export async function resolveSeriexConfig(
  args: { config?: string },
  host: CliHost,
  json: boolean,
): Promise<ResolvedSeriexConfig> {
  // Priority 1: --config explicit
  if (args.config) {
    return { configPath: args.config }
  }

  // Priority 2: xiranite.config.toml [nodes.seriex]
  try {
    const { config: seriexNode } = await loadNodeConfigWithHints<Record<string, unknown>>("seriex", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    if (seriexNode && Object.keys(seriexNode).length > 0) {
      return { configText: stringifyToml(seriexNode) }
    }
  } catch {
    // ignore - fall through to no config
  }

  // Priority 3: none
  return {}
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Plan and apply archive series extraction.",
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

interface SeriexNodePreferences extends CliInteractionPreferencesSource { config_path?:string; directory_path?:string; threshold?:number; ratio_threshold?:number; partial_threshold?:number; token_threshold?:number; length_diff_max?:number; add_prefix?:boolean; prefix?:string; known_series_dirs?:string[]; known_series_names?:string[]; dry_run?:boolean }
export async function runProgram(args=process.argv.slice(2),host:CliHost=createDefaultHost()):Promise<void>{await runInteractionCli({args,host,cliName:CLI_NAME,loadContext:async()=>{const{config}=await loadNodeConfigWithHints<SeriexNodePreferences>("seriex",{env:host.env,cwd:host.cwd,hintSink:{stderr:host.stderr},jsonMode:true});return{preferences:resolveInteractionPreferences(config),value:config??{}}},createDefinition:(d,language)=>({schema:createSeriexInteractionSchema({directoryPath:d.directory_path,configPath:d.config_path,threshold:d.threshold,ratioThreshold:d.ratio_threshold,partialThreshold:d.partial_threshold,tokenThreshold:d.token_threshold,lengthDiffMax:d.length_diff_max,addPrefix:d.add_prefix,prefix:d.prefix,knownSeriesDirs:d.known_series_dirs?.join("\n"),knownSeriesNames:d.known_series_names?.join("\n"),dryRun:d.dry_run},language),run:(input,event)=>runSeriex(input,createNodeSeriexRuntime(),event)}),runPipe:(pipeArgs,pipeHost)=>pipeArgs.length?runMain(createProgram(pipeHost),{rawArgs:pipeArgs}):Promise.resolve(writeLine(pipeHost,`${CLI_NAME} ui | gd | plan | execute`)),runGuide:runGuidedInteraction,runUi:runTerminalUi,loadScreen:async()=>(await import("./Tui.js")).SeriexTui,createPreferences:(_d,current)=>seriexPreferences(host,current),reexecEntrypoint:process.argv[1],help})}
function seriexPreferences(host:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:host.env,cwd:host.cwd};return{nodeId:"seriex",current,async save(v){await updateNodeConfigFile("seriex", {cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}, o)},async restore(){const{config}=await loadNodeConfigWithHints<SeriexNodePreferences>("seriex",{...o,jsonMode:true});const p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

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
    meta: { name: CLI_NAME, description: "Series archive extractor with guided terminal mode." },
    subCommands: {
      plan: defineCommand({
        meta: { name: "plan", description: "Generate a series extraction plan." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveSeriexArgs(args as SeriexCliOptions, host)
          const input: SeriexInput = { action: "plan", ...inputFromArgs(opts) }
          const resolved = await resolveSeriexConfig(opts, host, Boolean(opts.json))
          if (resolved.configText) input.configText = resolved.configText
          await runAction(input, Boolean(opts.json), host)
        },
      }),
      execute: defineCommand({
        meta: { name: "execute", description: "Generate and apply a series extraction plan." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveSeriexArgs(args as SeriexCliOptions, host)
          const input: SeriexInput = { action: "execute", ...inputFromArgs(opts) }
          const resolved = await resolveSeriexConfig(opts, host, Boolean(opts.json))
          if (resolved.configText) input.configText = resolved.configText
          await runAction(input, Boolean(opts.json), host)
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
    path: { type: "string", description: "Directory to process." },
    config: { type: "string", description: "seriex.toml path." },
    prefix: { type: "string", description: "Series folder prefix." },
    known: { type: "string", description: "Comma-separated known series names." },
    knownDir: { type: "string", description: "Comma-separated reference directories." },
    noPrefix: { type: "boolean", description: "Do not prefix generated series folders." },
    dryRun: { type: "boolean", description: "Only print the plan." },
    threshold: { type: "string", description: "Base similarity threshold (0-100)." },
    ratio: { type: "string", description: "Exact match threshold (0-100)." },
    partial: { type: "string", description: "Partial match threshold (0-100)." },
    token: { type: "string", description: "Token match threshold (0-100)." },
    lengthDiff: { type: "string", description: "Maximum length difference (0-1)." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function resolveSeriexArgs(args: SeriexCliOptions, host: CliHost): Promise<SeriexCliOptions> {
  if (!(args.path === "-" || (!args.path && hasPipedInput(host.stdin)))) return args
  const stdinLine = (await readStdinLines(host.stdin))[0] ?? ""
  return { ...args, path: stdinLine }
}

function inputFromArgs(args: SeriexCliOptions): Omit<SeriexInput, "action"> {
  return {
    directoryPath: args.path,
    configPath: args.config,
    prefix: args.prefix || "[#s]",
    addPrefix: !args.noPrefix,
    knownSeriesNames: splitArg(args.known),
    knownSeriesDirs: splitArg(args.knownDir),
    dryRun: Boolean(args.dryRun),
    threshold: numberArg(args.threshold),
    ratioThreshold: numberArg(args.ratio),
    partialThreshold: numberArg(args.partial),
    tokenThreshold: numberArg(args.token),
    lengthDiffMax: numberArg(args.lengthDiff),
  }
}

async function runAction(input: SeriexInput, json: boolean, host: CliHost): Promise<SeriexResult> {
  let progressActive = false
  const result = await runSeriex(input, createNodeSeriexRuntime(), json ? undefined : (event) => {
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
  writeSeriexSummary(host, result, input.action === "plan" || Boolean(input.dryRun))
  if (!result.success) process.exitCode = 1
  return result
}

function writeSeriexSummary(host: CliHost, result: SeriexResult, planMode: boolean): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const tree = planMode ? data.plan : data.summary
  const title = planMode ? "计划预览" : "执行结果"
  const treeLines = renderPlanTree(host, title, tree, columns - 4)

  const summaryLines = [
    ...treeLines,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    `${rich(host, "系列", "cyan")}  ${data.totalSeries} 个`,
    `${rich(host, "文件", "cyan")}  ${data.totalFiles} 个`,
    planMode ? "" : `${rich(host, "成功", "green")}  ${data.movedCount}  ${rich(host, "失败", "red")}  ${data.failedCount}`,
  ].filter(Boolean)

  writeRichPanel(host, "Seriex", summaryLines, {
    color: result.success ? "green" : "yellow",
    maxWidth: columns - 2,
    minWidth: Math.min(76, columns - 6),
  })

  if (data.errors.length) writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })
}

function renderPlanTree(host: CliHost, title: string, plan: Record<string, Record<string, string[]>>, maxWidth: number): string[] {
  const lines: string[] = [rich(host, title, "cyan", "bold")]
  const directories = Object.entries(plan)
  if (!directories.length) {
    lines.push(rich(host, "无可执行计划", "yellow"))
    return lines
  }

  directories.forEach(([directory, groups], dirIndex) => {
    const isLastDir = dirIndex === directories.length - 1
    const dirPrefix = isLastDir ? "└── " : "├── "
    lines.push(`${rich(host, dirPrefix, "grey")}${rich(host, truncateVisible(directory, Math.max(8, maxWidth - 4)), "blue")}`)
    const groupEntries = Object.entries(groups)
    const indent = isLastDir ? "    " : "│   "
    groupEntries.forEach(([folder, files], groupIndex) => {
      const isLastGroup = groupIndex === groupEntries.length - 1
      const branch = isLastGroup ? "└── " : "├── "
      lines.push(`${rich(host, indent, "grey")}${rich(host, branch, "grey")}${rich(host, folder, "magenta")}  ${rich(host, `(${files.length})`, "grey")}`)
      files.forEach((file, fileIndex) => {
        const isLastFile = fileIndex === files.length - 1
        const fileBranch = isLastFile ? "└── " : "├── "
        const fileName = file.split(/[\\/]/).filter(Boolean).at(-1) ?? file
        lines.push(`${rich(host, indent, "grey")}    ${rich(host, fileBranch, "grey")}${truncateVisible(fileName, Math.max(8, maxWidth - 10))}`)
      })
    })
  })

  return lines
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} plan --path <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  let firstRender = true
  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const paths = await resolvePaths(host)
      if (!paths.length) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const options = await resolveSeriexOptions(host)
      writeLine(host)
      writeSelectedOptions(host, options)

      const confirmed = await confirmRich(host, `开始处理 ${paths.length} 个路径?`, true)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      let successCount = 0
      for (const path of paths) {
        const ok = await runGuidedPath(path, options, host)
        if (ok) successCount += 1
      }

      writeLine(host)
      if (successCount > 0) {
        writeRichPanel(host, "完成", [
          `成功处理 ${rich(host, String(successCount), "green")} / ${paths.length} 个路径`,
        ], { color: "green", minWidth: 56 })
      } else {
        writeRichPanel(host, "完成", [
          `没有成功处理任何路径 (${paths.length} 个输入)`,
        ], { color: "red", minWidth: 56 })
      }

      if (!await confirmRich(host, "继续处理其他路径?", false)) return
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
  writeRichPanel(host, "Xiranite Seriex", [
    `${rich(host, "入口", "cyan")}  漫画压缩包系列提取工具，自动识别并整理同一系列文件`,
    `${rich(host, "能力", "cyan")}  支持剪贴板/手动输入路径；可调相似度、前缀、已知系列目录`,
    `${rich(host, "流程", "cyan")}  先生成计划树，确认后再执行移动；可随时取消或重新开始`,
    `${rich(host, "脚本", "cyan")}  非交互场景请用 \`${CLI_NAME} plan --path <folder> --json\``,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function resolvePaths(host: CliHost): Promise<string[]> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的多行路径" },
      { value: "manual", label: "手动输入路径", hint: "每行一个，分号或换行分隔" },
      { value: "current", label: "使用当前目录", hint: "process.cwd()" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return []
  }

  if (source === "current") {
    const cwd = process.cwd()
    writeLine(host, rich(host, `使用当前目录: ${cwd}`, "yellow"))
    return [cwd]
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
    const verified = await verifyPaths(paths)
    if (!verified.length) {
      writeRichPanel(host, "Clipboard", "剪贴板中的路径均不存在或不是文件夹。", { color: "red", minWidth: 48 })
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
  const verified = await verifyPaths(paths)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在或不是文件夹。", { color: "red", minWidth: 48 })
    return []
  }
  return verified
}

async function resolveSeriexOptions(host: CliHost): Promise<GuidedSeriexOptions> {
  const options: GuidedSeriexOptions = { ...DEFAULT_GUIDED_OPTIONS }

  const wantsSimilarity = await confirmRich(host, "是否调整相似度参数?", false)
  if (wantsSimilarity) {
    options.threshold = await numberPrompt(host, "基本相似度阈值 (0-100)", options.threshold)
    options.ratioThreshold = await numberPrompt(host, "完全匹配阈值 (0-100)", options.ratioThreshold)
    options.partialThreshold = await numberPrompt(host, "部分匹配阈值 (0-100)", options.partialThreshold)
    options.tokenThreshold = await numberPrompt(host, "标记匹配阈值 (0-100)", options.tokenThreshold)
    options.lengthDiffMax = await numberPrompt(host, "长度差异最大值 (0-1)", options.lengthDiffMax)
  }

  const wantsConfig = await confirmRich(host, "是否指定 seriex.toml 配置文件?", false)
  if (wantsConfig) {
    const configPath = (await promptRich(host, "输入 TOML 配置文件路径 (留空跳过)", "")).trim()
    if (configPath) options.configPath = configPath
  }

  // Fall back to xiranite.config.toml [nodes.seriex] when no explicit config path is set
  if (!options.configPath) {
    const resolved = await resolveSeriexConfig({}, host, false)
    if (resolved.configText) options.configText = resolved.configText
  }

  options.addPrefix = await confirmRich(host, "是否为系列文件夹添加前缀?", true)
  if (options.addPrefix) {
    const custom = await confirmRich(host, "是否自定义前缀?", false)
    if (custom) {
      const prefix = (await promptRich(host, "请输入前缀", "[#s]")).trim() || "[#s]"
      options.prefix = prefix
    }
  }

  const wantsKnownDirs = await confirmRich(host, "是否指定'已知系列目录' (用于最优先匹配)?", false)
  if (wantsKnownDirs) {
    writeLine(host, rich(host, "可输入多行路径，逐行回车；直接回车空行结束。", "grey"))
    while (true) {
      const dir = (await promptRich(host, "请输入目录路径 (留空结束)", "")).trim()
      if (!dir) break
      options.knownSeriesDirs.push(dir)
    }
  }

  return options
}

async function numberPrompt(host: CliHost, prompt: string, defaultValue: number): Promise<number> {
  const answer = await promptRich(host, prompt, String(defaultValue))
  const parsed = Number(answer)
  if (Number.isFinite(parsed)) return parsed
  writeLine(host, rich(host, `输入无效，使用默认值 ${defaultValue}。`, "red"))
  return defaultValue
}

function writeSelectedOptions(host: CliHost, options: GuidedSeriexOptions): void {
  const columns = terminalColumns(host)
  const configLabel = options.configPath
    ?? (options.configText ? rich(host, "(xiranite.config.toml)", "yellow") : rich(host, "(默认)", "grey"))
  const lines = [
    `${rich(host, "相似度", "cyan")}  ${options.threshold} / ${options.ratioThreshold} / ${options.partialThreshold} / ${options.tokenThreshold} / ${options.lengthDiffMax}`,
    `${rich(host, "前缀", "cyan")}  ${options.addPrefix ? rich(host, options.prefix, "green") : rich(host, "(无前缀)", "grey")}`,
    `${rich(host, "配置", "cyan")}  ${configLabel}`,
    `${rich(host, "已知目录", "cyan")}  ${options.knownSeriesDirs.length ? options.knownSeriesDirs.join("; ") : rich(host, "(无)", "grey")}`,
  ]
  writeRichPanel(host, "将使用以下配置", lines, {
    color: "cyan",
    maxWidth: columns - 2,
    minWidth: Math.min(76, columns - 6),
  })
}

async function runGuidedPath(path: string, options: GuidedSeriexOptions, host: CliHost): Promise<boolean> {
  writeLine(host)
  writeRichPanel(host, "处理路径", [rich(host, path, "blue")], { color: "blue", minWidth: 48 })

  const baseInput: SeriexInput = {
    directoryPath: path,
    configPath: options.configPath,
    configText: options.configText,
    addPrefix: options.addPrefix,
    prefix: options.prefix,
    knownSeriesDirs: options.knownSeriesDirs,
    threshold: options.threshold,
    ratioThreshold: options.ratioThreshold,
    partialThreshold: options.partialThreshold,
    tokenThreshold: options.tokenThreshold,
    lengthDiffMax: options.lengthDiffMax,
  }

  const planResult = await runGuidedAction({ ...baseInput, action: "plan" }, host)
  if (!planResult.success) return false

  const planData = planResult.data
  if (!planData || !planData.totalFiles) {
    writeLine(host, rich(host, "无可执行计划，跳过此路径。", "yellow"))
    return false
  }

  const proceed = await confirmRich(host, "是否执行上述计划? (按 Y 回车执行 / N 回车跳过)", true)
  if (!proceed) {
    writeLine(host, rich(host, "已跳过执行。", "yellow"))
    return false
  }

  const executeResult = await runGuidedAction({ ...baseInput, action: "execute" }, host)
  if (!executeResult.success) {
    writeLine(host, rich(host, `执行失败或无变更: ${path}`, "yellow"))
    return false
  }

  writeLine(host, rich(host, `成功处理目录: ${path}`, "green"))
  return true
}

async function runGuidedAction(input: SeriexInput, host: CliHost): Promise<SeriexResult> {
  let progressActive = false
  const result = await runSeriex(input, createNodeSeriexRuntime(), (event) => {
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
  writeSeriexSummary(host, result, input.action === "plan")
  if (!result.success) process.exitCode = 1
  return result
}

async function verifyPaths(paths: string[]): Promise<string[]> {
  const verified: string[] = []
  for (const path of paths) {
    try {
      const info = await lstat(path)
      if (info.isDirectory()) verified.push(path)
    } catch {
      // skip invalid paths
    }
  }
  return verified
}

function splitPaths(value?: string): string[] {
  return (value ?? "").split(/[,;\r\n]/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
}

function splitArg(value?: string): string[] {
  return (value ?? "").split(/[,;\r\n]/).map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: number | string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
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
