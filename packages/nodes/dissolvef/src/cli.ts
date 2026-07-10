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
  visibleWidth,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"

import type { DissolvefAction, DissolvefConflictMode, DissolvefInput, DissolvefMediaType, DissolvefPlanItem, DissolvefResult } from "./core.js"
import { runDissolvef } from "./core.js"
import { createNodeDissolvefRuntime, readClipboardText } from "./platform.js"
import { loadNodeConfigWithHints } from "@xiranite/config"

const CLI_NAME = nodeCliName("dissolvef")
const PREVIEW_LIMIT = 40
const ARCHIVE_PATH_LIMIT = 80
const HISTORY_LIMIT = 20

interface DissolvefNodeConfig {
  enable_undo?: boolean
  history_path?: string
}

interface DissolvefDefaults {
  enableUndo: boolean
  historyPath: string | undefined
}

/**
 * Read dissolvef defaults from xiranite.config.toml [nodes.dissolvef] section.
 * Falls back to safe defaults when the config file or section is missing.
 */
async function resolveDissolvefDefaults(host: CliHost, json: boolean): Promise<DissolvefDefaults> {
  try {
    const { config: node } = await loadNodeConfigWithHints<DissolvefNodeConfig>("dissolvef", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      enableUndo: node?.enable_undo ?? true,
      historyPath: node?.history_path,
    }
  } catch {
    return { enableUndo: true, historyPath: undefined }
  }
}

interface DissolvefCliOptions {
  path?: string
  exclude?: string
  nested?: boolean
  media?: boolean
  archive?: boolean
  direct?: boolean
  preview?: boolean
  dryRun?: boolean
  fileConflict?: DissolvefConflictMode
  dirConflict?: DissolvefConflictMode
  similarityThreshold?: string | number
  enableSimilarity?: boolean
  protectFirstLevel?: boolean
  historyPath?: string
  historyLimit?: string | number
  undoId?: string
  mediaTypes?: string
  skipBlacklist?: boolean
  json?: boolean
}

type PathSource = "clipboard" | "manual" | "exit"
type OperationChoice = "media" | "nested" | "archive" | "all" | "direct" | "collect-archives" | "exit"

