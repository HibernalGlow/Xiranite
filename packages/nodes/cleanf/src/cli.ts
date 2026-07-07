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
  truncateVisible,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"

import type { CleanfInput, CleanfPresetId, CleanfResult } from "./core.js"
import { CLEANING_PRESETS, getDefaultPresets, parseCleanfPaths, parseExcludeKeywords, PRESET_COMBINATIONS, runCleanf } from "./core.js"
import { createNodeCleanfRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("cleanf")
const PRESET_LIST = Object.values(CLEANING_PRESETS)
const PREVIEW_TARGET_LIMIT = 40

interface CleanfCliOptions {
  paths?: string
  presets?: string
  exclude?: string
  preview?: boolean
  json?: boolean
}

type PathSource = "clipboard" | "manual" | "exit"
type ModeChoice = "preset" | "custom" | "default" | "exit"

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Remove empty folders, backup files, temp folders, and trash patterns.",
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
      description: "File cleanup CLI with guided terminal mode and preset combinations.",
    },
    subCommands: {
      preview: defineCommand({
        meta: { name: "preview", description: "Preview cleanup targets without deleting." },
        args: cleanfArgs(true),
        async run({ args }) {
          await runAction(inputFromArgs(args as CleanfCliOptions, true), Boolean(args.json), host)
        },
      }),
      run: defineCommand({
        meta: { name: "run", description: "Execute cleanup." },
        args: cleanfArgs(false),
        async run({ args }) {
          await runAction(inputFromArgs(args as CleanfCliOptions, Boolean(args.preview)), Boolean(args.json), host)
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

function cleanfArgs(previewDefault: boolean) {
  return {
    paths: { type: "string", description: "Paths separated by semicolon or new lines." },
    presets: { type: "string", default: getDefaultPresets().join(","), description: "Comma-separated presets." },
    exclude: { type: "string", description: "Comma-separated exclude keywords." },
    preview: { type: "boolean", default: previewDefault, description: "Preview mode." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: CleanfCliOptions, preview: boolean): CleanfInput {
  return {
    paths: parseCleanfPaths(args.paths),
    presets: (args.presets ?? getDefaultPresets().join(",")).split(",").map((item) => item.trim()).filter(Boolean) as CleanfPresetId[],
    exclude: args.exclude,
    preview,
  }
}

async function runAction(input: CleanfInput, json: boolean, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runCleanf(input, createNodeCleanfRuntime(), json ? undefined : (event) => {
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
  writeCleanfSummary(host, result, Boolean(input.preview))
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} preview --paths <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  let firstRender = true

  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const paths = await resolvePaths(host)
      if (!paths.length) continue

      const presets = await resolvePresets(host)
      if (!presets.length) continue

      const exclude = await resolveExcludeKeywords(host)

      writeLine(host)
      writeSelectedPresets(host, presets, exclude)

      const confirmed = await confirmRich(host, `确认开始清理 ${paths.length} 个路径?`, true)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const previewInput: CleanfInput = { paths, presets, exclude, preview: true }
      const previewResult = await runGuidedAction(previewInput, host)

      if (!previewResult.success || !previewResult.data?.previewFiles.length) {
        writeLine(host, rich(host, "没有找到要删除的文件。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const proceed = await confirmRich(host, `确认删除以上 ${previewResult.data.previewFiles.length} 个项目?`, true)
      if (!proceed) {
        writeLine(host, rich(host, "用户取消了删除操作。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const executeInput: CleanfInput = { paths, presets, exclude, preview: false }
      await runGuidedAction(executeInput, host)

      if (!await confirmRich(host, "继续清理其他路径?", false)) return
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
  const presetLines = PRESET_LIST.map((preset) => {
    const mark = preset.enabled ? rich(host, "✓", "green") : rich(host, "✗", "grey")
    return `${mark} ${rich(host, preset.id, "magenta")}  ${preset.name} — ${preset.description}`
  })
  const comboLines = PRESET_COMBINATIONS.map((combo) => `${rich(host, combo.id, "cyan")}  ${combo.name} — ${combo.description}`)
  writeRichPanel(host, "Xiranite Cleanf", [
    `${rich(host, "入口", "cyan")}  文件清理工具，提供多种清理预设和自定义组合功能`,
    `${rich(host, "预设", "cyan")}  ${PRESET_LIST.length} 个清理项目，下方列出全部可用预设`,
    `${rich(host, "组合", "cyan")}  ${PRESET_COMBINATIONS.length} 个预设组合，方便快速选择`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；默认先预览再删除`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    ...presetLines,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    ...comboLines,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function resolvePaths(host: CliHost): Promise<string[]> {
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
    const paths = parseCleanfPaths(clipboard)
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

  const answer = (await promptRich(host, "输入要处理的文件夹路径，用分号或换行分隔", "")).trim()
  if (!answer) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return []
  }
  const paths = parseCleanfPaths(answer)
  const verified = await verifyPaths(paths)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在或不是文件夹。", { color: "red", minWidth: 48 })
    return []
  }
  return verified
}

async function resolvePresets(host: CliHost): Promise<CleanfPresetId[]> {
  const mode = await selectRich<ModeChoice>(
    host,
    "选择清理模式",
    [
      { value: "preset", label: "使用预设组合", hint: "advanced / upscale / complete" },
      { value: "custom", label: "自定义选择清理项目", hint: "输入序号，逗号分隔" },
      { value: "default", label: "使用默认启用的预设", hint: "✓ 标记的项目" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "preset", maxItems: 5 },
  )

  if (mode === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return []
  }

  if (mode === "default") {
    return getDefaultPresets()
  }

  if (mode === "preset") {
    const comboId = await selectRich<string>(
      host,
      "选择预设组合",
      PRESET_COMBINATIONS.map((combo) => ({ value: combo.id, label: combo.name, hint: combo.description })),
      { initialValue: PRESET_COMBINATIONS[0]!.id, maxItems: 4 },
    )
    const combo = PRESET_COMBINATIONS.find((item) => item.id === comboId)
    return combo?.presets ?? getDefaultPresets()
  }

  writeLine(host, rich(host, "可用的清理项目：", "cyan"))
  for (const [index, preset] of PRESET_LIST.entries()) {
    const mark = preset.enabled ? rich(host, "✓", "green") : rich(host, "✗", "grey")
    writeLine(host, `  ${rich(host, String(index + 1), "cyan")}. ${mark} ${rich(host, preset.id, "magenta")} — ${preset.name}`)
  }
  writeLine(host, rich(host, "提示: 输入序号选择项目，多个项目用逗号分隔，如 1,2,3；留空使用默认。", "grey"))

  const answer = (await promptRich(host, "请选择要执行的清理项目", "")).trim()
  if (!answer) return getDefaultPresets()

  const indices = answer.split(",").map((token) => Number.parseInt(token.trim(), 10)).filter((value) => Number.isFinite(value) && value >= 1 && value <= PRESET_LIST.length)
  if (!indices.length) {
    writeLine(host, rich(host, "输入格式错误，将使用默认启用的预设。", "red"))
    return getDefaultPresets()
  }
  return indices.map((index) => PRESET_LIST[index - 1]!.id)
}

async function resolveExcludeKeywords(host: CliHost): Promise<string | undefined> {
  const wantsExclude = await confirmRich(host, "是否要排除某些文件夹/文件?", false)
  if (!wantsExclude) return undefined
  const answer = (await promptRich(host, "输入排除关键词，多个关键词用逗号分隔", "")).trim()
  return answer || undefined
}

function writeSelectedPresets(host: CliHost, presets: CleanfPresetId[], exclude: string | undefined): void {
  const columns = terminalColumns(host)
  const lines = presets.map((id) => {
    const preset = CLEANING_PRESETS[id]
    if (!preset) return `${rich(host, id, "red")}  未知预设`
    return `${rich(host, "•", "cyan")} ${rich(host, preset.name, "green")}: ${preset.description}`
  })
  if (exclude) {
    const keywords = parseExcludeKeywords(exclude)
    lines.push(rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"))
    lines.push(`${rich(host, "排除", "red")}  ${keywords.join(", ")}`)
  }
  writeRichPanel(host, "将执行以下清理项目", lines, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

async function runGuidedAction(input: CleanfInput, host: CliHost): Promise<CleanfResult> {
  let progressActive = false
  const result = await runCleanf(input, createNodeCleanfRuntime(), (event) => {
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
  writeCleanfSummary(host, result, Boolean(input.preview))
  if (!result.success) process.exitCode = 1
  return result
}

function writeCleanfSummary(host: CliHost, result: CleanfResult, preview: boolean): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const detailLines = Object.entries(data.removedDetails).map(([key, count]) => {
    const preset = CLEANING_PRESETS[key]
    const name = preset?.name ?? key
    return `${rich(host, "•", "cyan")} ${name}: ${rich(host, String(count), "green")} 个`
  })

  const summaryLines = [
    preview
      ? `预览完成，找到 ${rich(host, String(data.totalRemoved), "yellow")} 个待删除项目。`
      : `总计删除: ${rich(host, String(data.totalRemoved), "green")} 个项目${data.skipped ? `，跳过 ${data.skipped} 个` : ""}。`,
    ...detailLines,
  ]
  writeRichPanel(host, "清理总结", summaryLines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })

  if (preview && data.previewFiles.length) {
    writeLine(host)
    writeLine(host, rich(host, "待删除文件预览：", "cyan"))
    const targets = parsePreviewTargets(data.previewFiles)
    for (const target of targets.slice(0, PREVIEW_TARGET_LIMIT)) {
      const icon = target.type === "dir" ? "📁" : "📄"
      writeLine(host, `  ${icon} ${truncateVisible(target.path, columns - 6)}`)
    }
    if (targets.length > PREVIEW_TARGET_LIMIT) {
      writeLine(host, rich(host, `  ... 还有 ${targets.length - PREVIEW_TARGET_LIMIT} 个项目`, "grey"))
    }
    const fileCount = targets.filter((target) => target.type === "file").length
    const dirCount = targets.filter((target) => target.type === "dir").length
    writeLine(host)
    writeLine(host, rich(host, `统计: ${fileCount} 个文件, ${dirCount} 个文件夹`, "blue"))
  }
}

interface PreviewTarget {
  path: string
  type: "file" | "dir"
}

function parsePreviewTargets(paths: string[]): PreviewTarget[] {
  return paths.map((path) => ({ path, type: "file" as const }))
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

function writeProgress(host: CliHost, line: string): void {
  if (host.stdout.isTTY) {
    host.stdout.write(`\r\u001b[2K${line}`)
    return
  }
  writeLine(host, line)
}

function endProgress(host: CliHost, active = true): void {
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
