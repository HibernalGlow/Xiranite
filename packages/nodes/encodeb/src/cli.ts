#!/usr/bin/env node
import { lstat } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  nodeCliName,
  promptPathLines,
  promptRich,
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
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"

import type { EncodebAction, EncodebInput, EncodebMapping, EncodebResult, EncodebStrategy } from "./core.js"
import { ENCODEB_PRESETS, parseEncodebPaths, runEncodeb } from "./core.js"
import { createNodeEncodebRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("encodeb")
const PREVIEW_LIMIT = 40

interface EncodebCliOptions {
  paths?: string
  preset?: string
  srcEncoding?: string
  dstEncoding?: string
  strategy?: string
  limit?: string
  json?: boolean
}

interface GuidedTask {
  name: "find" | "preview" | "recover"
  description: string
  action: EncodebAction
}

type GuidedPresetId = "cn" | "jp" | "jp_from_cn" | "custom"
type PathSource = "clipboard" | "manual" | "exit"
type StrategyChoice = EncodebStrategy | "exit"

interface GuidedPresetInfo {
  srcEncoding: string
  dstEncoding: string
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "paths"; paths: string[]; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  { name: "find", description: "扫描疑似乱码名称", action: "find" },
  { name: "preview", description: "预览名称重编码结果", action: "preview" },
  { name: "recover", description: "执行原地重命名（或复制）", action: "recover" },
]

const GUIDED_PRESETS: Record<Exclude<GuidedPresetId, "custom">, GuidedPresetInfo> = {
  cn: { srcEncoding: "cp437", dstEncoding: "cp936" },
  jp: { srcEncoding: "cp437", dstEncoding: "cp932" },
  jp_from_cn: { srcEncoding: "cp936", dstEncoding: "cp932" },
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Preview and recover garbled filenames by re-decoding path components.",
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
      description: "Filename encoding recovery with Typer-style commands and a Clack guided mode.",
    },
    subCommands: {
      find: defineCommand({
        meta: { name: "find", description: "Find suspicious garbled filenames." },
        args: encodebArgs(),
        async run({ args }) {
          await runAction({ ...inputFromArgs(args as EncodebCliOptions), action: "find" }, Boolean(args.json), host)
        },
      }),
      preview: defineCommand({
        meta: { name: "preview", description: "Preview filename re-encoding mappings." },
        args: encodebArgs(),
        async run({ args }) {
          await runAction({ ...inputFromArgs(args as EncodebCliOptions), action: "preview" }, Boolean(args.json), host)
        },
      }),
      recover: defineCommand({
        meta: { name: "recover", description: "Apply filename recovery." },
        args: encodebArgs(),
        async run({ args }) {
          await runAction({ ...inputFromArgs(args as EncodebCliOptions), action: "recover" }, Boolean(args.json), host)
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

function encodebArgs() {
  return {
    paths: { type: "string", description: "Paths separated by semicolon or new lines." },
    preset: { type: "string", default: "cn", description: "cn, jp, kr, or custom." },
    srcEncoding: { type: "string", description: "Source encoding, e.g. cp437." },
    dstEncoding: { type: "string", description: "Destination encoding, e.g. cp936." },
    strategy: { type: "string", default: "replace", description: "replace or copy." },
    limit: { type: "string", default: "200", description: "Maximum preview/find results." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: EncodebCliOptions): EncodebInput {
  const preset = ENCODEB_PRESETS[args.preset as keyof typeof ENCODEB_PRESETS]
  return {
    paths: parseEncodebPaths((args.paths ?? "").split(";")),
    srcEncoding: args.srcEncoding ?? preset?.srcEncoding ?? "cp437",
    dstEncoding: args.dstEncoding ?? preset?.dstEncoding ?? "cp936",
    strategy: args.strategy === "copy" ? "copy" : "replace",
    limit: Number(args.limit ?? 200),
  }
}

async function runAction(input: EncodebInput, json: boolean, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runEncodeb(input, createNodeEncodebRuntime(), (event) => {
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
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  if (input.action === "find") {
    for (const match of result.data?.matches ?? []) writeLine(host, match)
  } else if (input.action === "preview") {
    for (const mapping of result.data?.mappings ?? []) {
      writeLine(host, `${mapping.src} ${rich(host, "->", "grey")} ${mapping.dst}`)
    }
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} find --paths <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const defaultTask = GUIDED_TASKS[1]!
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

      const paths = choice.kind === "paths" ? choice.paths : await resolvePaths(host)
      if (!paths.length) {
        writeRichPanel(host, "Path", "未提供有效路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const preset = await resolvePreset(host)
      if (!preset) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      let strategy: EncodebStrategy | undefined
      if (choice.task.name === "recover") {
        strategy = await resolveStrategy(host)
        if (!strategy) {
          if (!await confirmRich(host, "重新开始?", false)) return
          continue
        }
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        `paths: ${paths.join("; ")}`,
        `preset: ${preset.srcEncoding} -> ${preset.dstEncoding}`,
        ...(choice.task.name === "recover" ? [`strategy: ${strategy}`] : []),
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const ok = await runGuidedTask(choice.task, paths, preset, strategy, host)
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
  writeRichPanel(host, "Xiranite Encodeb", [
    `${rich(host, "入口", "cyan")}  名称修复工具，内置 TypeScript guided flow`,
    `${rich(host, "任务", "cyan")}  find 扫描疑似乱码名称 / preview 预览重编码 / recover 原地重命名或复制`,
    `${rich(host, "预设", "cyan")}  cn / jp / jp_from_cn / custom，jp_from_cn 用于日文被中文 GBK 误解码的情况`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；recover 执行前需二次确认`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask): Promise<ResolvedGuidedChoice> {
  const first = cleanPath(await promptRich(host, "粘贴路径直接执行默认任务（可逐行输入多个）；留空进入任务选择", ""))
  if (first) {
    const inputs: string[] = [first]
    writeLine(host, rich(host, "继续输入路径，逐行回车；直接回车空行结束。", "grey"))
    while (true) {
      const suffix = ` (已收集 ${inputs.length} 条，留空结束)`
      const answer = cleanPath(await promptRich(host, `输入下一个路径${suffix}`, ""))
      if (!answer) break
      if (!inputs.includes(answer)) inputs.push(answer)
    }
    const verified = await verifyPaths(inputs)
    if (verified.length) return { kind: "paths", paths: verified, task: defaultTask }
    writeRichPanel(host, "Path", "输入的路径均无效，进入任务选择。", { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 encodeb 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入路径，并使用默认 preview 任务" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 6 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") return { kind: "task", task: defaultTask }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolvePaths(host: CliHost): Promise<string[]> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的多行路径" },
      { value: "manual", label: "手动输入路径", hint: "用分号或换行分隔" },
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
    const paths = parseEncodebPaths(clipboard)
    if (!paths.length) {
      writeRichPanel(host, "Clipboard", "剪贴板中未找到有效路径。", { color: "yellow", minWidth: 48 })
      return []
    }
    const verified = await verifyPaths(paths)
    if (!verified.length) {
      writeRichPanel(host, "Clipboard", "剪贴板中的路径均不存在。", { color: "red", minWidth: 48 })
      return []
    }
    writeLine(host, rich(host, `已从剪贴板读取 ${verified.length} 个有效路径。`, "yellow"))
    for (const path of verified) writeLine(host, rich(host, `  ${path}`, "green"))
    return verified
  }

  const inputs = await promptPathLines(host, "输入要处理的路径")
  if (!inputs.length) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return []
  }
  const verified = await verifyPaths(inputs)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在。", { color: "red", minWidth: 48 })
    return []
  }
  return verified
}

async function resolvePreset(host: CliHost): Promise<GuidedPresetInfo | undefined> {
  const presetId = await selectRich<GuidedPresetId | "exit">(
    host,
    "选择编码预设",
    [
      { value: "cn", label: "cn", hint: "cp437 -> cp936（中文）" },
      { value: "jp", label: "jp", hint: "cp437 -> cp932（日文）" },
      { value: "jp_from_cn", label: "jp_from_cn", hint: "cp936 -> cp932（日文被中文误解码）" },
      { value: "custom", label: "custom", hint: "手动输入源/目标编码" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "cn", maxItems: 5 },
  )

  if (presetId === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }

  if (presetId === "custom") {
    const srcEncoding = (await promptRich(host, "输入源编码", "cp437")).trim() || "cp437"
    const dstEncoding = (await promptRich(host, "输入目标编码", "cp936")).trim() || "cp936"
    return { srcEncoding, dstEncoding }
  }

  return GUIDED_PRESETS[presetId]
}

async function resolveStrategy(host: CliHost): Promise<EncodebStrategy | undefined> {
  const strategy = await selectRich<StrategyChoice>(
    host,
    "选择执行策略",
    [
      { value: "replace", label: "replace", hint: "原地重命名（默认）" },
      { value: "copy", label: "copy", hint: "复制到新目录" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "replace", maxItems: 4 },
  )

  if (strategy === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }

  return strategy
}

async function runGuidedTask(task: GuidedTask, paths: string[], preset: GuidedPresetInfo, strategy: EncodebStrategy | undefined, host: CliHost): Promise<boolean> {
  const baseInput: EncodebInput = {
    paths,
    srcEncoding: preset.srcEncoding,
    dstEncoding: preset.dstEncoding,
    limit: 200,
  }

  if (task.action === "find") {
    const result = await runWithProgress({ ...baseInput, action: "find" }, host)
    writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
    writeEncodebSummary(host, "Find Summary", result, "find")
    return result.success
  }

  if (task.action === "preview") {
    const result = await runWithProgress({ ...baseInput, action: "preview" }, host)
    writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
    writeEncodebSummary(host, "Preview Summary", result, "preview")
    return result.success
  }

  const previewResult = await runWithProgress({ ...baseInput, action: "preview" }, host)
  writeLine(host, previewResult.success ? rich(host, previewResult.message, "green", "bold") : rich(host, previewResult.message, "red", "bold"))
  writeEncodebSummary(host, "Preview Summary", previewResult, "preview")

  const mappings = previewResult.data?.mappings ?? []
  if (!mappings.length) {
    writeLine(host, rich(host, "没有检测到会变化的名称，无需执行恢复。", "yellow"))
    return true
  }

  const strategyDesc = strategy === "copy" ? "复制到新目录" : "原地重命名"
  const confirmed = await confirmRich(host, `确认执行 recover（${strategyDesc}）?`, true)
  if (!confirmed) {
    writeLine(host, rich(host, "操作已取消。", "yellow"))
    return true
  }

  const result = await runWithProgress({ ...baseInput, action: "recover", strategy: strategy ?? "replace" }, host)
  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeEncodebSummary(host, "Recover Summary", result, "recover", strategy)
  return result.success
}

async function runWithProgress(input: EncodebInput, host: CliHost): Promise<EncodebResult> {
  let progressActive = false
  const result = await runEncodeb(input, createNodeEncodebRuntime(), (event) => {
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

function writeEncodebSummary(host: CliHost, title: string, result: EncodebResult, kind: EncodebAction, strategy?: EncodebStrategy): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const panelWidth = Math.min(76, columns - 6)

  if (kind === "find") {
    const matches = data.matches.slice(0, PREVIEW_LIMIT)
    const lines = [
      `${rich(host, "matches", "cyan")}  ${rich(host, String(data.matches.length), "green")}`,
      rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
      ...matches.map((match, index) => `${rich(host, String(index + 1).padStart(2), "cyan")}. ${truncateVisible(match, columns - 8)}`),
    ]
    if (data.matches.length > PREVIEW_LIMIT) lines.push(rich(host, `... 还有 ${data.matches.length - PREVIEW_LIMIT} 条`, "grey"))
    writeRichPanel(host, title, lines, { color: result.success ? "green" : "yellow", minWidth: panelWidth })
    return
  }

  if (kind === "preview") {
    const mappings = data.mappings.slice(0, PREVIEW_LIMIT)
    const lines = [
      `${rich(host, "mappings", "cyan")}  ${rich(host, String(data.mappings.length), "green")}`,
      rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
      ...mappings.map((mapping) => formatMapping(host, mapping, columns - 8)),
    ]
    if (data.mappings.length > PREVIEW_LIMIT) lines.push(rich(host, `... 还有 ${data.mappings.length - PREVIEW_LIMIT} 条`, "grey"))
    writeRichPanel(host, title, lines, { color: result.success ? "green" : "yellow", minWidth: panelWidth })
    return
  }

  const lines = [
    `${rich(host, "processed", "cyan")}  ${rich(host, String(data.processed), "green")}`,
    `${rich(host, "strategy", "cyan")}  ${strategy === "copy" ? "复制到新目录" : "原地重命名"}`,
  ]
  writeRichPanel(host, title, lines, { color: result.success ? "green" : "yellow", minWidth: panelWidth })
}

function formatMapping(host: CliHost, mapping: EncodebMapping, budget: number): string {
  const arrow = ` ${rich(host, "->", "grey")} `
  if (budget < 24) return `${truncateVisible(mapping.src, budget)}`
  const arrowWidth = visibleWidth(arrow)
  const half = Math.floor((budget - arrowWidth) / 2)
  return `${truncateVisible(mapping.src, half)}${arrow}${truncateVisible(mapping.dst, Math.max(8, budget - half - arrowWidth))}`
}

async function verifyPaths(paths: string[]): Promise<string[]> {
  const verified: string[] = []
  for (const path of paths) {
    try {
      await lstat(path)
      verified.push(path)
    } catch {
      // skip invalid paths
    }
  }
  return verified
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

if (process.argv[1] && /\bcli\.js$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
