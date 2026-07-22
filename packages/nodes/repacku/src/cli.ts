#!/usr/bin/env node
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
  runGuidedInteraction,
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
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"
import type { RepackuAction, RepackuInput, RepackuOperation, RepackuResult, RepackuRuntime } from "./core.js"
import { runRepacku } from "./core.js"
import { createNodeRepackuRuntime, readClipboardText } from "./platform.js"
import { createRepackuInteractionSchema, type RepackuInteractionValues } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("repacku")


interface RepackuCliOptions {
  path?: string
  paths?: string
  config?: string
  configPath?: string
  types?: string
  output?: string
  outputPath?: string
  clipboard?: boolean
  deleteAfter?: boolean
  dryRun?: boolean
  gallery?: boolean
  json?: boolean
  minCount?: string | number
  galleryMarker?: string
  single?: boolean
}

/**
 * 常用压缩规则与默认路径，从 xiranite.config.toml 的 [nodes.repacku] 段读取。
 * 仅作为 guided 流程的回退默认值，不进入 analyze 产物 JSON。
 */
interface RepackuDefaults {
  default_root?: string
  default_output_dir?: string
  types?: string
  delete_after?: boolean
  min_count?: number
  gallery_marker?: string
}

interface RepackuNodeConfig extends CliInteractionPreferencesSource, RepackuDefaults {}

interface RepackuCliDependencies {
  runGuide: <Input, Result>(definition: TerminalInteractionDefinition<Input, Result>, options: { host: CliHost; language: TerminalLanguage }) => Promise<void>
  runUi: typeof runTerminalUi
}

const defaultDependencies: RepackuCliDependencies = {
  runGuide: runGuidedInteraction,
  runUi: runTerminalUi,
}

/**
 * 从 xiranite.config.toml 的 [nodes.repacku] 段读取常用默认参数。
 * 文件不存在或解析失败时返回空对象，guided 流程继续使用内置默认值。
 */
async function resolveRepackuDefaults(host: CliHost, json: boolean): Promise<RepackuDefaults> {
  try {
    const { config } = await loadNodeConfigWithHints<RepackuDefaults>("repacku", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return config ?? {}
  } catch {
    // ignore: 配置缺失或解析失败时回退到内置默认值
  }
  return {}
}

interface GuidedTask {
  name: string
  description: string
  inputs: Array<Omit<RepackuInput, "path" | "paths">>
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "path"; path: string; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "image-only",
    description: "图片规则压缩，默认读取剪贴板路径，成功后删除源文件",
    inputs: [{ action: "compress", types: "image", deleteAfter: true }],
  },
  {
    name: "gallery-pack",
    description: "查找画集目录并批量执行单层打包",
    inputs: [{ action: "gallery-pack", deleteAfter: true }],
  },
  {
    name: "gallery-and-single",
    description: "先处理画集目录，再处理当前目录单层打包",
    inputs: [
      { action: "gallery-pack", deleteAfter: true },
      { action: "single-pack", deleteAfter: true },
    ],
  },
  {
    name: "single-pack",
    description: "对子目录和散图执行单层打包",
    inputs: [{ action: "single-pack", deleteAfter: true }],
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Analyze folder trees and repack folders into zip archives.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  await runInteractionCli({
    args,
    host,
    cliName: CLI_NAME,
    loadContext: async () => {
      const { config } = await loadNodeConfigWithHints<RepackuNodeConfig>("repacku", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true })
      return { preferences: resolveInteractionPreferences(config), value: config ?? {} }
    },
    createDefinition: (defaults, language) => createRepackuInteractionDefinition(defaults, language, host),
    runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runMain(createProgram(pipeHost), { rawArgs: pipeArgs }) : Promise.resolve(writeUsage(pipeHost)),
    runGuide: defaultDependencies.runGuide,
    runUi: defaultDependencies.runUi,
    loadScreen: async () => (await import("./Tui.js")).RepackuTui,
    createPreferences: (_defaults, values) => createPreferenceController(host, values),
    reexecEntrypoint: process.argv[1],
    help,
  })
}

function createPreferenceController(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const configOptions = { env: host.env, cwd: host.cwd }
  return {
    nodeId: "repacku",
    current,
    async save(values) {
      await updateNodeConfigFile("repacku", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, configOptions)
    },
    async restore() {
      const { config } = await loadNodeConfigWithHints<RepackuNodeConfig>("repacku", { ...configOptions, jsonMode: true })
      const preferences = resolveInteractionPreferences(config)
      return { theme: preferences.theme, defaultMode: preferences.mode, language: preferences.language ?? resolveTerminalLanguage(undefined, host.env) }
    },
  }
}

