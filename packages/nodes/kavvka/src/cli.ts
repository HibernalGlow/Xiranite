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
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"

import type { KavvkaAction, KavvkaInput, KavvkaResult } from "./core.js"
import { DEFAULT_KAVVKA_KEYWORDS, parseKavvkaKeywords, parseKavvkaPaths, runKavvka } from "./core.js"
import { createNodeKavvkaRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("kavvka")
const SUMMARY_PATH_LIMIT = 20

interface KavvkaCliOptions {
  path?: string
  paths?: string
  root?: string
  roots?: string
  keyword?: string
  keywords?: string
  depth?: string | number
  force?: boolean
  dryRun?: boolean
  strictArtist?: boolean
  json?: boolean
}

type PathSource = "clipboard" | "manual" | "exit"
type ActionChoice = KavvkaAction | "exit"

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Prepare Czkawka include paths from gallery folders.",
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
    meta: { name: CLI_NAME, description: "Czkawka path helper with guided terminal mode." },
    subCommands: {
      process: defineCommand({
        meta: { name: "process", description: "Move sibling folders into #compare and print Czkawka paths." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "process", ...inputFromArgs(args as KavvkaCliOptions) }, Boolean(args.json), host)
        },
      }),
      plan: defineCommand({
        meta: { name: "plan", description: "Preview process results without moving folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "plan", ...inputFromArgs(args as KavvkaCliOptions), dryRun: true }, Boolean(args.json), host)
        },
      }),
      scan: defineCommand({
        meta: { name: "scan", description: "Find folders whose names contain gallery keywords." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "scan", ...inputFromArgs(args as KavvkaCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Source path for process/plan." },
    paths: { type: "string", description: "Semicolon, comma, or newline-separated source paths." },
    root: { type: "string", description: "Scan root for scan." },
    roots: { type: "string", description: "Semicolon, comma, or newline-separated scan roots." },
    keyword: { type: "string", description: "Comma-separated scan keywords." },
    keywords: { type: "string", description: "Comma-separated scan keywords." },
    depth: { type: "string", description: "Scan depth." },
    force: { type: "boolean", description: "Move without confirmation. Non-interactive commands default to force." },
    dryRun: { type: "boolean", description: "Preview without moving folders." },
    strictArtist: { type: "boolean", description: "Require an ancestor or child folder with [] marker." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: KavvkaCliOptions): KavvkaInput {
  return {
    paths: parseList(args.paths || args.path),
    scanRoots: parseList(args.roots || args.root),
    keywords: parseKavvkaKeywords(args.keywords || args.keyword),
    scanDepth: parseDepth(args.depth),
    force: args.force ?? true,
    dryRun: Boolean(args.dryRun),
    strictArtist: Boolean(args.strictArtist),
  }
}

async function runAction(input: KavvkaInput, json: boolean, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runKavvka(input, createNodeKavvkaRuntime(), (event) => {
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
  writeKavvkaSummary(host, result)
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} scan --root <folder> --json\` or \`${CLI_NAME} process --path <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  let firstRender = true
  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const action = await resolveAction(host)
      if (!action) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const input = await resolveInput(host, action)
      if (!input) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      writeLine(host)
      writeSelectedPlan(host, action, input)

      const confirmed = await confirmRich(host, `确认开始执行 ${action}?`, true)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      await runGuidedAction(input, host)

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
  writeRichPanel(host, "Xiranite Kavvka", [
    `${rich(host, "入口", "cyan")}  Czkawka 包含路径准备工具，提供扫描、规划、处理三种模式`,
    `${rich(host, "动作", "cyan")}  scan 扫描关键词目录；plan 预演移动结果；process 执行移动并生成路径`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；默认使用内置画集关键词`,
    `${rich(host, "提示", "cyan")}  非交互场景请用 \`${CLI_NAME} scan --root <folder> --json\``,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function resolveAction(host: CliHost): Promise<KavvkaAction | undefined> {
  const action = await selectRich<ActionChoice>(
    host,
    "选择 kavvka 动作",
    [
      { value: "scan", label: "scan", hint: "扫描关键词目录" },
      { value: "plan", label: "plan", hint: "预演移动结果，不实际移动" },
      { value: "process", label: "process", hint: "移动同级目录到 #compare 并生成路径" },
      { value: "exit", label: "exit", hint: "退出引导" },
    ],
    { initialValue: "scan", maxItems: 5 },
  )

  if (action === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }
  return action
}

async function resolveInput(host: CliHost, action: KavvkaAction): Promise<KavvkaInput | undefined> {
  if (action === "scan") return await resolveScanInput(host)
  return await resolveProcessInput(host, action)
}

async function resolveScanInput(host: CliHost): Promise<KavvkaInput | undefined> {
  const roots = await resolvePaths(host, "扫描根目录")
  if (!roots.length) return undefined

  const keywords = await resolveKeywords(host)
  const depth = await resolveDepth(host)
  return { action: "scan", scanRoots: roots, keywords, scanDepth: depth }
}

async function resolveProcessInput(host: CliHost, action: KavvkaAction): Promise<KavvkaInput | undefined> {
  const paths = await resolvePaths(host, "源目录")
  if (!paths.length) return undefined

  const strictArtist = await confirmRich(host, "要求源目录存在 [] 画师标记?", false)
  return {
    action,
    paths,
    dryRun: action === "plan",
    force: action === "process",
    strictArtist,
  }
}

async function resolvePaths(host: CliHost, label: string): Promise<string[]> {
  const source = await selectRich<PathSource>(
    host,
    `选择${label}输入方式`,
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
    const paths = parseKavvkaPaths(clipboard)
    if (!paths.length) {
      writeRichPanel(host, "Clipboard", "剪贴板中未找到有效路径。", { color: "yellow", minWidth: 48 })
      return []
    }
    const verified = await verifyDirectories(paths)
    if (!verified.length) {
      writeRichPanel(host, "Clipboard", "剪贴板中的路径均不存在或不是文件夹。", { color: "red", minWidth: 48 })
      return []
    }
    writeLine(host, rich(host, `已从剪贴板读取 ${verified.length} 个有效路径。`, "yellow"))
    for (const path of verified) writeLine(host, rich(host, `  ${path}`, "green"))
    return verified
  }

  const inputs = await promptPathLines(host, `输入${label}路径`)
  if (!inputs.length) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return []
  }
  const verified = await verifyDirectories(inputs)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在或不是文件夹。", { color: "red", minWidth: 48 })
    return []
  }
  return verified
}

async function resolveKeywords(host: CliHost): Promise<string[]> {
  const useDefault = await confirmRich(host, "使用内置画集关键词?", true)
  if (useDefault) return [...DEFAULT_KAVVKA_KEYWORDS]
  const answer = (await promptRich(host, "输入扫描关键词，多个用逗号分隔", "")).trim()
  if (!answer) return [...DEFAULT_KAVVKA_KEYWORDS]
  const parsed = parseKavvkaKeywords(answer)
  return parsed.length ? parsed : [...DEFAULT_KAVVKA_KEYWORDS]
}

async function resolveDepth(host: CliHost): Promise<number> {
  const answer = (await promptRich(host, "扫描深度", "3")).trim()
  const value = Number(answer)
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 3
}

function writeSelectedPlan(host: CliHost, action: KavvkaAction, input: KavvkaInput): void {
  const columns = terminalColumns(host)
  const lines: string[] = []
  lines.push(`${rich(host, "动作", "cyan")}  ${action}`)
  if (action === "scan") {
    lines.push(`${rich(host, "根目录", "cyan")}  ${input.scanRoots?.length ?? 0} 个`)
    lines.push(`${rich(host, "关键词", "cyan")}  ${(input.keywords ?? []).join(", ")}`)
    lines.push(`${rich(host, "深度", "cyan")}  ${input.scanDepth ?? 3}`)
  } else {
    lines.push(`${rich(host, "源目录", "cyan")}  ${input.paths?.length ?? 0} 个`)
    lines.push(`${rich(host, "模式", "cyan")}  ${input.dryRun ? "预演" : "实际移动"}`)
    lines.push(`${rich(host, "严格画师", "cyan")}  ${input.strictArtist ? "是" : "否"}`)
  }
  writeRichPanel(host, "将执行以下任务", lines, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

async function runGuidedAction(input: KavvkaInput, host: CliHost): Promise<KavvkaResult> {
  let progressActive = false
  const result = await runKavvka(input, createNodeKavvkaRuntime(), (event) => {
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
  writeKavvkaSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result
}

function writeKavvkaSummary(host: CliHost, result: KavvkaResult): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const lines: string[] = []

  if (data.matchedPaths.length) {
    lines.push(`${rich(host, "匹配目录", "cyan")}  ${data.matchedPaths.length} 个`)
    for (const path of data.matchedPaths.slice(0, SUMMARY_PATH_LIMIT)) {
      lines.push(`${rich(host, "•", "cyan")} ${truncateVisible(path, columns - 6)}`)
    }
    if (data.matchedPaths.length > SUMMARY_PATH_LIMIT) {
      lines.push(rich(host, `... 还有 ${data.matchedPaths.length - SUMMARY_PATH_LIMIT} 个`, "grey"))
    }
  }

  if (data.allCombinedPaths.length) {
    lines.push(`${rich(host, "Czkawka 路径", "cyan")}  ${data.allCombinedPaths.length} 条`)
    for (const path of data.allCombinedPaths.slice(0, SUMMARY_PATH_LIMIT)) {
      lines.push(`${rich(host, "•", "green")} ${truncateVisible(path, columns - 6)}`)
    }
    if (data.allCombinedPaths.length > SUMMARY_PATH_LIMIT) {
      lines.push(rich(host, `... 还有 ${data.allCombinedPaths.length - SUMMARY_PATH_LIMIT} 条`, "grey"))
    }
  }

  for (const item of data.processResults) {
    if (item.warnings.length) {
      for (const warning of item.warnings) lines.push(rich(host, `warning: ${warning}`, "yellow"))
    }
    for (const moved of item.movedFolders) {
      const status = moved.success ? rich(host, "moved", "green") : rich(host, "planned", "cyan")
      const budget = Math.max(8, columns - 6)
      const sourceWidth = Math.max(8, Math.floor(budget * 0.48))
      const targetWidth = Math.max(0, budget - sourceWidth - 4)
      lines.push(`${status} ${truncateVisible(moved.source, sourceWidth)} ${rich(host, "->", "grey")} ${truncateVisible(moved.target, targetWidth)}`)
    }
  }

  if (data.errors.length) {
    lines.push(rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"))
    lines.push(`${rich(host, "错误", "red")}  ${data.errors.length} 个`)
    for (const error of data.errors.slice(0, 8)) lines.push(rich(host, `  ${error}`, "red"))
  }

  writeRichPanel(host, "执行总结", lines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

async function verifyDirectories(paths: string[]): Promise<string[]> {
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

function parseList(value?: string): string[] {
  return parseKavvkaPaths((value ?? "").replace(/,/g, "\n"))
}

function parseDepth(value?: string | number): number {
  const next = Number(value ?? 3)
  return Number.isFinite(next) ? next : 3
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
