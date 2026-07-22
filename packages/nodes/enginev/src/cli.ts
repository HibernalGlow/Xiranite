#!/usr/bin/env node
import { readFile } from "node:fs/promises"
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
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"

import type {
  EngineVAction,
  EngineVDeleteResult,
  EngineVExportFormat,
  EngineVInput,
  EngineVRenameResult,
  EngineVResult,
  EngineVRuntime,
  EngineVSortField,
  EngineVSortOrder,
  EngineVWallpaper,
} from "./core.js"
import { DEFAULT_TEMPLATE, DEFAULT_WORKSHOP_PATH, runEngineV } from "./core.js"
import { createNodeEngineVRuntime, readClipboardText } from "./platform.js"
import { createEngineVInteractionSchema, type EngineVInteractionValues } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("enginev")
const WALLPAPER_PREVIEW_LIMIT = 30
const RENAME_PREVIEW_LIMIT = 50
const DELETE_PREVIEW_LIMIT = 50

interface EngineVCliOptions {
  path?: string
  wallpapersFile?: string
  title?: string
  contentRating?: string
  rating?: string
  type?: string
  tags?: string
  ids?: string
  template?: string
  descMaxLength?: string | number
  nameMaxLength?: string | number
  dryRun?: boolean
  execute?: boolean
  permanent?: boolean
  copyMode?: boolean
  targetPath?: string
  output?: string
  exportPath?: string
  format?: EngineVExportFormat
  exportFormat?: EngineVExportFormat
  sortField?: EngineVSortField
  sortOrder?: EngineVSortOrder
  json?: boolean
}

type PathSource = "clipboard" | "manual" | "exit"
type GuidedAction = EngineVAction | "exit"
type RenameMode = "preview-inplace" | "execute-inplace" | "preview-copy" | "execute-copy" | "exit"
type DeleteMode = "preview-trash" | "execute-trash" | "preview-permanent" | "execute-permanent" | "exit"

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Wallpaper Engine workshop scanner and batch folder manager.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  await runInteractionCli({ args, host, cliName: CLI_NAME, loadContext: async () => { const { config } = await loadNodeConfigWithHints<EnginevNodeConfig>("enginev", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } }, createDefinition: (defaults, language) => createEngineVDefinition(defaults, language), runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runMain(createProgram(pipeHost), { rawArgs: pipeArgs }) : Promise.resolve(writeUsage(pipeHost)), runGuide: runGuidedInteraction, runUi: runTerminalUi, loadScreen: async () => (await import("./Tui.js")).EngineVTui, createPreferences: (_defaults, values) => createPreferenceController(host, values), reexecEntrypoint: process.argv[1], help })
}

function createEngineVDefinition(defaults: EnginevNodeConfig, language: TerminalLanguage): TerminalInteractionDefinition<EngineVInput, EngineVResult> { let cached: EngineVWallpaper[] = []; return { schema: createEngineVInteractionSchema({ workshopPath: defaults.workshop_root?.trim() || DEFAULT_WORKSHOP_PATH, exportPath: defaults.export_path ?? "", exportFormat: defaults.export_format ?? "json", maxWorkers: defaults.max_workers ?? 4, template: defaults.template ?? DEFAULT_TEMPLATE, imageBackend: defaults.image_backend ?? "auto", galleryColumns: defaults.gallery_columns ?? 0 } satisfies Partial<EngineVInteractionValues>, language), async run(input, onEvent) { const enriched = input.action !== "scan" && !input.wallpapers?.length ? { ...input, wallpapers: cached } : input; const result = await runEngineV(enriched, createNodeEngineVRuntime(), onEvent); if (result.data?.wallpapers?.length) cached = result.data.wallpapers; return result } } }

