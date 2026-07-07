#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
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
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { getNodeConfig, loadXiraniteConfig, resolveXiraniteConfigPath } from "@xiranite/config"

import type { MarkuAction, MarkuInput, MarkuModuleId } from "./core.js"
import { MARKU_MODULES, runMarku } from "./core.js"
import { createNodeMarkuRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("marku")

interface MarkuCliOptions {
  module?: string
  path?: string
  paths?: string
  input?: string
  inputFile?: string
  outputFile?: string
  config?: string
  recursive?: boolean
  dryRun?: boolean
  write?: boolean
  enableUndo?: boolean
  historyPath?: string
  undoId?: string
  json?: boolean
}

type GuidedMode = "files" | "text" | "exit"

/** Shape of the `[nodes.marku]` section in xiranite.config.toml. */
interface MarkuNodeConfig {
  enable_undo?: boolean
  history_path?: string
  default_module?: string
}

/** Resolved marku defaults merged from TOML and built-in fallbacks. */
interface MarkuDefaults {
  /** Whether undo recording is enabled (TOML `enable_undo`, default true). */
  enableUndo: boolean
  /** TOML `history_path`; falls back to platform default when undefined. */
  historyPath?: string
  /** TOML `default_module`; falls back to "markt" when undefined/invalid. */
  defaultModule?: string
}

/**
 * Load marku defaults from the `[nodes.marku]` section of xiranite.config.toml.
 * Returns safe fallbacks (enableUndo=true, no paths) when the file or section
 * is missing. The `--historyPath` CLI flag and platform default still take
 * precedence when this returns undefined for `historyPath`.
 */
async function resolveMarkuDefaults(host: CliHost): Promise<MarkuDefaults> {
  const configPath = resolveXiraniteConfigPath({ env: host.env, cwd: host.cwd })
  try {
    const { config } = await loadXiraniteConfig({ configPath, env: host.env, cwd: host.cwd })
    const marku = getNodeConfig<MarkuNodeConfig>(config, "marku")
    const historyPath = marku?.history_path?.trim() || undefined
    const defaultModule = marku?.default_module?.trim() || undefined
    return {
      enableUndo: marku?.enable_undo ?? true,
      historyPath,
      defaultModule,
    }
  } catch {
    return { enableUndo: true }
  }
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Markdown module toolbox with text, file, diff, and undo modes.",
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
    meta: { name: CLI_NAME, description: "Markdown processing toolbox with guided terminal mode." },
    subCommands: {
      text: defineCommand({
        meta: { name: "text", description: "Process inline text or an input file." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "text", ...await inputFromArgs(args as MarkuCliOptions, host) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      run: defineCommand({
        meta: { name: "run", description: "Process Markdown files or folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "run", ...await inputFromArgs(args as MarkuCliOptions, host) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "Show undo history." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "history", ...await inputFromArgs(args as MarkuCliOptions, host) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo the latest or selected write run." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "undo", ...await inputFromArgs(args as MarkuCliOptions, host) }, Boolean(args.json), host, args as MarkuCliOptions)
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
    module: { type: "string", description: `Module: ${MARKU_MODULES.map((item) => item.id).join(", ")}` },
    path: { type: "string", description: "Input file or folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated paths." },
    input: { type: "string", description: "Inline Markdown text." },
    inputFile: { type: "string", description: "Read Markdown text from this file." },
    outputFile: { type: "string", description: "Write text-mode output to this file." },
    config: { type: "string", description: "Module config JSON." },
    recursive: { type: "boolean", description: "Recurse into folders." },
    dryRun: { type: "boolean", description: "Preview file changes without writing." },
    write: { type: "boolean", description: "Write file changes. Overrides dry-run." },
    enableUndo: { type: "boolean", description: "Record undo state when writing." },
    historyPath: { type: "string", description: "Undo history JSON path." },
    undoId: { type: "string", description: "Undo record id." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function inputFromArgs(args: MarkuCliOptions, host: CliHost): Promise<MarkuInput> {
  const defaults = await resolveMarkuDefaults(host)
  const inputText = args.inputFile ? await readFile(args.inputFile, "utf8") : args.input
  const module = args.module
    ? (isMarkuModule(args.module) ? args.module : "markt")
    : (defaults.defaultModule && isMarkuModule(defaults.defaultModule) ? defaults.defaultModule : "markt")
  return {
    module,
    paths: splitArg(args.paths, args.path ? [args.path] : []),
    inputText,
    stepConfig: parseConfig(args.config),
    recursive: args.recursive,
    dryRun: args.write ? false : args.dryRun,
    enableUndo: args.enableUndo ?? defaults.enableUndo,
    historyPath: args.historyPath ?? defaults.historyPath,
    undoId: args.undoId,
  }
}

async function runAction(input: MarkuInput & { action: MarkuAction }, json: boolean, host: CliHost, options: MarkuCliOptions): Promise<void> {
  let progressActive = false
  const result = await runMarku(input, createNodeMarkuRuntime(), (event) => {
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

  if (options.outputFile && result.data?.outputText) await writeFile(options.outputFile, result.data.outputText, "utf8")
  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeMarkuSummary(host, result)
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} text --module markt --input "# Title" --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const runtime = createNodeMarkuRuntime()
  const defaults = await resolveMarkuDefaults(host)
  const initialModule = defaults.defaultModule && isMarkuModule(defaults.defaultModule) ? defaults.defaultModule : "markt"
  let firstRender = true

  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const module = await selectRich<MarkuModuleId>(
        host,
        "选择 marku 模块",
        MARKU_MODULES.map((item): { value: MarkuModuleId; label: string; hint: string } => ({
          value: item.id,
          label: item.id,
          hint: item.name,
        })),
        { initialValue: initialModule, maxItems: 9 },
      )

      const mode = await selectRich<GuidedMode>(
        host,
        "选择运行模式",
        [
          { value: "files", label: "处理文件/目录", hint: "扫描 .md 文件并应用模块" },
          { value: "text", label: "内联文本", hint: "粘贴 Markdown 文本，输出结果" },
          { value: "exit", label: "退出", hint: "不执行任何操作" },
        ],
        { initialValue: "files", maxItems: 4 },
      )

      if (mode === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      if (mode === "files") {
        const paths = await resolveInputPaths(host, runtime)
        if (!paths.length) continue
        const recursive = await confirmRich(host, "递归扫描子目录?", false)
        const dryRun = await confirmRich(host, "以 dry-run 模式运行 (不写文件，只输出 diff)?", true)
        await runGuidedAction({ action: "run", module, paths, recursive, dryRun, enableUndo: !dryRun, historyPath: defaults.historyPath }, host)
      } else {
        const text = await resolveInputText(host)
        if (!text) continue
        await runGuidedAction({ action: "text", module, inputText: text, historyPath: defaults.historyPath }, host)
      }

      if (!await confirmRich(host, "继续选择其他模块?", false)) return
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
  const moduleLines = MARKU_MODULES.map((item) => `${rich(host, item.id, "magenta")}  ${item.name}`)
  writeRichPanel(host, "Xiranite Marku", [
    `${rich(host, "入口", "cyan")}  Markdown 模块工具箱，支持标题/列表/表格/去重等转换`,
    `${rich(host, "模块", "cyan")}  9 个模块，下方列出全部可用模块`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；dry-run 默认开启`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    ...moduleLines,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function resolveInputPaths(host: CliHost, runtime: { pathInfo: (path: string) => Promise<{ exists: boolean; isDirectory: boolean; path: string }> }): Promise<string[]> {
  const clipboard = (await readClipboardText()).trim()
  if (clipboard) {
    const info = await runtime.pathInfo(clipboard)
    if (info.exists && info.isDirectory) {
      writeLine(host, rich(host, `已从剪贴板读取路径: ${info.path}`, "yellow"))
      return [info.path]
    }
  }

  const inputs = await promptPathLines(host, "输入文件或目录路径")
  const paths: string[] = []
  for (const input of inputs) {
    const info = await runtime.pathInfo(input)
    if (!info.exists) {
      writeRichPanel(host, "Path", `路径不存在: ${input}`, { color: "red", minWidth: 48 })
      continue
    }
    paths.push(info.path)
  }
  return paths
}

async function resolveInputText(host: CliHost): Promise<string | null> {
  const clipboard = (await readClipboardText()).trim()
  if (clipboard) {
    writeLine(host, rich(host, `已从剪贴板读取 ${clipboard.split(/\r?\n/).length} 行文本。`, "yellow"))
    return clipboard
  }
  const text = await promptRich(host, "粘贴 Markdown 文本，用 \\n 表示多行", "")
  return text || null
}

async function runGuidedAction(input: MarkuInput, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runMarku(input, createNodeMarkuRuntime(), (event) => {
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
  writeMarkuSummary(host, result)
  if (!result.success) process.exitCode = 1
}

function writeMarkuSummary(host: CliHost, result: { success: boolean; message: string; data?: { filesProcessed?: number; filesChanged?: number; inputText?: string; outputText?: string; diffText?: string; diffs?: Array<{ file: string; changed: boolean; diff: string }>; history?: Array<{ id: string; module: string; files: Array<{ path: string }>; undone?: boolean }> } }): void {
  const data = result.data
  if (!data) return

  if (data.filesProcessed !== undefined) {
    writeRichPanel(host, "Summary", [
      `files: ${data.filesProcessed}  changed: ${data.filesChanged ?? 0}`,
    ], { color: result.success ? "green" : "yellow", minWidth: 48 })

    for (const diff of data.diffs?.slice(0, 20) ?? []) {
      const status = diff.changed ? rich(host, "changed", "yellow") : rich(host, "same", "grey")
      writeLine(host, `${status} ${truncateVisible(diff.file, terminalColumns(host) - 16)}`)
    }
    if ((data.diffs?.length ?? 0) > 20) writeLine(host, rich(host, `... ${(data.diffs?.length ?? 0) - 20} more file(s)`, "grey"))
  }

  if (data.outputText && data.outputText !== data.inputText) {
    writeLine(host)
    writeRichPanel(host, "Output", truncateVisible(data.outputText, terminalColumns(host) - 6), { color: "green", minWidth: 48 })
  }

  if (data.history?.length) {
    writeLine(host)
    writeLine(host, rich(host, "Undo history:", "cyan"))
    for (const record of data.history.slice(0, 20)) {
      const status = record.undone ? rich(host, "undone", "grey") : rich(host, "active", "green")
      writeLine(host, `${status} ${record.id} ${rich(host, record.module, "magenta")} ${record.files.length} file(s)`)
    }
  }
}

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

function parseConfig(value?: string): Record<string, unknown> {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function isMarkuModule(value?: string): value is MarkuModuleId {
  return MARKU_MODULES.some((item) => item.id === value)
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

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
