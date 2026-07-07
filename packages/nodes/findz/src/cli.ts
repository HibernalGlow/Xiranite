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

import type { FindzAction, FindzData, FindzInput, FindzOutputFormat, FindzResult } from "./core.js"
import { runFindz } from "./core.js"
import { createNodeFindzRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("findz")
const DEFAULT_MAX_RETURN = 5000

interface FindzCliOptions {
  where?: string
  path?: string
  paths?: string
  noArchive?: boolean
  followSymlinks?: boolean
  imageMeta?: boolean
  maxResults?: string
  maxReturn?: string
  groupBy?: string
  refine?: string
  sortBy?: "name" | "count" | "totalSize" | "avgSize"
  asc?: boolean
  output?: string
  csv?: boolean
  efu?: boolean
  json?: boolean
  long?: boolean
  print0?: boolean
}

type GuidedAction = "search" | "archives-only" | "nested" | "refine" | "help-filter" | "exit"
type PathSource = "clipboard" | "current-dir" | "manual" | "exit"
type FilterType = "size" | "name" | "date" | "ext" | "type" | "archive" | "custom" | "all"
type OutputFormatChoice = "text" | "csv" | "efu" | "json"

interface GuidedQuery {
  action: FindzAction
  paths: string[]
  where: string
  longFormat: boolean
  outputFormat: FindzOutputFormat
  followSymlinks: boolean
  withImageMeta: boolean
  noArchive: boolean
  maxResults: number
  maxReturnFiles: number
  groupBy?: string
  refine?: string
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Search files and archive members with SQL-like filters.",
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
    meta: { name: CLI_NAME, description: "SQL-like file and archive search with guided terminal mode." },
    subCommands: {
      search: defineCommand({
        meta: { name: "search", description: "Search files and optional archive members." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("search", inputFromArgs(args as FindzCliOptions), host)
        },
      }),
      "archives-only": defineCommand({
        meta: { name: "archives-only", description: "Return archive files themselves, without entering them." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("archives_only", inputFromArgs(args as FindzCliOptions), host)
        },
      }),
      nested: defineCommand({
        meta: { name: "nested", description: "Find archives containing nested archive files." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("nested", inputFromArgs(args as FindzCliOptions), host)
        },
      }),
      refine: defineCommand({
        meta: { name: "refine", description: "Search, group, and apply a secondary group filter." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("search", { ...inputFromArgs(args as FindzCliOptions), groupBy: (args as FindzCliOptions).groupBy || "archive" }, host)
        },
      }),
      "help-filter": defineCommand({
        meta: { name: "help-filter", description: "Print filter syntax help." },
        async run() {
          await runAction("help", { action: "help" }, host)
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
    where: { type: "string", description: "SQL-like filter, default 1." },
    path: { type: "string", description: "Single file or folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated paths." },
    noArchive: { type: "boolean", description: "Do not search inside archives." },
    followSymlinks: { type: "boolean", description: "Follow symbolic links." },
    imageMeta: { type: "boolean", description: "Read image dimensions for filesystem image files." },
    maxResults: { type: "string", description: "Stop after this many matches, 0 means unlimited." },
    maxReturn: { type: "string", description: "Return this many items in JSON/data, 0 means all." },
    groupBy: { type: "string", description: "Group by archive, ext, or dir." },
    refine: { type: "string", description: "Secondary group filter, e.g. count > 10." },
    sortBy: { type: "string", description: "Group sort: name, count, totalSize, avgSize." },
    asc: { type: "boolean", description: "Sort groups ascending." },
    output: { type: "string", description: "Save output to file." },
    csv: { type: "boolean", description: "Print CSV." },
    efu: { type: "boolean", description: "Print Everything EFU file list." },
    json: { type: "boolean", description: "Print JSON result." },
    long: { type: "boolean", description: "Print long text rows." },
    print0: { type: "boolean", description: "Use NUL separators for text output." },
  } as const
}

function inputFromArgs(args: FindzCliOptions): FindzInput {
  return {
    where: args.where || "1",
    paths: splitArg(args.paths, args.path ? [args.path] : []),
    noArchive: args.noArchive,
    followSymlinks: args.followSymlinks,
    withImageMeta: args.imageMeta,
    maxResults: numberArg(args.maxResults),
    maxReturnFiles: numberArg(args.maxReturn),
    groupBy: args.groupBy,
    refine: args.refine,
    sortBy: args.sortBy,
    sortDesc: !args.asc,
    outputPath: args.output,
    outputFormat: outputFormat(args),
    longFormat: args.long ?? true,
    printZero: args.print0,
  }
}

async function runAction(action: FindzAction, input: FindzInput, host: CliHost): Promise<FindzResult> {
  let progressActive = false
  const showProgress = !input.outputFormat || input.outputFormat === "text"
  const result = await runFindz({ ...input, action }, createNodeFindzRuntime(), (event) => {
    if (!showProgress) return
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

  if (input.outputFormat === "json") {
    writeJson(host, result)
  } else if (result.data?.outputText) {
    host.stdout.write(result.data.outputText + (input.printZero ? "" : "\n"))
  } else {
    writeLine(host, result.message)
  }

  if (!result.success) process.exitCode = 1
  return result
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} search --where \"ext = \\\"jpg\\\"\" --path . --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  let firstRender = true

  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const action = await resolveAction(host)
      if (action === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      if (action === "help-filter") {
        await runAction("help", { action: "help" }, host)
        if (!await confirmRich(host, "继续?", false)) return
        continue
      }

      const paths = await resolvePaths(host)
      if (!paths.length) {
        writeLine(host, rich(host, "未提供有效路径。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const filter = await resolveFilter(host)
      if (!filter) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const options = await resolveOptions(host, action)
      if (!options) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const query: GuidedQuery = {
        action: guidedActionToCore(action),
        paths,
        where: filter,
        ...options,
      }

      writeQuerySummary(host, query)

      const confirmed = await confirmRich(host, "执行此查询?", true)
      if (!confirmed) {
        writeLine(host, rich(host, "查询已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      await runGuidedTask(host, query)

      if (!await confirmRich(host, "继续执行其他查询?", false)) return
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
  writeRichPanel(host, "Xiranite Findz", [
    `${rich(host, "入口", "cyan")}  SQL-like 文件搜索工具，支持 tar/zip/7z/rar 压缩包内部检索`,
    `${rich(host, "字段", "cyan")}  name/path/size/date/ext/ext2/type/container/archive`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；当前目录默认；手动输入仅作 fallback`,
    `${rich(host, "过滤", "cyan")}  7 类过滤器: size/name/date/ext/type/archive/custom`,
    `${rich(host, "执行", "cyan")}  直接调用 findz core/platform，不经过 lata 或 Taskfile`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function resolveAction(host: CliHost): Promise<GuidedAction> {
  return await selectRich<GuidedAction>(
    host,
    "选择 findz 动作",
    [
      { value: "search", label: "search", hint: "搜索文件和压缩包成员" },
      { value: "archives-only", label: "archives-only", hint: "只返回压缩包本身，不进入内部" },
      { value: "nested", label: "nested", hint: "查找包含嵌套压缩包的外层压缩包" },
      { value: "refine", label: "refine", hint: "搜索并按 archive 分组，应用二级过滤" },
      { value: "help-filter", label: "help-filter", hint: "打印过滤语法帮助" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: "search", maxItems: 6 },
  )
}

async function resolvePaths(host: CliHost): Promise<string[]> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的多行路径" },
      { value: "current-dir", label: "使用当前目录", hint: host.cwd },
      { value: "manual", label: "手动输入路径", hint: "用分号或换行分隔" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return []
  }

  if (source === "current-dir") {
    const verified = await verifyPaths([host.cwd])
    if (!verified.length) {
      writeRichPanel(host, "Path", `当前目录不可访问: ${host.cwd}`, { color: "red", minWidth: 48 })
      return []
    }
    writeLine(host, rich(host, `使用当前目录: ${verified[0]}`, "green"))
    return verified
  }

  if (source === "clipboard") {
    const clipboard = (await readClipboardText()).trim()
    if (!clipboard) {
      writeRichPanel(host, "Clipboard", "剪贴板为空，请改用手动输入。", { color: "yellow", minWidth: 48 })
      return []
    }
    const paths = splitArg(clipboard)
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

  const answer = (await promptRich(host, "输入要搜索的路径，用分号或换行分隔", "")).trim()
  if (!answer) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return []
  }
  const paths = splitArg(answer)
  const verified = await verifyPaths(paths)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在。", { color: "red", minWidth: 48 })
    return []
  }
  return verified
}

async function resolveFilter(host: CliHost): Promise<string | undefined> {
  const filterType = await selectRich<FilterType>(
    host,
    "选择过滤器类型",
    [
      { value: "size", label: "size", hint: "按文件大小过滤，如 size < 10M" },
      { value: "name", label: "name", hint: "按文件名过滤，支持 like/ilike/rlike" },
      { value: "date", label: "date", hint: "按修改日期过滤" },
      { value: "ext", label: "ext", hint: "按扩展名过滤，如 jpg,png" },
      { value: "type", label: "type", hint: "按类型过滤: file/dir/link" },
      { value: "archive", label: "archive", hint: "按压缩包类型过滤: tar/zip/7z/rar" },
      { value: "custom", label: "custom", hint: "直接输入 WHERE 子句" },
      { value: "all", label: "all", hint: "不过滤，返回全部" },
    ],
    { initialValue: "size", maxItems: 8 },
  )

  if (filterType === "all") return "1"
  if (filterType === "custom") {
    const where = (await promptRich(host, "输入 WHERE 子句", "")).trim()
    if (!where) {
      writeLine(host, rich(host, "未输入 WHERE 子句。", "yellow"))
      return undefined
    }
    return where
  }

  if (filterType === "size") return await resolveSizeFilter(host)
  if (filterType === "name") return await resolveNameFilter(host)
  if (filterType === "date") return await resolveDateFilter(host)
  if (filterType === "ext") return await resolveExtFilter(host)
  if (filterType === "type") return await resolveTypeFilter(host)
  if (filterType === "archive") return await resolveArchiveFilter(host)
  return "1"
}

async function resolveSizeFilter(host: CliHost): Promise<string | undefined> {
  type SizeOp = "<" | ">" | "<=" | ">=" | "=" | "between"
  const op = await selectRich<SizeOp>(
    host,
    "选择大小比较运算符",
    [
      { value: "<", label: "<", hint: "小于" },
      { value: ">", label: ">", hint: "大于" },
      { value: "<=", label: "<=", hint: "小于等于" },
      { value: ">=", label: ">=", hint: "大于等于" },
      { value: "=", label: "=", hint: "等于" },
      { value: "between", label: "between", hint: "区间，如 1M AND 100M" },
    ],
    { initialValue: ">", maxItems: 6 },
  )

  if (op === "between") {
    const minSize = (await promptRich(host, "最小值 (如 1M)", "")).trim()
    if (!minSize) return undefined
    const maxSize = (await promptRich(host, "最大值 (如 100M)", "")).trim()
    if (!maxSize) return undefined
    return `size between ${minSize} and ${maxSize}`
  }

  const size = (await promptRich(host, "输入大小 (如 10M, 1G)", "")).trim()
  if (!size) return undefined
  return `size ${op} ${size}`
}

async function resolveNameFilter(host: CliHost): Promise<string | undefined> {
  type PatternType = "exact" | "like" | "ilike" | "rlike"
  const patternType = await selectRich<PatternType>(
    host,
    "选择模式匹配类型",
    [
      { value: "exact", label: "exact", hint: "精确匹配，使用 =" },
      { value: "like", label: "like", hint: "SQL LIKE，% 表示任意字符" },
      { value: "ilike", label: "ilike", hint: "大小写不敏感的 LIKE" },
      { value: "rlike", label: "rlike", hint: "正则表达式" },
    ],
    { initialValue: "like", maxItems: 4 },
  )

  const pattern = (await promptRich(host, "输入匹配模式", "")).trim()
  if (!pattern) return undefined

  if (patternType === "exact") return `name = "${pattern}"`
  return `name ${patternType} "${pattern}"`
}

async function resolveDateFilter(host: CliHost): Promise<string | undefined> {
  type DateType = "today" | "this-week" | "specific" | "range"
  const dateType = await selectRich<DateType>(
    host,
    "选择日期类型",
    [
      { value: "today", label: "today", hint: "今天修改的文件" },
      { value: "this-week", label: "this-week", hint: "本周修改的文件 (date >= mo)" },
      { value: "specific", label: "specific", hint: "指定具体日期" },
      { value: "range", label: "range", hint: "日期区间" },
    ],
    { initialValue: "today", maxItems: 4 },
  )

  if (dateType === "today") return "date = today"
  if (dateType === "this-week") return "date >= mo"

  if (dateType === "specific") {
    const date = (await promptRich(host, "输入日期 (YYYY-MM-DD)", "")).trim()
    if (!date) return undefined
    type DateOp = "=" | ">" | "<" | ">=" | "<="
    const op = await selectRich<DateOp>(
      host,
      "选择日期比较运算符",
      [
        { value: ">=", label: ">=", hint: "大于等于" },
        { value: ">", label: ">", hint: "大于" },
        { value: "=", label: "=", hint: "等于" },
        { value: "<", label: "<", hint: "小于" },
        { value: "<=", label: "<=", hint: "小于等于" },
      ],
      { initialValue: ">=", maxItems: 5 },
    )
    return `date ${op} "${date}"`
  }

  const startDate = (await promptRich(host, "起始日期 (YYYY-MM-DD)", "")).trim()
  if (!startDate) return undefined
  const endDate = (await promptRich(host, "结束日期 (YYYY-MM-DD)", "")).trim()
  if (!endDate) return undefined
  return `date between "${startDate}" and "${endDate}"`
}

async function resolveExtFilter(host: CliHost): Promise<string | undefined> {
  const exts = (await promptRich(host, "输入扩展名，用逗号分隔 (如 jpg,png,webp)", "")).trim()
  if (!exts) return undefined
  const extList = exts.split(",").map((item) => `"${item.trim()}"`).filter((item) => item !== '""')
  if (!extList.length) return undefined
  if (extList.length === 1) return `ext = ${extList[0]}`
  return `ext in (${extList.join(", ")})`
}

async function resolveTypeFilter(host: CliHost): Promise<string | undefined> {
  type FileType = "file" | "dir" | "link"
  const fileType = await selectRich<FileType>(
    host,
    "选择文件类型",
    [
      { value: "file", label: "file", hint: "普通文件" },
      { value: "dir", label: "dir", hint: "目录" },
      { value: "link", label: "link", hint: "符号链接" },
    ],
    { initialValue: "file", maxItems: 3 },
  )
  return `type = "${fileType}"`
}

async function resolveArchiveFilter(host: CliHost): Promise<string | undefined> {
  type ArchiveType = "any" | "tar" | "zip" | "7z" | "rar"
  const archiveType = await selectRich<ArchiveType>(
    host,
    "选择压缩包类型",
    [
      { value: "any", label: "any", hint: "任意压缩包" },
      { value: "tar", label: "tar", hint: "tar 归档" },
      { value: "zip", label: "zip", hint: "zip 归档" },
      { value: "7z", label: "7z", hint: "7z 归档" },
      { value: "rar", label: "rar", hint: "rar 归档" },
    ],
    { initialValue: "any", maxItems: 5 },
  )
  if (archiveType === "any") return `archive <> ""`
  return `archive = "${archiveType}"`
}

async function resolveOptions(host: CliHost, action: GuidedAction): Promise<Omit<GuidedQuery, "action" | "paths" | "where"> | undefined> {
  const longFormat = await confirmRich(host, "使用长格式输出 (含日期/大小)?", true)

  const outputFormat = await selectRich<OutputFormatChoice>(
    host,
    "选择输出格式",
    [
      { value: "text", label: "text", hint: "纯文本，每行一个路径" },
      { value: "csv", label: "csv", hint: "CSV 表格" },
      { value: "efu", label: "efu", hint: "Everything EFU 文件列表" },
      { value: "json", label: "json", hint: "JSON 结构化结果" },
    ],
    { initialValue: "text", maxItems: 4 },
  )

  const followSymlinks = await confirmRich(host, "跟随符号链接?", false)
  const withImageMeta = await confirmRich(host, "读取图片分辨率元数据?", false)
  const noArchive = action === "archives-only" ? false : !(await confirmRich(host, "搜索压缩包内部成员?", true))

  const maxResultsInput = (await promptRich(host, "最大匹配数 (0 表示无限制)", "0")).trim()
  const maxResults = Number(maxResultsInput) || 0

  const maxReturnInput = (await promptRich(host, "返回结果条数上限", String(DEFAULT_MAX_RETURN))).trim()
  const maxReturn = Number(maxReturnInput) || DEFAULT_MAX_RETURN

  let groupBy: string | undefined
  let refine: string | undefined
  if (action === "refine") {
    groupBy = "archive"
    const refineInput = (await promptRich(host, "输入二级分组过滤 (如 count > 10，留空跳过)", "")).trim()
    if (refineInput) refine = refineInput
  }

  return {
    longFormat,
    outputFormat,
    followSymlinks,
    withImageMeta,
    noArchive,
    maxResults,
    maxReturnFiles: maxReturn,
    groupBy,
    refine,
  }
}

function writeQuerySummary(host: CliHost, query: GuidedQuery): void {
  const columns = terminalColumns(host)
  const optionLines = [
    `long: ${query.longFormat ? "yes" : "no"}  format: ${query.outputFormat}`,
    `follow-symlinks: ${query.followSymlinks ? "yes" : "no"}  image-meta: ${query.withImageMeta ? "yes" : "no"}`,
    `no-archive: ${query.noArchive ? "yes" : "no"}  max-results: ${query.maxResults}  max-return: ${query.maxReturnFiles}`,
  ]
  if (query.groupBy || query.refine) {
    optionLines.push(`group-by: ${query.groupBy ?? "(none)"}  refine: ${query.refine || "(none)"}`)
  }
  const lines = [
    `${rich(host, "action", "cyan")}  ${query.action}`,
    `${rich(host, "paths", "cyan")}  ${query.paths.map((path) => truncateVisible(path, Math.max(20, columns - 24))).join("; ")}`,
    `${rich(host, "where", "cyan")}  ${query.where}`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    ...optionLines,
  ]
  writeRichPanel(host, "Query Summary", lines, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

async function runGuidedTask(host: CliHost, query: GuidedQuery): Promise<void> {
  const input: FindzInput = {
    action: query.action,
    where: query.where,
    paths: query.paths,
    longFormat: query.longFormat,
    outputFormat: query.outputFormat,
    followSymlinks: query.followSymlinks,
    withImageMeta: query.withImageMeta,
    noArchive: query.noArchive,
    maxResults: query.maxResults,
    maxReturnFiles: query.maxReturnFiles,
    groupBy: query.groupBy,
    refine: query.refine,
  }

  const result = await runAction(query.action, input, host)
  writeResultSummary(host, result.data, query)
}

function writeResultSummary(host: CliHost, data: FindzData | undefined, query: GuidedQuery): void {
  if (!data) return
  const columns = terminalColumns(host)
  const lines = [
    `${rich(host, "total", "cyan")}   ${rich(host, String(data.totalCount), "green")}`,
    `${rich(host, "files", "cyan")}   ${rich(host, String(data.fileCount), "green")}    ${rich(host, "dirs", "cyan")}    ${rich(host, String(data.dirCount), "green")}    ${rich(host, "archives", "cyan")}  ${rich(host, String(data.archiveCount), "green")}`,
    `${rich(host, "scanned", "cyan")} ${rich(host, String(data.scannedFiles), "yellow")}    ${rich(host, "elapsed", "cyan")}  ${rich(host, `${data.elapsedMs} ms`, "yellow")}    ${rich(host, "returned", "cyan")}  ${rich(host, String(data.returnedCount), "yellow")}`,
  ]
  if (data.truncated) lines.push(rich(host, `结果被截断，仅返回前 ${data.returnedCount} 项。`, "yellow"))
  if (query.outputFormat === "text" && data.returnedCount === 0) lines.push(rich(host, "没有匹配的文件。", "yellow"))
  if (data.errors.length) {
    lines.push(rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"))
    for (const error of data.errors.slice(0, 10)) lines.push(rich(host, `• ${truncateVisible(error, columns - 12)}`, "red"))
    if (data.errors.length > 10) lines.push(rich(host, `... 还有 ${data.errors.length - 10} 个错误`, "grey"))
  }
  writeRichPanel(host, "Result Summary", lines, { color: data.errors.length ? "yellow" : "green", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

function guidedActionToCore(action: GuidedAction): FindzAction {
  if (action === "archives-only") return "archives_only"
  if (action === "help-filter") return "help"
  return action
}

async function verifyPaths(paths: string[]): Promise<string[]> {
  const verified: string[] = []
  for (const path of paths) {
    try {
      const info = await lstat(path)
      if (info.isDirectory() || info.isFile()) verified.push(path)
    } catch {
      // skip invalid paths
    }
  }
  return verified
}

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: string): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function outputFormat(args: FindzCliOptions): FindzOutputFormat {
  if (args.json) return "json"
  if (args.csv) return "csv"
  if (args.efu) return "efu"
  return "text"
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