function createPreferenceController(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController { const options = { env: host.env, cwd: host.cwd }; return { nodeId: "enginev", current, async save(values) { await updateNodeConfigFile("enginev", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<EnginevNodeConfig>("enginev", { ...options, jsonMode: true }); const prefs = resolveInteractionPreferences(config); return { theme: prefs.theme, defaultMode: prefs.mode, language: prefs.language ?? resolveTerminalLanguage(undefined, host.env) } } } }

function writeUsage(host: CliHost) { writeLine(host, `${CLI_NAME} - Wallpaper Engine workshop gallery manager`); writeLine(host, `  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]`); writeLine(host, `  ${CLI_NAME} gd`); writeLine(host, `  ${CLI_NAME} scan|filter|rename|delete|export [options] [--json]`) }

function createDefaultHost(): CliHost {
  return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "Wallpaper Engine workshop workflow with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan a Wallpaper Engine workshop folder." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("scan", await resolveEngineVArgs(args as EngineVCliOptions, host), Boolean(args.json), host)
        },
      }),
      filter: defineCommand({
        meta: { name: "filter", description: "Filter scanned or freshly scanned wallpapers." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("filter", await resolveEngineVArgs(args as EngineVCliOptions, host), Boolean(args.json), host)
        },
      }),
      rename: defineCommand({
        meta: { name: "rename", description: "Plan or execute batch folder rename/copy." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("rename", await resolveEngineVArgs(args as EngineVCliOptions, host), Boolean(args.json), host)
        },
      }),
      delete: defineCommand({
        meta: { name: "delete", description: "Plan or execute wallpaper folder deletion." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("delete", await resolveEngineVArgs(args as EngineVCliOptions, host), Boolean(args.json), host)
        },
      }),
      export: defineCommand({
        meta: { name: "export", description: "Export filtered wallpapers as JSON or paths." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("export", await resolveEngineVArgs(args as EngineVCliOptions, host), Boolean(args.json), host)
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Open the guided terminal workflow." },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

function commonArgs() {
  return {
    path: { type: "string", description: "Workshop folder path." },
    wallpapersFile: { type: "string", description: "JSON file containing wallpapers from a previous scan." },
    title: { type: "string", description: "Title filter." },
    contentRating: { type: "string", description: "Content rating filter." },
    rating: { type: "string", description: "Alias for --contentRating." },
    type: { type: "string", description: "Wallpaper type filter." },
    tags: { type: "string", description: "Comma-separated tag filter." },
    ids: { type: "string", description: "Comma-separated workshop ids." },
    template: { type: "string", description: "Rename template." },
    descMaxLength: { type: "string", description: "Description placeholder max length." },
    nameMaxLength: { type: "string", description: "Final folder name max length." },
    dryRun: { type: "boolean", description: "Preview file operations." },
    execute: { type: "boolean", description: "Execute rename/delete instead of dry-run." },
    permanent: { type: "boolean", description: "Delete permanently instead of trash." },
    copyMode: { type: "boolean", description: "Copy folders to --targetPath instead of renaming in place." },
    targetPath: { type: "string", description: "Target folder for copy mode." },
    output: { type: "string", description: "Export output path." },
    exportPath: { type: "string", description: "Export output path." },
    format: { type: "string", description: "Export format: json or paths." },
    exportFormat: { type: "string", description: "Export format: json or paths." },
    sortField: { type: "string", description: "Sort field." },
    sortOrder: { type: "string", description: "asc or desc." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function resolveEngineVArgs(args: EngineVCliOptions, host: CliHost): Promise<EngineVCliOptions> {
  if (args.path !== "-" && (args.path || !hasPipedInput(host.stdin))) return args
  if (!(Symbol.asyncIterator in (host.stdin as object))) return args
  const lines = await readStdinLines(host.stdin)
  return { ...args, path: lines[0] }
}

async function runAction(action: EngineVAction, args: EngineVCliOptions, json: boolean, host: CliHost): Promise<void> {
  const input = await inputFromArgs(action, args)
  let progressActive = false
  const result = await runEngineV(input, createNodeEngineVRuntime(), json ? undefined : (event) => {
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
  writeEngineVSummary(host, result)
  if (!result.success) process.exitCode = 1
}

async function inputFromArgs(action: EngineVAction, args: EngineVCliOptions): Promise<EngineVInput> {
  const wallpapers = args.wallpapersFile ? await readWallpapersFile(args.wallpapersFile) : undefined
  return {
    action,
    path: args.path,
    wallpapers,
    filters: {
      title: args.title,
      contentRating: args.contentRating || args.rating,
      type: args.type,
      tags: args.tags,
    },
    ids: args.ids,
    template: args.template,
    descMaxLength: numberArg(args.descMaxLength),
    nameMaxLength: numberArg(args.nameMaxLength),
    dryRun: args.execute ? false : args.dryRun ?? true,
    permanent: args.permanent,
    copyMode: args.copyMode,
    targetPath: args.targetPath,
    exportPath: args.exportPath || args.output,
    exportFormat: normalizeFormat(args.exportFormat || args.format),
    sortField: args.sortField,
    sortOrder: args.sortOrder,
  }
}

async function readWallpapersFile(file: string): Promise<Array<Record<string, unknown>>> {
  const parsed = JSON.parse(await readFile(file, "utf8")) as unknown
  const wallpapers = Array.isArray(parsed) ? parsed : asRecord(parsed).wallpapers
  if (!Array.isArray(wallpapers)) throw new Error("wallpapersFile must contain an array or an object with a wallpapers array.")
  return wallpapers.map((item) => asRecord(item)).filter((item) => Object.keys(item).length > 0)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

// --- Guided flow ---

interface EnginevNodeConfig extends CliInteractionPreferencesSource {
  workshop_root?: string
  export_path?: string
  export_format?: EngineVExportFormat
  max_workers?: number
  template?: string
  image_backend?: "auto" | "sixel" | "kitty" | "half-block"
  gallery_columns?: number
}

interface EnginevDefaults {
  workshopRoot?: string
  exportPath?: string
  exportFormat?: EngineVExportFormat
}

/**
 * Read enginev defaults from xiranite.config.toml [nodes.enginev] section.
 * Returns empty defaults when the config file or section is missing.
 * wallpapersFile is intentionally NOT read from TOML (large scan results stay external).
 */
async function resolveEnginevDefaults(host: CliHost, json: boolean): Promise<EnginevDefaults> {
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<EnginevNodeConfig>("enginev", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      workshopRoot: nodeConfig?.workshop_root?.trim() || undefined,
      exportPath: nodeConfig?.export_path?.trim() || undefined,
      exportFormat: nodeConfig?.export_format,
    }
  } catch {
    return {}
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} scan --path <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const runtime = createNodeEngineVRuntime()
  const defaults = await resolveEnginevDefaults(host, false)
  let firstRender = true
  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const workshopPath = await resolveWorkshopPath(host, runtime, defaults)
      if (!workshopPath) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const action = await resolveAction(host)
      if (!action) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const partial = await resolveActionOptions(host, action, defaults)
      if (!partial) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const input: EngineVInput = { action, path: workshopPath, ...partial }
      const confirmed = await confirmRich(host, `确认执行 ${action} 操作?`, true)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      await runGuidedAction(input, host)
      if (!await confirmRich(host, "继续选择其他操作?", false)) return
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
  writeRichPanel(host, "Xiranite EngineV", [
    `${rich(host, "入口", "cyan")}  Wallpaper Engine 工坊扫描与批量管理工具`,
    `${rich(host, "执行", "cyan")}  直接调用 enginev core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；默认读取 Wallpaper Engine 工坊目录`,
    `${rich(host, "操作", "cyan")}  scan / filter / rename / delete / export`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    `${rich(host, "默认工坊", "magenta")}  ${DEFAULT_WORKSHOP_PATH}`,
    `${rich(host, "默认模板", "magenta")}  ${DEFAULT_TEMPLATE}`,
    `${rich(host, "脚本化", "magenta")}  ${CLI_NAME} scan --path <folder> --json`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function resolveWorkshopPath(host: CliHost, runtime: EngineVRuntime, defaults: EnginevDefaults): Promise<string | undefined> {
  const source = await selectRich<PathSource>(
    host,
    "选择工坊路径来源",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的单行/多行路径" },
      { value: "manual", label: "手动输入路径", hint: "直接输入完整路径" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }

  if (source === "clipboard") {
    const clipboard = (await readClipboardText()).trim()
    if (!clipboard) {
      writeRichPanel(host, "Clipboard", "剪贴板为空，请改用手动输入。", { color: "yellow", minWidth: 48 })
      return undefined
    }
    const path = clipboard.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? ""
    if (!path) {
      writeRichPanel(host, "Clipboard", "剪贴板中未找到有效路径。", { color: "yellow", minWidth: 48 })
      return undefined
    }
    const info = await runtime.pathInfo(path)
    if (!info.exists || !info.isDirectory) {
      writeRichPanel(host, "Clipboard", `剪贴板中的路径不是有效文件夹: ${path}`, { color: "red", minWidth: 48 })
      return undefined
    }
    writeLine(host, rich(host, `已从剪贴板读取路径: ${info.path}`, "yellow"))
    return info.path
  }

  const fallback = defaults.workshopRoot
  const answer = (await promptRich(host, "输入 Wallpaper Engine 工坊目录路径", fallback ?? "")).trim()
  const path = answer || fallback
  if (!path) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return undefined
  }
  const info = await runtime.pathInfo(path)
  if (!info.exists || !info.isDirectory) {
    writeRichPanel(host, "Path", `不是有效文件夹: ${path}`, { color: "red", minWidth: 48 })
    return undefined
  }
  return info.path
}

async function resolveAction(host: CliHost): Promise<EngineVAction | undefined> {
  const choice = await selectRich<GuidedAction>(
    host,
    "选择要执行的操作",
    [
      { value: "scan", label: "scan", hint: "扫描工坊目录并打印统计" },
      { value: "filter", label: "filter", hint: "按标题/类型/评级/标签过滤" },
      { value: "rename", label: "rename", hint: "批量重命名或复制文件夹" },
      { value: "delete", label: "delete", hint: "批量删除壁纸文件夹" },
      { value: "export", label: "export", hint: "导出 JSON 或路径列表" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: "scan", maxItems: 6 },
  )

  if (choice === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }
  return choice
}

async function resolveActionOptions(host: CliHost, action: EngineVAction, defaults: EnginevDefaults): Promise<Omit<EngineVInput, "action" | "path"> | undefined> {
  if (action === "scan") return {}
  if (action === "filter") return await resolveFilterOptions(host)
  if (action === "rename") return await resolveRenameOptions(host)
  if (action === "delete") return await resolveDeleteOptions(host)
  if (action === "export") return await resolveExportOptions(host, defaults)
  return {}
}

async function resolveFilterOptions(host: CliHost): Promise<Partial<EngineVInput>> {
  const title = (await promptRich(host, "标题过滤词 (留空跳过)", "")).trim()
  const type = (await promptRich(host, "壁纸类型过滤 (留空跳过，如 Video/Scene/Web)", "")).trim()
  const contentRating = (await promptRich(host, "内容评级过滤 (留空跳过，如 Everyone/Questionable)", "")).trim()
  const tags = (await promptRich(host, "标签过滤，逗号分隔 (留空跳过)", "")).trim()
  return {
    filters: {
      title: title || undefined,
      type: type || undefined,
      contentRating: contentRating || undefined,
      tags: tags || undefined,
    },
  }
}

async function resolveRenameOptions(host: CliHost): Promise<Partial<EngineVInput> | undefined> {
  const template = (await promptRich(host, "命名模板", DEFAULT_TEMPLATE)).trim() || DEFAULT_TEMPLATE
  const mode = await selectRich<RenameMode>(
    host,
    "选择重命名模式",
    [
      { value: "preview-inplace", label: "原位重命名 - 预览", hint: "生成计划，不修改文件" },
      { value: "execute-inplace", label: "原位重命名 - 执行", hint: "直接修改文件夹名称" },
      { value: "preview-copy", label: "复制到新位置 - 预览", hint: "保留原文件，生成计划" },
      { value: "execute-copy", label: "复制到新位置 - 执行", hint: "保留原文件，复制到目标目录" },
      { value: "exit", label: "退出", hint: "取消重命名" },
    ],
    { initialValue: "preview-inplace", maxItems: 5 },
  )
  if (mode === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }
  const copyMode = mode === "preview-copy" || mode === "execute-copy"
  const dryRun = mode === "preview-inplace" || mode === "preview-copy"
  let targetPath: string | undefined
  if (copyMode) {
    targetPath = (await promptRich(host, "目标目录路径", "")).trim() || undefined
    if (!targetPath) {
      writeRichPanel(host, "Target", "复制模式需要指定目标目录。", { color: "yellow", minWidth: 48 })
      return undefined
    }
  }
  return { template, copyMode, dryRun, targetPath }
}

async function resolveDeleteOptions(host: CliHost): Promise<Partial<EngineVInput> | undefined> {
  const idsText = (await promptRich(host, "输入要删除的 workshop id，逗号分隔", "")).trim()
  if (!idsText) {
    writeRichPanel(host, "Delete", "未提供任何 id，无法删除。", { color: "yellow", minWidth: 48 })
    return undefined
  }
  const mode = await selectRich<DeleteMode>(
    host,
    "选择删除模式",
    [
      { value: "preview-trash", label: "回收站 - 预览", hint: "可恢复" },
      { value: "execute-trash", label: "回收站 - 执行", hint: "移到回收站" },
      { value: "preview-permanent", label: "永久删除 - 预览", hint: "不可恢复" },
      { value: "execute-permanent", label: "永久删除 - 执行", hint: "直接删除，不可恢复" },
      { value: "exit", label: "退出", hint: "取消删除" },
    ],
    { initialValue: "preview-trash", maxItems: 5 },
  )
  if (mode === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }
  const permanent = mode === "preview-permanent" || mode === "execute-permanent"
  const dryRun = mode === "preview-trash" || mode === "preview-permanent"
  return { ids: idsText, permanent, dryRun }
}

async function resolveExportOptions(host: CliHost, defaults: EnginevDefaults): Promise<Partial<EngineVInput> | undefined> {
  const format = await selectRich<EngineVExportFormat>(
    host,
    "选择导出格式",
    [
      { value: "json", label: "json", hint: "完整 JSON 数据" },
      { value: "paths", label: "paths", hint: "仅路径列表，每行一个" },
    ],
    { initialValue: defaults.exportFormat ?? "json", maxItems: 3 },
  )
  const exportPath = (await promptRich(host, "导出文件路径", defaults.exportPath ?? "enginev_export.json")).trim()
  if (!exportPath) {
    writeRichPanel(host, "Export", "未提供导出路径。", { color: "yellow", minWidth: 48 })
    return undefined
  }
  return { exportFormat: format, exportPath }
}

async function runGuidedAction(input: EngineVInput, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runEngineV(input, createNodeEngineVRuntime(), (event) => {
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
  writeEngineVSummary(host, result)
  if (!result.success) process.exitCode = 1
}

function writeEngineVSummary(host: CliHost, result: EngineVResult): void {
  const data = result.data
  if (!data) return
  const columns = terminalColumns(host)

  const summaryLines: string[] = [
    `${rich(host, "总计", "cyan")} ${data.totalCount}  ${rich(host, "过滤后", "cyan")} ${data.filteredCount}  ${rich(host, "成功", "green")} ${data.successCount}  ${rich(host, "失败", "red")} ${data.failedCount}`,
  ]
  if (data.exportPath) summaryLines.push(`${rich(host, "导出", "magenta")} ${data.exportPath}`)
  writeRichPanel(host, "执行结果", summaryLines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })

  if (Object.keys(data.typeStats).length || Object.keys(data.ratingStats).length) {
    const statLines: string[] = []
    if (Object.keys(data.typeStats).length) {
      statLines.push(rich(host, "类型分布", "cyan"))
      for (const [type, count] of Object.entries(data.typeStats).sort((a, b) => b[1] - a[1])) {
        statLines.push(`  ${rich(host, type, "magenta")}: ${rich(host, String(count), "green")}`)
      }
    }
    if (Object.keys(data.ratingStats).length) {
      statLines.push(rich(host, "内容评级分布", "cyan"))
      for (const [rating, count] of Object.entries(data.ratingStats).sort((a, b) => b[1] - a[1])) {
        statLines.push(`  ${rich(host, rating, "magenta")}: ${rich(host, String(count), "green")}`)
      }
    }
    writeRichPanel(host, "统计", statLines, { color: "blue", maxWidth: columns - 2, minWidth: Math.min(60, columns - 6) })
  }

  if (data.filteredWallpapers.length) {
    writeLine(host, rich(host, "壁纸预览:", "cyan"))
    for (const wallpaper of data.filteredWallpapers.slice(0, WALLPAPER_PREVIEW_LIMIT)) {
      writeLine(host, `  ${formatWallpaper(wallpaper, host)}`)
    }
    if (data.filteredWallpapers.length > WALLPAPER_PREVIEW_LIMIT) {
      writeLine(host, rich(host, `  ... 还有 ${data.filteredWallpapers.length - WALLPAPER_PREVIEW_LIMIT} 个`, "grey"))
    }
  }

  if (data.renameResults.length) {
    writeLine(host, rich(host, "重命名结果:", "cyan"))
    for (const item of data.renameResults.slice(0, RENAME_PREVIEW_LIMIT)) {
      writeLine(host, `  ${formatRenameResult(item, host)}`)
    }
    if (data.renameResults.length > RENAME_PREVIEW_LIMIT) {
      writeLine(host, rich(host, `  ... 还有 ${data.renameResults.length - RENAME_PREVIEW_LIMIT} 个`, "grey"))
    }
  }

  if (data.deleteResults.length) {
    writeLine(host, rich(host, "删除结果:", "cyan"))
    for (const item of data.deleteResults.slice(0, DELETE_PREVIEW_LIMIT)) {
      writeLine(host, `  ${formatDeleteResult(item, host)}`)
    }
    if (data.deleteResults.length > DELETE_PREVIEW_LIMIT) {
      writeLine(host, rich(host, `  ... 还有 ${data.deleteResults.length - DELETE_PREVIEW_LIMIT} 个`, "grey"))
    }
  }

  if (data.errors.length) {
    writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })
  }
}

function formatWallpaper(wallpaper: EngineVWallpaper, host: CliHost): string {
  const id = rich(host, padOrTruncate(wallpaper.workshopId, 10), "magenta")
  const type = rich(host, padOrTruncate(wallpaper.wallpaperType || "?", 8), "blue")
  const rating = rich(host, padOrTruncate(wallpaper.contentRating || "?", 12), "yellow")
  const budget = Math.max(8, terminalColumns(host) - 36)
  return `${id} ${type} ${rating} ${truncateVisible(wallpaper.title, budget)}`
}

function formatRenameResult(item: EngineVRenameResult, host: CliHost): string {
  const statusColor = item.status === "error" ? "red" : item.status === "planned" ? "cyan" : "green"
  const status = rich(host, padOrTruncate(item.status, 8), statusColor)
  const arrow = rich(host, "->", "grey")
  const budget = Math.max(20, Math.floor((terminalColumns(host) - 30) / 2))
  const error = item.error ? ` ${rich(host, `/ ${item.error}`, "red")}` : ""
  return `${status} ${truncateVisible(item.oldPath, budget)} ${arrow} ${truncateVisible(item.newPath, budget)}${error}`
}

function formatDeleteResult(item: EngineVDeleteResult, host: CliHost): string {
  const statusColor = item.status === "error" ? "red" : item.status === "planned" ? "cyan" : "green"
  const status = rich(host, padOrTruncate(item.status, 8), statusColor)
  const budget = Math.max(20, terminalColumns(host) - 30)
  return `${status} ${truncateVisible(item.path, budget)} ${rich(host, item.message, "grey")}`
}

function padOrTruncate(value: string, width: number): string {
  if (value.length > width) return value.slice(0, width)
  return value.padEnd(width)
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

function normalizeFormat(value?: string): EngineVExportFormat {
  return value === "paths" ? "paths" : "json"
}

function numberArg(value?: string | number): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
