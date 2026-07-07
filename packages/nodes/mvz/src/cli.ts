#!/usr/bin/env node
import { readFile } from "node:fs/promises"
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

import type { MvzAction, MvzInput, MvzResult } from "./core.js"
import { parseMvzEntries, runMvz } from "./core.js"
import { createNodeMvzRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("mvz")
const PREVIEW_LIMIT = 50

interface MvzCliOptions {
  entry?: string
  entries?: string
  file?: string
  output?: string
  pattern?: string
  replacement?: string
  separator?: string
  near?: boolean
  autoDir?: boolean
  flatten?: boolean
  dryRun?: boolean
  json?: boolean
}

interface MvzGuidedOptions {
  output?: string
  near: boolean
  autoDir: boolean
  flatten: boolean
  pattern?: string
  replacement?: string
  dryRun: boolean
}

type GuidedAction = MvzAction | "exit"
type EntrySource = "clipboard" | "file" | "manual" | "exit"

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Delete, extract, move, or rename archive-internal files from archive//path lines.",
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
    meta: { name: CLI_NAME, description: "7-Zip archive member workflow with guided terminal mode." },
    subCommands: {
      extract: defineCommand({
        meta: { name: "extract", description: "Extract matching archive-internal files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("extract", await inputFromArgs(args as MvzCliOptions), Boolean(args.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Extract matching files, then delete them from archives." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("move", await inputFromArgs(args as MvzCliOptions), Boolean(args.json), host)
        },
      }),
      delete: defineCommand({
        meta: { name: "delete", description: "Delete matching archive-internal files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("delete", await inputFromArgs(args as MvzCliOptions), Boolean(args.json), host)
        },
      }),
      rename: defineCommand({
        meta: { name: "rename", description: "Rename matching archive-internal files with a regex replacement." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("rename", await inputFromArgs(args as MvzCliOptions), Boolean(args.json), host)
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
    entry: { type: "string", description: "Single archive//internal entry." },
    entries: { type: "string", description: "Newline, comma, or semicolon separated archive//internal entries." },
    file: { type: "string", description: "Text file containing archive//internal entries." },
    output: { type: "string", description: "Output directory for extract or move." },
    pattern: { type: "string", description: "Regex pattern for rename." },
    replacement: { type: "string", description: "Replacement text for rename." },
    separator: { type: "string", description: "Archive/internal separator, default //." },
    near: { type: "boolean", description: "Extract next to each archive." },
    autoDir: { type: "boolean", description: "Append archive stem as output folder." },
    flatten: { type: "boolean", description: "Use 7z e instead of 7z x." },
    dryRun: { type: "boolean", description: "Plan commands without executing 7-Zip." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function inputFromArgs(args: MvzCliOptions): Promise<MvzInput> {
  const fileText = args.file ? await readFile(args.file, "utf8") : undefined
  return {
    fileText,
    files: splitArg(args.entries, args.entry ? [args.entry] : []),
    output: args.output,
    pattern: args.pattern,
    replacement: args.replacement,
    separator: args.separator,
    near: args.near,
    autoDir: args.autoDir,
    flatten: args.flatten,
    dryRun: args.dryRun,
  }
}

async function runAction(action: MvzAction, input: MvzInput, json: boolean, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runMvz({ ...input, action }, createNodeMvzRuntime(), (event) => {
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
  writeMvzSummary(host, result)
  if (!result.success) process.exitCode = 1
}

function writeMvzSummary(host: CliHost, result: MvzResult): void {
  const data = result.data
  if (!data) return
  const columns = terminalColumns(host)
  writeRichPanel(host, "Summary", [
    `action: ${data.action}`,
    `archives: ${data.totalArchives}  files: ${data.totalFiles}`,
    `success: ${data.successCount}  failed: ${data.failedCount}`,
  ], { color: result.success ? "green" : "yellow", minWidth: 76 })

  if (data.preview.length) {
    writeLine(host, rich(host, "待执行命令预览：", "cyan"))
    for (const item of data.preview.slice(0, PREVIEW_LIMIT)) {
      const action = rich(host, item.action, "magenta")
      const arrow = rich(host, "->", "grey")
      const command = truncateVisible(item.command ?? "", Math.max(0, columns - 6))
      writeLine(host, `  ${action} ${item.archive} ${arrow} ${command}`)
    }
    if (data.preview.length > PREVIEW_LIMIT) {
      writeLine(host, rich(host, `  ... 还有 ${data.preview.length - PREVIEW_LIMIT} 条预览`, "grey"))
    }
  }

  if (data.results.length) {
    writeLine(host, rich(host, "执行结果：", "cyan"))
    for (const item of data.results.slice(0, PREVIEW_LIMIT)) {
      const status = item.success ? rich(host, "ok", "green") : rich(host, "fail", "red")
      const action = rich(host, item.action, "magenta")
      const archive = truncateVisible(item.archive, Math.max(0, columns - 8))
      writeLine(host, `  ${status} ${action} ${archive}`)
      if (item.message) writeLine(host, rich(host, `    ${item.message}`, "grey"))
    }
    if (data.results.length > PREVIEW_LIMIT) {
      writeLine(host, rich(host, `  ... 还有 ${data.results.length - PREVIEW_LIMIT} 条结果`, "grey"))
    }
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} extract --entry archive.zip//file.txt --dry-run --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  let firstRender = true

  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const action = await selectAction(host)
      if (action === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const entries = await resolveEntries(host)
      if (!entries.length) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const options = await resolveActionOptions(host, action)
      if (!options) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      writeLine(host)
      writeGuidedSummary(host, action, entries, options)

      const confirmed = await confirmRich(host, `确认执行 ${action} 操作?`, !options.dryRun)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      await runGuidedAction(action, entries, options, host)

      if (!await confirmRich(host, "继续处理其他条目?", false)) return
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
  writeRichPanel(host, "Xiranite Mvz", [
    `${rich(host, "入口", "cyan")}  7-Zip 压缩包内文件操作工具，输入 archive.zip//internal/path 形式的条目`,
    `${rich(host, "动作", "cyan")}  extract / move / delete / rename，按需选择输出目录、近邻、自动子目录、扁平化等选项`,
    `${rich(host, "输入", "cyan")}  剪贴板优先；可改用文件路径或手动输入；条目格式同 findz 输出`,
    `${rich(host, "预演", "cyan")}  默认建议先 dry-run 预览命令，确认后再实际执行`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: scripted 模式可使用 \`${CLI_NAME} extract --entry archive.zip//file.txt --dry-run --json\`。`, "grey"))
}

async function selectAction(host: CliHost): Promise<GuidedAction> {
  return await selectRich<GuidedAction>(
    host,
    "选择要执行的动作",
    [
      { value: "extract", label: "extract", hint: "从压缩包中提取匹配文件" },
      { value: "move", label: "move", hint: "提取后从压缩包删除原文件" },
      { value: "delete", label: "delete", hint: "从压缩包中删除匹配文件" },
      { value: "rename", label: "rename", hint: "使用正则重命名压缩包内文件" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: "extract", maxItems: 5 },
  )
}

async function resolveEntries(host: CliHost): Promise<string[]> {
  const source = await selectRich<EntrySource>(
    host,
    "选择条目输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取条目", hint: "复制的多行 archive//path" },
      { value: "file", label: "从文本文件读取条目", hint: "输入文件路径" },
      { value: "manual", label: "手动输入条目", hint: "每行一个，可分号或逗号分隔" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return []
  }

  if (source === "clipboard") {
    const text = (await readClipboardText()).trim()
    if (!text) {
      writeRichPanel(host, "Clipboard", "剪贴板为空，请改用文件或手动输入。", { color: "yellow", minWidth: 48 })
      return []
    }
    const entries = splitArg(text)
    writeLine(host, rich(host, `已从剪贴板读取 ${entries.length} 行。`, "yellow"))
    return entries
  }

  if (source === "file") {
    const answer = (await promptRich(host, "输入包含条目的文本文件路径", "")).trim()
    if (!answer) {
      writeLine(host, rich(host, "未输入文件路径。", "yellow"))
      return []
    }
    try {
      const text = await readFile(answer, "utf8")
      const entries = splitArg(text)
      writeLine(host, rich(host, `已从文件读取 ${entries.length} 行。`, "yellow"))
      return entries
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeRichPanel(host, "File", `读取文件失败: ${message}`, { color: "red", minWidth: 48 })
      return []
    }
  }

  const answer = (await promptRich(host, "输入条目，用换行、分号或逗号分隔", "")).trim()
  if (!answer) {
    writeLine(host, rich(host, "未输入任何条目。", "yellow"))
    return []
  }
  return splitArg(answer)
}

async function resolveActionOptions(host: CliHost, action: MvzAction): Promise<MvzGuidedOptions | null> {
  let output: string | undefined
  let near = false
  let autoDir = false
  let flatten = false
  let pattern: string | undefined
  let replacement: string | undefined

  if (action === "extract" || action === "move") {
    const outputAnswer = (await promptRich(host, "输出目录 (留空表示近邻压缩包)", "")).trim()
    if (outputAnswer) {
      output = outputAnswer
      near = false
    } else {
      near = true
    }
    autoDir = await confirmRich(host, "为每个压缩包创建以压缩包名命名的子目录?", true)
    flatten = await confirmRich(host, "扁平化提取 (使用 7z e，忽略内部目录结构)?", false)
  }

  if (action === "rename") {
    const patternAnswer = (await promptRich(host, "输入正则匹配模式", "")).trim()
    if (!patternAnswer) {
      writeRichPanel(host, "Pattern", "未输入正则模式。", { color: "red", minWidth: 48 })
      return null
    }
    pattern = patternAnswer
    replacement = (await promptRich(host, "输入替换文本 (可留空)", "")).trim() || ""
  }

  const dryRun = await confirmRich(host, "使用 dry-run 预演命令 (不实际执行 7-Zip)?", action === "rename" || action === "delete")

  return { output, near, autoDir, flatten, pattern, replacement, dryRun }
}

function writeGuidedSummary(host: CliHost, action: MvzAction, entries: string[], options: MvzGuidedOptions): void {
  const parsed = parseMvzEntries(entries)
  const archives = new Set(parsed.map((entry) => entry.archivePath)).size
  const columns = terminalColumns(host)
  const lines = [
    `${rich(host, "动作", "cyan")}  ${action}`,
    `${rich(host, "条目", "cyan")}  ${parsed.length} 条 / ${archives} 个压缩包`,
  ]
  if (action === "extract" || action === "move") {
    lines.push(`${rich(host, "输出", "cyan")}  ${options.output ?? (options.near ? "<近邻压缩包>" : "<当前目录>")}`)
    lines.push(`${rich(host, "选项", "cyan")}  near=${options.near}  autoDir=${options.autoDir}  flatten=${options.flatten}`)
  }
  if (action === "rename") {
    lines.push(`${rich(host, "模式", "cyan")}  ${options.pattern ?? ""}`)
    lines.push(`${rich(host, "替换", "cyan")}  ${options.replacement === "" ? "<空字符串>" : options.replacement}`)
  }
  lines.push(`${rich(host, "预演", "cyan")}  ${options.dryRun ? "是 (仅展示命令)" : "否 (实际执行 7-Zip)"}`)
  writeRichPanel(host, "将执行以下操作", lines, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

async function runGuidedAction(action: MvzAction, entries: string[], options: MvzGuidedOptions, host: CliHost): Promise<void> {
  const input: MvzInput = {
    action,
    files: entries,
    output: options.output,
    near: options.near,
    autoDir: options.autoDir,
    flatten: options.flatten,
    pattern: options.pattern,
    replacement: options.replacement,
    dryRun: options.dryRun,
  }
  await runAction(action, input, false, host)
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