interface GuidedConfig {
  operation: OperationChoice
  mediaTypes: DissolvefMediaType[]
  fileConflict: DissolvefConflictMode
  dirConflict: DissolvefConflictMode
  exclude: string[]
  protectFirstLevel: boolean
  enableSimilarity: boolean
  similarityThreshold: number
  skipBlacklist: boolean
  preview: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Dissolve nested, single-media, single-archive, or direct folders.",
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
    meta: { name: CLI_NAME, description: "Folder dissolve utility with guided terminal mode." },
    subCommands: {
      plan: defineCommand({
        meta: { name: "plan", description: "Preview the operations without changing files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "plan", ...inputFromArgs({ ...args, path: (args.path === "-" || (!args.path && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.path } as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      dissolve: defineCommand({
        meta: { name: "dissolve", description: "Run the selected dissolve modes." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "dissolve", ...inputFromArgs({ ...args, path: (args.path === "-" || (!args.path && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.path } as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      nested: defineCommand({
        meta: { name: "nested", description: "Flatten single-subfolder chains." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "nested", ...inputFromArgs({ ...args, path: (args.path === "-" || (!args.path && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.path } as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      media: defineCommand({
        meta: { name: "media", description: "Release folders containing exactly one media file." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "media", ...inputFromArgs({ ...args, path: (args.path === "-" || (!args.path && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.path } as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      archive: defineCommand({
        meta: { name: "archive", description: "Release folders containing exactly one archive." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "archive", ...inputFromArgs({ ...args, path: (args.path === "-" || (!args.path && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.path } as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      direct: defineCommand({
        meta: { name: "direct", description: "Move a folder's contents to its parent." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "direct", ...inputFromArgs({ ...args, path: (args.path === "-" || (!args.path && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.path } as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      "collect-archives": defineCommand({
        meta: { name: "collect-archives", description: "Print matching single-archive paths." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "collect_archives", ...inputFromArgs({ ...args, path: (args.path === "-" || (!args.path && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.path } as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "Show undo history." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "history", ...inputFromArgs({ ...args, path: (args.path === "-" || (!args.path && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.path } as DissolvefCliOptions) }, Boolean(args.json), host)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo the latest or selected dissolve record." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "undo", ...inputFromArgs({ ...args, path: (args.path === "-" || (!args.path && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.path } as DissolvefCliOptions) }, Boolean(args.json), host)
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
    path: { type: "string", description: "Root folder path." },
    exclude: { type: "string", description: "Comma-separated exclude keywords." },
    nested: { type: "boolean", description: "Enable nested mode." },
    media: { type: "boolean", description: "Enable single-media mode." },
    archive: { type: "boolean", description: "Enable single-archive mode." },
    direct: { type: "boolean", description: "Enable direct mode." },
    preview: { type: "boolean", description: "Preview without changing files." },
    dryRun: { type: "boolean", description: "Alias for preview." },
    fileConflict: { type: "string", description: "auto, skip, overwrite, or rename." },
    dirConflict: { type: "string", description: "auto, skip, overwrite, or rename." },
    similarityThreshold: { type: "string", description: "Similarity threshold from 0 to 1." },
    enableSimilarity: { type: "boolean", description: "Enable similarity filter." },
    protectFirstLevel: { type: "boolean", description: "Do not dissolve first-level folders below --path." },
    historyPath: { type: "string", description: "Undo history JSON path." },
    historyLimit: { type: "string", description: "Maximum history records." },
    undoId: { type: "string", description: "Undo record id." },
    mediaTypes: { type: "string", description: "Comma-separated media types: video, archive, image." },
    skipBlacklist: { type: "boolean", description: "Disable built-in archive/nested blacklists." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: DissolvefCliOptions): DissolvefInput {
  return {
    path: args.path,
    exclude: splitArg(args.exclude),
    nested: args.nested,
    media: args.media,
    archive: args.archive,
    direct: args.direct,
    preview: Boolean(args.preview || args.dryRun),
    fileConflict: args.fileConflict,
    dirConflict: args.dirConflict,
    similarityThreshold: numberArg(args.similarityThreshold),
    enableSimilarity: args.enableSimilarity,
    protectFirstLevel: args.protectFirstLevel,
    historyPath: args.historyPath,
    historyLimit: numberArg(args.historyLimit),
    undoId: args.undoId,
    mediaTypes: splitArg(args.mediaTypes).filter(isMediaType),
    skipBlacklist: args.skipBlacklist,
  }
}

async function runAction(input: DissolvefInput & { action: DissolvefAction }, json: boolean, host: CliHost): Promise<void> {
  if (!input.historyPath) {
    const defaults = await resolveDissolvefDefaults(host, json)
    if (defaults.historyPath) input.historyPath = defaults.historyPath
  }
  let progressActive = false
  const result = await runDissolvef(input, createNodeDissolvefRuntime(), json ? undefined : (event) => {
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
  writeDissolvefSummary(host, result, Boolean(input.preview))
  if (!result.success) process.exitCode = 1
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

      const path = await resolvePath(host)
      if (!path) continue

      const config = await resolveGuidedConfig(host)
      if (config.operation === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      writeLine(host)
      writeSelectedConfig(host, path, config)

      const confirmed = await confirmRich(host, `确认开始执行 ${config.preview ? "预览" : "解散"} 操作?`, true)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const input = buildGuidedInput(path, config)
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
  writeRichPanel(host, "Xiranite Dissolvef", [
    `${rich(host, "入口", "cyan")}  文件夹解散工具，支持嵌套/单媒体/单压缩包/直接解散与撤销`,
    `${rich(host, "模式", "cyan")}  media 媒体, nested 嵌套, archive 压缩包, direct 直接, all 媒体+嵌套`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；默认先预览再执行`,
    `${rich(host, "撤销", "cyan")}  每次解散记录写入 history，可用 undo 子命令回滚`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    `${rich(host, "提示", "grey")}  脚本化使用 \`${CLI_NAME} plan --path <folder> --json\`；预览不写入磁盘`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function resolvePath(host: CliHost): Promise<string | null> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的多行路径，取首个有效目录" },
      { value: "manual", label: "手动输入路径", hint: "直接输入文件夹绝对路径" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return null
  }

  if (source === "clipboard") {
    const clipboard = (await readClipboardText()).trim()
    if (!clipboard) {
      writeRichPanel(host, "Clipboard", "剪贴板为空，请改用手动输入。", { color: "yellow", minWidth: 48 })
      return null
    }
    const candidate = cleanPath(clipboard.split(/\r?\n/).find((line) => line.trim()) ?? "")
    if (!candidate) {
      writeRichPanel(host, "Clipboard", "剪贴板中未找到有效路径。", { color: "yellow", minWidth: 48 })
      return null
    }
    const verified = await verifyDirectory(candidate)
    if (!verified) {
      writeRichPanel(host, "Clipboard", `剪贴板路径不是有效文件夹: ${candidate}`, { color: "red", minWidth: 48 })
      return null
    }
    writeLine(host, rich(host, `已从剪贴板读取路径: ${verified}`, "green"))
    return verified
  }

  const answer = (await promptRich(host, "输入要处理的文件夹路径", "")).trim()
  if (!answer) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return null
  }
  const verified = await verifyDirectory(answer)
  if (!verified) {
    writeRichPanel(host, "Path", `路径不存在或不是文件夹: ${answer}`, { color: "red", minWidth: 48 })
    return null
  }
  return verified
}

async function resolveGuidedConfig(host: CliHost): Promise<GuidedConfig> {
  const operation = await selectRich<OperationChoice>(
    host,
    "选择要执行的解散操作",
    [
      { value: "media", label: "解散单媒体文件夹", hint: "文件夹仅含单个视频/压缩包/图片时释放到上级" },
      { value: "nested", label: "解散嵌套的单一文件夹", hint: "文件夹下仅一个子文件夹时拉平到母文件夹" },
      { value: "archive", label: "解散单压缩包文件夹", hint: "文件夹仅含单个压缩包时释放到上级" },
      { value: "all", label: "全部功能（除直接解散）", hint: "执行 media + nested 两种操作" },
      { value: "direct", label: "直接解散指定文件夹", hint: "将整个文件夹内容移动到其父文件夹" },
      { value: "collect-archives", label: "收集单压缩包路径合集", hint: "仅打印可直接批量解压的压缩包路径" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "all", maxItems: 8 },
  )

  if (operation === "exit") {
    return {
      operation,
      mediaTypes: [],
      fileConflict: "auto",
      dirConflict: "auto",
      exclude: [],
      protectFirstLevel: true,
      enableSimilarity: true,
      similarityThreshold: 0.6,
      skipBlacklist: false,
      preview: false,
    }
  }

  const isMediaMode = operation === "media" || operation === "all"
  const isNestedMode = operation === "nested" || operation === "all"
  const isArchiveMode = operation === "archive"
  const isCollectMode = operation === "collect-archives"
  const isDirectMode = operation === "direct"

  const mediaTypes = isMediaMode ? await resolveMediaTypes(host) : []
  const { fileConflict, dirConflict } = isDirectMode ? await resolveConflictModes(host) : { fileConflict: "auto" as DissolvefConflictMode, dirConflict: "auto" as DissolvefConflictMode }

  let exclude: string[] = []
  if (!isDirectMode && (isMediaMode || isNestedMode)) {
    exclude = await resolveExcludeKeywords(host)
  }

  let protectFirstLevel = true
  let enableSimilarity = true
  let similarityThreshold = 0.6
  let skipBlacklist = false

  if (!isDirectMode && !isCollectMode) {
    protectFirstLevel = await confirmRich(host, "是否保护输入路径下一级文件夹（不直接解散）?", true)
  }

  if (isNestedMode || isArchiveMode) {
    enableSimilarity = await confirmRich(host, "是否启用相似度限制（nested/archive）?", true)
    if (enableSimilarity) {
      similarityThreshold = await resolveSimilarityThreshold(host)
    }
  }

  if (isArchiveMode || isCollectMode) {
    skipBlacklist = await confirmRich(host, "是否临时跳过黑名单过滤（仅本次执行）?", false)
  }

  const preview = await confirmRich(host, "是否启用预览模式（不实际执行操作）?", false)

  return {
    operation,
    mediaTypes,
    fileConflict,
    dirConflict,
    exclude,
    protectFirstLevel,
    enableSimilarity,
    similarityThreshold,
    skipBlacklist,
    preview,
  }
}

async function resolveMediaTypes(host: CliHost): Promise<DissolvefMediaType[]> {
  const choice = await selectRich<string>(
    host,
    "选择单媒体类别",
    [
      { value: "video,archive,image", label: "全部媒体", hint: "视频 + 压缩包 + 图片" },
      { value: "video", label: "仅视频", hint: "mp4/mkv/avi 等视频格式" },
      { value: "archive", label: "仅压缩包", hint: "zip/rar/7z 等压缩格式" },
      { value: "image", label: "仅图片", hint: "jpg/png/webp 等图片格式" },
      { value: "video,archive", label: "视频 + 压缩包", hint: "不含图片" },
      { value: "video,image", label: "视频 + 图片", hint: "不含压缩包" },
    ],
    { initialValue: "video,archive,image", maxItems: 6 },
  )
  return choice.split(",").filter(isMediaType)
}

async function resolveConflictModes(host: CliHost): Promise<{ fileConflict: DissolvefConflictMode; dirConflict: DissolvefConflictMode }> {
  const fileConflict = await selectRich<DissolvefConflictMode>(
    host,
    "文件冲突处理方式",
    [
      { value: "auto", label: "auto（文件跳过）", hint: "默认行为，跳过已存在的文件" },
      { value: "skip", label: "skip 跳过", hint: "目标已存在则跳过" },
      { value: "overwrite", label: "overwrite 覆盖", hint: "覆盖已存在的文件" },
      { value: "rename", label: "rename 重命名", hint: "自动添加数字后缀" },
    ],
    { initialValue: "auto", maxItems: 4 },
  )

  const dirConflict = await selectRich<DissolvefConflictMode>(
    host,
    "文件夹冲突处理方式",
    [
      { value: "auto", label: "auto（文件夹合并）", hint: "默认行为，合并到已存在的文件夹" },
      { value: "skip", label: "skip 跳过", hint: "目标已存在则跳过" },
      { value: "overwrite", label: "overwrite 覆盖", hint: "递归合并内容后删除源" },
      { value: "rename", label: "rename 重命名", hint: "自动添加数字后缀" },
    ],
    { initialValue: "auto", maxItems: 4 },
  )

  return { fileConflict, dirConflict }
}

async function resolveExcludeKeywords(host: CliHost): Promise<string[]> {
  const wantsExclude = await confirmRich(host, "是否要排除某些文件夹/文件?", false)
  if (!wantsExclude) return []
  const answer = (await promptRich(host, "输入排除关键词，多个关键词用逗号分隔", "")).trim()
  return splitArg(answer)
}

async function resolveSimilarityThreshold(host: CliHost): Promise<number> {
  const answer = await promptRich(host, "相似度阈值 (0.0-1.0)", "0.6")
  const parsed = Number(answer)
  if (!Number.isFinite(parsed)) return 0.6
  return Math.max(0, Math.min(1, parsed))
}

function buildGuidedInput(path: string, config: GuidedConfig): DissolvefInput & { action: DissolvefAction } {
  const base: DissolvefInput = {
    path,
    exclude: config.exclude,
    preview: config.preview,
    protectFirstLevel: config.protectFirstLevel,
    enableSimilarity: config.enableSimilarity,
    similarityThreshold: config.similarityThreshold,
    skipBlacklist: config.skipBlacklist,
    mediaTypes: config.mediaTypes,
    fileConflict: config.fileConflict,
    dirConflict: config.dirConflict,
  }

  switch (config.operation) {
    case "media":
      return { ...base, action: "media" }
    case "nested":
      return { ...base, action: "nested" }
    case "archive":
      return { ...base, action: "archive" }
    case "direct":
      return { ...base, action: "direct" }
    case "collect-archives":
      return { ...base, action: "collect_archives" }
    case "all":
      return { ...base, action: "dissolve", media: true, nested: true }
    default:
      return { ...base, action: "plan" }
  }
}

function writeSelectedConfig(host: CliHost, path: string, config: GuidedConfig): void {
  const columns = terminalColumns(host)
  const lines = [
    `${rich(host, "路径", "cyan")}  ${path}`,
    `${rich(host, "操作", "cyan")}  ${config.operation}`,
    `${rich(host, "预览", "cyan")}  ${config.preview ? "是（不写入磁盘）" : "否（实际执行）"}`,
  ]

  if (config.operation === "direct") {
    lines.push(`${rich(host, "文件冲突", "cyan")}  ${config.fileConflict}`)
    lines.push(`${rich(host, "文件夹冲突", "cyan")}  ${config.dirConflict}`)
  } else {
    lines.push(`${rich(host, "保护一级", "cyan")}  ${config.protectFirstLevel ? "是" : "否"}`)
    if (config.exclude.length) lines.push(`${rich(host, "排除", "red")}  ${config.exclude.join(", ")}`)
    if (config.operation === "media" || config.operation === "all") {
      lines.push(`${rich(host, "媒体类别", "cyan")}  ${config.mediaTypes.join(", ")}`)
    }
    if (config.operation === "nested" || config.operation === "archive" || config.operation === "all") {
      lines.push(`${rich(host, "相似度", "cyan")}  ${config.enableSimilarity ? config.similarityThreshold.toFixed(2) : "已禁用"}`)
    }
    if (config.operation === "archive" || config.operation === "collect-archives") {
      lines.push(`${rich(host, "跳过黑名单", "cyan")}  ${config.skipBlacklist ? "是" : "否"}`)
    }
  }

  writeRichPanel(host, "将执行以下解散配置", lines, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

async function runGuidedAction(input: DissolvefInput & { action: DissolvefAction }, host: CliHost): Promise<DissolvefResult> {
  if (!input.historyPath) {
    const defaults = await resolveDissolvefDefaults(host, false)
    if (defaults.historyPath) input.historyPath = defaults.historyPath
  }
  let progressActive = false
  const result = await runDissolvef(input, createNodeDissolvefRuntime(), (event) => {
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
  writeDissolvefSummary(host, result, Boolean(input.preview))
  if (!result.success) process.exitCode = 1
  return result
}

function writeDissolvefSummary(host: CliHost, result: DissolvefResult, preview: boolean): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const modePrefix = preview ? "将" : "已"

  const lines = [
    `${rich(host, "总计", "cyan")}  ${data.totalCount} 个操作  ${rich(host, "成功", "green")} ${data.successCount}  ${rich(host, "跳过", "yellow")} ${data.skippedCount}  ${rich(host, "失败", "red")} ${data.failedCount}`,
  ]

  if (data.nestedCount) lines.push(`${rich(host, "嵌套", "blue")}  ${modePrefix}解散 ${data.nestedCount} 个嵌套文件夹`)
  if (data.mediaCount) lines.push(`${rich(host, "媒体", "green")}  ${modePrefix}解散 ${data.mediaCount} 个单媒体文件夹`)
  if (data.archiveCount) lines.push(`${rich(host, "压缩包", "magenta")}  ${modePrefix}解散 ${data.archiveCount} 个单压缩包文件夹`)
  if (data.directFiles || data.directDirs) {
    lines.push(`${rich(host, "直接", "yellow")}  ${modePrefix}移动 ${data.directFiles} 个文件和 ${data.directDirs} 个文件夹`)
  }
  if (data.archivePaths.length) {
    lines.push(`${rich(host, "收集", "cyan")}  ${data.archivePaths.length} 个压缩包路径`)
  }
  if (data.history.length) {
    lines.push(`${rich(host, "历史", "grey")}  ${data.history.length} 条撤销记录`)
  }
  if (data.operationId) {
    lines.push(`${rich(host, "撤销ID", "green")}  ${data.operationId}`)
  }

  writeRichPanel(host, "解散操作总结", lines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })

  if (data.plan.length) {
    writeLine(host)
    writeLine(host, rich(host, preview ? "待执行操作预览：" : "已执行操作：", "cyan"))
    for (const item of data.plan.slice(0, PREVIEW_LIMIT)) {
      writeLine(host, formatPlanItem(item, host))
    }
    if (data.plan.length > PREVIEW_LIMIT) {
      writeLine(host, rich(host, `  ... 还有 ${data.plan.length - PREVIEW_LIMIT} 个操作`, "grey"))
    }
  }

  if (data.archivePaths.length) {
    writeLine(host)
    writeLine(host, rich(host, "已收集到的压缩包路径：", "cyan"))
    for (const path of data.archivePaths.slice(0, ARCHIVE_PATH_LIMIT)) {
      writeLine(host, `  ${truncateVisible(path, columns - 4)}`)
    }
    if (data.archivePaths.length > ARCHIVE_PATH_LIMIT) {
      writeLine(host, rich(host, `  ... 还有 ${data.archivePaths.length - ARCHIVE_PATH_LIMIT} 个路径`, "grey"))
    }
  }

  if (data.history.length) {
    writeLine(host)
    writeLine(host, rich(host, "撤销历史：", "cyan"))
    for (const record of data.history.slice(0, HISTORY_LIMIT)) {
      const status = record.undone ? rich(host, "undone", "grey") : rich(host, "active", "green")
      writeLine(host, `  ${rich(host, record.id, "magenta")} ${record.mode} ${record.count} ${status}`)
    }
  }

  if (data.errors.length) {
    writeRichPanel(host, "错误", data.errors.join("\n"), { color: "red", minWidth: 76 })
  }
}

function formatPlanItem(item: DissolvefPlanItem, host: CliHost): string {
  const status = item.status === "success"
    ? rich(host, "success", "green")
    : item.status === "error"
      ? rich(host, "error", "red")
      : item.status === "skipped"
        ? rich(host, "skipped", "yellow")
        : rich(host, "planned", "cyan")
  const mode = rich(host, item.mode, item.mode === "nested" ? "blue" : item.mode === "media" ? "green" : item.mode === "archive" ? "magenta" : "yellow")
  const operation = rich(host, item.operation, "grey")
  const columns = terminalColumns(host)
  const prefix = `  ${status} ${mode} ${operation} `

  if (item.targetPath) {
    const arrow = ` ${rich(host, "->", "grey")} `
    const pathBudget = Math.max(0, columns - visibleWidth(prefix) - visibleWidth(arrow))
    if (pathBudget < 20) return `${prefix}${truncateVisible(item.sourcePath, pathBudget)}`
    const sourceWidth = Math.max(8, Math.floor(pathBudget * 0.48))
    const targetWidth = Math.max(0, pathBudget - sourceWidth)
    return `${prefix}${truncateVisible(item.sourcePath, sourceWidth)}${arrow}${truncateVisible(item.targetPath, targetWidth)}`
  }

  if (item.reason) {
    const separator = ` ${rich(host, "/", "grey")} `
    const pathBudget = Math.max(0, columns - visibleWidth(prefix) - visibleWidth(separator))
    return `${prefix}${truncateVisible(item.sourcePath, pathBudget)}${separator}${rich(host, item.reason, "yellow")}`
  }

  const pathBudget = Math.max(0, columns - visibleWidth(prefix))
  return `${prefix}${truncateVisible(item.sourcePath, pathBudget)}`
}

async function verifyDirectory(path: string): Promise<string | null> {
  const cleaned = cleanPath(path)
  if (!cleaned) return null
  try {
    const info = await lstat(cleaned)
    if (info.isDirectory()) return cleaned
  } catch {
    return null
  }
  return null
}

function splitArg(value?: string): string[] {
  return (value ?? "").split(/[,;\r\n]/).map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: string | number): number | undefined {
  if (typeof value === "number") return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isMediaType(value: string): value is DissolvefMediaType {
  return value === "video" || value === "archive" || value === "image"
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