function createRepackuInteractionDefinition(defaults: RepackuDefaults, language: TerminalLanguage, host: CliHost): TerminalInteractionDefinition<RepackuInput, RepackuResult> {
  return {
    schema: createRepackuInteractionSchema({
      pathsText: defaults.default_root ?? "",
      types: defaults.types ?? "image",
      minCount: defaults.min_count,
      outputPath: defaults.default_output_dir ?? "",
      galleryMarker: defaults.gallery_marker ?? ". 画集",
      deleteAfter: defaults.delete_after ?? false,
    } satisfies Partial<RepackuInteractionValues>, language),
    run: async (input, onEvent) => runRepacku(input, createNodeRepackuRuntime(), onEvent),
  }
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

function writeUsage(host: CliHost): void {
  writeLine(host, `${CLI_NAME} - folder analysis and safe repacking`)
  writeLine(host)
  writeLine(host, "Interactive modes:")
  writeLine(host, `  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]`)
  writeLine(host, `  ${CLI_NAME} gd`)
  writeLine(host, `  ${CLI_NAME} guided    Compatibility alias for gd`)
  writeLine(host)
  writeLine(host, "Pipe-safe commands:")
  writeLine(host, `  ${CLI_NAME} analyze|compress|full|single-pack|gallery-pack [options] [--json]`)
  writeLine(host, "Use --dry-run for a preview; --delete-after removes sources after successful compression.")
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "Folder repacking workflow with built-in guided mode." },
    subCommands: {
      analyze: defineCommand({
        meta: { name: "analyze", description: "Analyze a folder and write a repacku config JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("analyze", args as RepackuCliOptions, host)
        },
      }),
      compress: defineCommand({
        meta: { name: "compress", description: "Compress from an existing config, or run gallery/single pack modes." },
        args: commonArgs(),
        async run({ args }) {
          await runCompressCommand(args as RepackuCliOptions, host)
        },
      }),
      full: defineCommand({
        meta: { name: "full", description: "Analyze and then compress in one flow." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("full", args as RepackuCliOptions, host)
        },
      }),
      "single-pack": defineCommand({
        meta: { name: "single-pack", description: "Pack first-level child folders and loose image files." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("single-pack", args as RepackuCliOptions, host)
        },
      }),
      "gallery-pack": defineCommand({
        meta: { name: "gallery-pack", description: "Find gallery folders and run single-pack in each one." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("gallery-pack", args as RepackuCliOptions, host)
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Open the guided repacku workflow." },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

function commonArgs() {
  return {
    path: { type: "string", description: "Folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated folder paths." },
    config: { type: "string", description: "Config JSON path." },
    configPath: { type: "string", description: "Config JSON path." },
    types: { type: "string", description: "Target file types, comma separated, for example image,document." },
    output: { type: "string", description: "Config output path." },
    outputPath: { type: "string", description: "Config output path." },
    clipboard: { type: "boolean", description: "Read folder path from clipboard when --path is omitted." },
    deleteAfter: { type: "boolean", description: "Delete source files after successful compression." },
    dryRun: { type: "boolean", description: "Plan operations without writing archives." },
    gallery: { type: "boolean", description: "Compatibility alias for gallery-pack under compress." },
    single: { type: "boolean", description: "Compatibility alias for single-pack under compress." },
    minCount: { type: "string", description: "Minimum matching direct files before compression." },
    galleryMarker: { type: "string", description: "Folder name marker used by gallery-pack." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} compress --path <folder>\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const runtime = createNodeRepackuRuntime()
  const defaults = await resolveRepackuDefaults(host, false)
  const defaultTask = GUIDED_TASKS[0]!
  let firstRender = true
  try {
    while (true) {
      renderGuidedIntro(host, firstRender, defaults)
      firstRender = false

      const choice = await readGuidedChoice(host, defaultTask, runtime)
      if (choice.kind === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const paths = choice.kind === "path" ? [choice.path] : await resolveGuidedPaths(host, runtime, defaults)
      if (!paths.length) {
        writeRichPanel(host, "Path", "未提供有效文件夹路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        `path: ${paths.join("; ")}`,
        "mode: direct core call, no Taskfile shell hop",
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const ok = await runGuidedTask(choice.task, paths, host, defaults)
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

function renderGuidedIntro(host: CliHost, includeHeader: boolean, defaults: RepackuDefaults = {}): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  writeRichPanel(host, "Xiranite Repacku", [
    `${rich(host, "入口", "cyan")}  内置 TypeScript guided flow`,
    `${rich(host, "执行", "cyan")}  直接调用 repacku core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  可直接粘贴路径；否则读取剪贴板，失败时再手动输入`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  const hint = defaults.default_root || defaults.types || defaults.delete_after !== undefined
    ? `提示: guided 已读取 xiranite.config.toml [nodes.repacku] 默认值（${describeDefaults(defaults)}）；不输入时自动套用。需要预演请用 \`${CLI_NAME} compress --dry-run\`。`
    : `提示: guided 默认保持原 repacku 习惯，成功后删除源文件；需要预演请用 \`${CLI_NAME} compress --dry-run\`。`
  writeLine(host, rich(host, hint, "grey"))
}

function describeDefaults(defaults: RepackuDefaults): string {
  const parts: string[] = []
  if (defaults.default_root) parts.push(`root=${defaults.default_root}`)
  if (defaults.default_output_dir) parts.push(`output=${defaults.default_output_dir}`)
  if (defaults.types) parts.push(`types=${defaults.types}`)
  if (defaults.delete_after !== undefined) parts.push(`delete_after=${defaults.delete_after}`)
  if (defaults.min_count !== undefined) parts.push(`min_count=${defaults.min_count}`)
  if (defaults.gallery_marker) parts.push(`gallery_marker=${defaults.gallery_marker}`)
  return parts.join(", ") || "none"
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask, runtime: RepackuRuntime): Promise<ResolvedGuidedChoice> {
  const directPath = cleanPath(await promptRich(host, "粘贴文件夹路径直接执行默认任务；留空进入任务选择", ""))
  if (directPath) {
    const info = await runtime.pathInfo(directPath)
    if (info.exists && info.isDirectory) return { kind: "path", path: info.path, task: defaultTask }
    writeRichPanel(host, "Path", `不是有效文件夹: ${directPath}`, { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 repacku 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入路径，并使用默认 image-only 任务" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 8 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") {
    const answer = await promptRich(host, "输入文件夹路径", "")
    const [path] = await validDirectoryPaths(splitPaths(answer), runtime)
    if (path) return { kind: "path", path, task: defaultTask }
    writeRichPanel(host, "Path", "未提供有效文件夹路径。", { color: "yellow", minWidth: 48 })
    return { kind: "task", task: defaultTask }
  }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolveGuidedPaths(host: CliHost, runtime: RepackuRuntime, defaults: RepackuDefaults = {}): Promise<string[]> {
  const clipboardPaths = await pathsFromClipboard(runtime)
  if (clipboardPaths.length) {
    writeLine(host, rich(host, `已从剪贴板读取 ${clipboardPaths.length} 个路径。`, "yellow"))
    return clipboardPaths
  }

  const answer = await promptRich(host, "输入文件夹路径", "")
  const manualPaths = await validDirectoryPaths(splitPaths(answer), runtime)
  if (manualPaths.length) return manualPaths

  if (defaults.default_root) {
    const info = await runtime.pathInfo(defaults.default_root)
    if (info.exists && info.isDirectory) {
      writeLine(host, rich(host, `使用 TOML 默认根目录: ${info.path}`, "yellow"))
      return [info.path]
    }
  }

  return []
}

async function runGuidedTask(task: GuidedTask, paths: string[], host: CliHost, defaults: RepackuDefaults = {}): Promise<boolean> {
  const inputs = task.inputs.flatMap((input) => paths.map((path) => ({
    ...input,
    paths: [path],
    types: input.types ?? defaults.types,
    deleteAfter: input.deleteAfter ?? defaults.delete_after,
    minCount: input.minCount ?? defaults.min_count,
    galleryMarker: input.galleryMarker ?? defaults.gallery_marker,
  })))
  return await runActions(inputs, false, host)
}

async function runSingleAction(action: RepackuAction, args: RepackuCliOptions, host: CliHost): Promise<boolean> {
  const opts = await resolveRepackuArgs(args, host)
  const input = await inputFromArgs(opts)
  return await runActions([{ action, ...input }], Boolean(opts.json), host)
}

async function runCompressCommand(args: RepackuCliOptions, host: CliHost): Promise<boolean> {
  const opts = await resolveRepackuArgs(args, host)
  const input = await inputFromArgs(opts)
  const actions: RepackuAction[] = []
  if (opts.gallery) actions.push("gallery-pack")
  if (opts.single) actions.push("single-pack")
  if (!actions.length) actions.push("compress")
  return await runActions(actions.map((action) => ({ action, ...input })), Boolean(opts.json), host)
}

async function resolveRepackuArgs(args: RepackuCliOptions, host: CliHost): Promise<RepackuCliOptions> {
  const pathFromStdin = args.path === "-" || (!args.path && hasPipedInput(host.stdin))
  const pathsFromStdin = args.paths === "-" || (!args.paths && hasPipedInput(host.stdin))
  if (!pathFromStdin && !pathsFromStdin) return args
  if (!(Symbol.asyncIterator in (host.stdin as object))) return args
  const stdinLines = await readStdinLines(host.stdin)
  const resolved: RepackuCliOptions = { ...args }
  if (pathFromStdin) resolved.path = stdinLines[0] ?? ""
  if (pathsFromStdin) resolved.paths = stdinLines.join(";")
  return resolved
}

async function inputFromArgs(args: RepackuCliOptions): Promise<Omit<RepackuInput, "action">> {
  let paths = splitPaths(args.paths, args.path ? [args.path] : [])
  if (args.clipboard && !paths.length) {
    paths = await pathsFromClipboard()
  }

  return {
    paths,
    configPath: args.configPath || args.config,
    types: args.types,
    outputPath: args.outputPath || args.output,
    deleteAfter: args.deleteAfter,
    dryRun: args.dryRun,
    minCount: numberArg(args.minCount),
    galleryMarker: args.galleryMarker,
  }
}

async function runActions(inputs: RepackuInput[], json: boolean, host: CliHost): Promise<boolean> {
  if (json && inputs.length > 1) {
    const results = await Promise.all(inputs.map((input) => runRepacku(input, createNodeRepackuRuntime())))
    writeJson(host, results)
    if (results.some((result) => !result.success)) process.exitCode = 1
    return results.every((result) => result.success)
  }

  let ok = true
  for (const input of inputs) {
    const result = await runAction(input, json, host)
    ok = ok && result.success
    if (!result.success) break
  }
  return ok
}

async function runAction(input: RepackuInput, json: boolean, host: CliHost): Promise<RepackuResult> {
  let progressActive = false
  const result = await runRepacku(input, createNodeRepackuRuntime(), (event) => {
    if (json) return
    if (event.type === "progress") {
      writeProgress(host, renderProgressBar(host, event.progress ?? 0, event.message, { label: "repacku" }))
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
    return result
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  const data = result.data
  if (data) {
    writeRichPanel(host, "Summary", [
      data.configPath ? `config: ${data.configPath}` : "",
      `folders: ${data.totalFolders}  entire: ${data.entireCount}  selective: ${data.selectiveCount}  skip: ${data.skipCount}`,
      `operations: ${data.totalOperations}  planned: ${data.plannedCount}  compressed: ${data.compressedCount}  failed: ${data.failedCount}  skipped: ${data.skippedCount}`,
    ].filter(Boolean), { color: result.success ? "green" : "yellow", minWidth: 76 })
    for (const operation of data.operations.slice(0, 80)) writeLine(host, formatOperation(operation, host))
    if (data.operations.length > 80) writeLine(host, rich(host, `... ${data.operations.length - 80} more operation(s)`, "grey"))
    if (data.errors.length) writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })
  }
  if (!result.success) process.exitCode = 1
  return result
}

async function pathsFromClipboard(runtime: RepackuRuntime = createNodeRepackuRuntime()): Promise<string[]> {
  const text = await readClipboardText()
  if (!text) return []
  return await validDirectoryPaths(splitPaths(text), runtime)
}

async function validDirectoryPaths(candidates: string[], runtime: RepackuRuntime): Promise<string[]> {
  const paths: string[] = []
  for (const candidate of candidates) {
    const info = await runtime.pathInfo(candidate)
    if (info.exists && info.isDirectory) paths.push(info.path)
  }
  return paths
}

function splitPaths(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)]
    .map(cleanPath)
    .filter(Boolean)
}

function cleanPath(value = ""): string {
  return value.trim().replace(/^["']|["']$/g, "")
}

function numberArg(value?: number | string): number | undefined {
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

function formatOperation(operation: RepackuOperation, host: CliHost): string {
  const extensions = operation.extensions.length ? ` [${operation.extensions.join(",")}]` : ""
  const status = operation.status === "success"
    ? rich(host, "success", "green")
    : operation.status === "error"
      ? rich(host, "error", "red")
      : operation.status === "skipped"
        ? rich(host, "skipped", "yellow")
        : rich(host, "planned", "cyan")
  const mode = rich(host, operation.mode, operation.mode === "entire" ? "blue" : "magenta")
  if (!host.stdout.isTTY) return `${status} ${mode}${extensions} ${operation.sourcePath} ${rich(host, "->", "grey")} ${operation.targetPath}`

  const prefix = `${status} ${mode}${extensions} `
  const arrow = ` ${rich(host, "->", "grey")} `
  const pathBudget = Math.max(0, terminalColumns(host) - visibleWidth(prefix) - visibleWidth(arrow))
  if (pathBudget < 20) return `${prefix}${truncateVisible(operation.sourcePath, pathBudget)}`

  const sourceWidth = Math.max(8, Math.floor(pathBudget * 0.48))
  const targetWidth = Math.max(0, pathBudget - sourceWidth)
  return `${prefix}${truncateVisible(operation.sourcePath, sourceWidth)}${arrow}${truncateVisible(operation.targetPath, targetWidth)}`
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
