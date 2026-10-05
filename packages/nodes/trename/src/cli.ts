#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { isEntryModule,
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  hasPipedInput,
  nodeCliName,
  promptPathLines,
  promptRich,
  readStdinText,
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
import { runGuidedInteraction } from "@xiranite/cli-runtime"
import {
  requireInteractiveMode,
  resolveCliInvocation,
  resolveInteractionPreferences,
  resolveTerminalUiFlags,
  type CliInteractionPreferencesSource,
  type TerminalInteractionDefinition,
} from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { listTerminalThemes, runTerminalUi, writeTerminalNodeHelp, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { TrenameAction, TrenameData, TrenameInput, TrenameOperation, TrenameResult, TrenameRuntime } from "./core.js"
import { createNodeTrenameRuntime, readClipboardText } from "./platform.js"
import { createTrenameInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("trename")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "trename"

interface TrenameNodeConfig extends CliInteractionPreferencesSource {
  enable_undo?: boolean
  undo_path?: string
}

interface TrenameDefaults {
  enableUndo: boolean
  undoPath?: string
  interactionMode?: "ui" | "gd" | "pipe"
  interactionLanguage?: "zh" | "en"
  interactionTheme?: string
}

/**
 * Read trename defaults from xiranite.config.toml [nodes.trename] section.
 * - enable_undo: whether undo/history actions are allowed (default true)
 * - undo_path: default undo store path when --undoPath is not provided
 * Missing config file or section is treated as defaults (enableUndo=true, no override).
 */
async function resolveTrenameDefaults(host: CliHost, json: boolean): Promise<TrenameDefaults> {
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<TrenameNodeConfig>("trename", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      enableUndo: nodeConfig?.enable_undo !== false,
      undoPath: nodeConfig?.undo_path?.trim() || undefined,
      interactionMode: resolveInteractionPreferences(nodeConfig).mode,
      interactionLanguage: resolveInteractionPreferences(nodeConfig).language,
      interactionTheme: resolveInteractionPreferences(nodeConfig).theme,
    }
  } catch {
    return { enableUndo: true }
  }
}

interface TrenameCliOptions {
  path?: string
  paths?: string
  input?: string
  inputFile?: string
  output?: string
  base?: string
  basePath?: string
  includeHidden?: boolean
  hidden?: boolean
  includeRoot?: boolean
  noRoot?: boolean
  exclude?: string
  excludeExts?: string
  excludePattern?: string
  excludePatterns?: string
  split?: string | number
  maxLines?: string | number
  compact?: boolean
  mode?: "normal" | "leak"
  dryRun?: boolean
  execute?: boolean
  batchId?: string
  undoPath?: string
  jsonContent?: string
  json?: boolean
}

interface GuidedTask {
  name: string
  description: string
  action: TrenameAction
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "paths"; paths: string[]; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "scan",
    description: "扫描目录生成 rename JSON，默认读取剪贴板路径",
    action: "scan",
  },
  {
    name: "rename",
    description: "从剪贴板读取 JSON 并执行批量重命名（先预览再确认）",
    action: "rename",
  },
  {
    name: "undo",
    description: "撤销最近一次重命名操作",
    action: "undo",
  },
  {
    name: "history",
    description: "查看重命名操作历史",
    action: "history",
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Batch rename JSON workflow for scan, validate, rename, and undo.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  // The attach flags belong to the face, not to the node: they leave argv before this program's own
  // dispatch reads it and are folded into the host env, so they can never reach a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)
  const remaining = attach.remaining

  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this invocation,
  // so it stops with it. An attached host is left exactly where it was (`stop()` is a no-op on it).
  try {
    if (remaining[0] === "help" || remaining.includes("--help") || remaining.includes("-h")) {
      writeTerminalNodeHelp(attachedHost, help, "zh")
      return
    }
    const defaults = await resolveTrenameDefaults(attachedHost, false)
    const explicit = resolveCliInvocation(remaining, attachedHost, "ui")
    const invocation = remaining.length === 0 ? resolveCliInvocation(remaining, attachedHost, defaults.interactionMode ?? "ui") : explicit
    if (remaining.length === 0 || explicit === "ui" || explicit === "gd") {
      const ttyError = requireInteractiveMode(attachedHost, invocation === "gd" ? "gd" : "ui")
      if (ttyError) { writeError(attachedHost, ttyError); process.exitCode = 2; return }
      const flags = resolveTerminalUiFlags(remaining.slice(remaining.length ? 1 : 0), {
        language: defaults.interactionLanguage ?? "zh",
        renderer: "opentui",
        theme: defaults.interactionTheme,
      })
      if (flags.error || flags.args.length || !flags.language || !flags.renderer) { writeError(attachedHost, flags.error ?? `Unknown ${invocation} argument: ${flags.args[0]}.`); process.exitCode = 2; return }
      if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) { writeError(attachedHost, `Unknown terminal theme: ${flags.theme}.`); process.exitCode = 2; return }
      // Both terminal forms are the product, but opening one without a host would let the operator fill in
      // the whole workbench — paste a JSON, review the diffs — before the first dead end.
      if (!await hostReady(attachedHost)) return
      const definition = createTrenameHostDefinition(attachedHost, defaults, flags.language)
      if (invocation === "gd") { await runGuidedInteraction(definition, { host: attachedHost, language: flags.language, help }); return }
      const values: TerminalPreferenceValues = { theme: flags.theme ?? "inherit", defaultMode: defaults.interactionMode ?? "ui", language: flags.language }
      await runTerminalUi(definition, { host: attachedHost, renderer: "opentui", language: flags.language, theme: flags.theme, preferences: createTrenamePreferences(attachedHost, values), help, loadScreen: async () => (await import("./Tui.js")).TrenameTui, reexec: process.argv[1] ? { entrypoint: process.argv[1], args: remaining } : undefined })
      return
    }
    await runMain(createProgram(attachedHost), { rawArgs: remaining })
  } finally {
    await stopSharedHost()
  }
}

/**
 * Folds `--backend`/`--token`/`--channel-file` into the host env, which is where
 * `@xiranite/cli-runtime/backend` reads them as its second and third resolution steps; a flag
 * therefore outranks a real environment value.
 */
function withAttachFlags(host: CliHost, flags: Partial<Record<HostAttachFlag, string>>): CliHost {
  const env = { ...host.env }
  if (flags.backend) env.XIRANITE_BACKEND_URL = flags.backend
  if (flags.token) env.XIRANITE_BACKEND_TOKEN = flags.token
  if (flags.channelFile) env.XIRANITE_CHANNEL_FILE = flags.channelFile
  return { ...host, env }
}

/**
 * The host for this face process, resolved once (ADR-0074 §6): attach to a host that is already running,
 * or start one as our own child when the operator configured nothing. The memo itself lives in
 * `@xiranite/cli-runtime`, because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is written to this face's error line (it already names every way to
 * attach and says when no host binary was found), so interactive callers only have to stop before drawing
 * anything.
 */
async function hostReady(host: CliHost): Promise<boolean> {
  try {
    await resolveHostHandle(host)
    return true
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return false
  }
}

/** A client bound to the resolved host, or a rejection naming what is missing. */
async function hostOperationsClient(host: CliHost): Promise<OperationsClient> {
  const handle = await resolveHostHandle(host)
  return createOperationsClient({ baseUrl: handle.attachment.baseUrl, token: handle.attachment.token })
}

/**
 * Attaches to the host, runs the operation and returns its result document, or `undefined` when the attach
 * or the transport failed — reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that fallback is
 * the compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to get a host. Failures
 * are caught here instead of thrown because citty's `runMain` answers a thrown error with `process.exit(1)`
 * and drops buffered stdout; setting `process.exitCode` keeps the two codes this CLI uses (1 failure,
 * 2 usage) and leaves `--json` output clean. A run that simply did not work is a `success: false` result.
 */
async function runTrenameOnHost(
  host: CliHost,
  input: TrenameInput,
  onEvent?: (event: OperationEvent) => void,
): Promise<TrenameResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<TrenameData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema — fields, defaults,
 * danger semantics and help — while the run and the control calls go to the host. The started record is
 * kept so cancel, pause and resume address the operation this face actually started.
 */
export function createTrenameHostDefinition(
  host: CliHost,
  defaults: TrenameDefaults,
  language: TerminalLanguage,
): TerminalInteractionDefinition<TrenameInput, TrenameResult> {
  const schema = createTrenameInteractionSchema({ undoPath: defaults.undoPath }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<TrenameData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<TrenameData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function createTrenamePreferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return {
    nodeId: "trename",
    current,
    async save(values) {
      await updateNodeConfigFile("trename", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options)
    },
    async restore() {
      const { config } = await loadNodeConfigWithHints<TrenameNodeConfig>("trename", { ...options, jsonMode: true })
      const preferences = resolveInteractionPreferences(config)
      return { theme: preferences.theme, defaultMode: preferences.mode, language: preferences.language ?? "zh" }
    },
  }
}

function createDefaultHost(): CliHost {
  return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "Batch rename JSON workflow with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan folders into rename JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("scan", args as TrenameCliOptions, host)
        },
      }),
      import: defineCommand({
        meta: { name: "import", description: "Import and count rename JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("import", args as TrenameCliOptions, host)
        },
      }),
      validate: defineCommand({
        meta: { name: "validate", description: "Validate rename JSON against the filesystem." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("validate", args as TrenameCliOptions, host)
        },
      }),
      rename: defineCommand({
        meta: { name: "rename", description: "Plan or execute batch rename." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("rename", args as TrenameCliOptions, host)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo a previous executed rename batch." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("undo", args as TrenameCliOptions, host)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "List undo batches." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("history", args as TrenameCliOptions, host)
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
    path: { type: "string", description: "Folder path." },
    paths: { type: "string", description: "One or more paths. Quoted paths are supported." },
    input: { type: "string", description: "JSON input file." },
    inputFile: { type: "string", description: "JSON input file." },
    output: { type: "string", description: "Write scan JSON to this file." },
    base: { type: "string", description: "Base path for validate/rename." },
    basePath: { type: "string", description: "Base path for validate/rename." },
    includeHidden: { type: "boolean", description: "Include hidden files." },
    hidden: { type: "boolean", description: "Alias for --includeHidden." },
    includeRoot: { type: "boolean", description: "Include scanned folder as root node." },
    noRoot: { type: "boolean", description: "Scan children directly." },
    exclude: { type: "string", description: "Comma-separated excluded extensions." },
    excludeExts: { type: "string", description: "Comma-separated excluded extensions." },
    excludePattern: { type: "string", description: "Comma-separated excluded name patterns." },
    excludePatterns: { type: "string", description: "Comma-separated excluded name patterns." },
    split: { type: "string", description: "Max JSON lines per segment." },
    maxLines: { type: "string", description: "Max JSON lines per segment." },
    compact: { type: "boolean", description: "Use compact JSON output." },
    mode: { type: "string", description: "Scan mode: normal or leak." },
    dryRun: { type: "boolean", description: "Preview file operations." },
    execute: { type: "boolean", description: "Execute rename instead of dry-run." },
    batchId: { type: "string", description: "Undo batch id." },
    undoPath: { type: "string", description: "Undo JSON store path." },
    jsonContent: { type: "string", description: "Inline rename JSON content." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function runSingleAction(action: TrenameAction, args: TrenameCliOptions, host: CliHost): Promise<boolean> {
  const defaults = await resolveTrenameDefaults(host, Boolean(args.json))

  if (!defaults.enableUndo && (action === "undo" || action === "history")) {
    writeLine(host, rich(host, "Undo 功能已被配置禁用（[nodes.trename] enable_undo = false）。", "yellow"))
    process.exitCode = 1
    return false
  }

  const input = await inputFromArgs(action, args, defaults, host)
  const result = await runAction(input, Boolean(args.json), host)
  if (!result) return false
  // The scan output file is the operator's own request, so the face still writes it; the segments are the
  // host's answer and this process never re-derives them.
  if (args.output && action === "scan" && result.success) await writeSegments(args.output, result.data?.segments ?? [])
  return result.success
}

/** `undefined` when the host could not be reached at all; the reason is already on the error line. */
async function runAction(input: TrenameInput, json: boolean, host: CliHost): Promise<TrenameResult | undefined> {
  let progressActive = false
  const result = await runTrenameOnHost(host, input, json ? undefined : (event) => {
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
  if (!result) return undefined

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return result
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeTrenameSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result
}

async function inputFromArgs(action: TrenameAction, args: TrenameCliOptions, defaults: TrenameDefaults, host: CliHost): Promise<TrenameInput> {
  const inputFile = args.inputFile || args.input
  let jsonContent = args.jsonContent
  if (jsonContent === undefined) {
    if (inputFile === "-" || (!inputFile && (action === "import" || action === "validate" || action === "rename") && hasPipedInput(host.stdin))) {
      jsonContent = await readStdinText(host.stdin)
    } else if (inputFile) {
      jsonContent = await readFile(inputFile, "utf8")
    } else {
      jsonContent = ""
    }
  }
  return {
    action,
    paths: args.paths || args.path,
    includeHidden: args.includeHidden ?? args.hidden,
    includeRoot: args.noRoot ? false : args.includeRoot,
    excludeExts: args.excludeExts || args.exclude,
    excludePatterns: args.excludePatterns || args.excludePattern,
    maxLines: numberArg(args.maxLines ?? args.split),
    compact: args.compact,
    mode: args.mode === "leak" ? "leak" : "normal",
    jsonContent,
    basePath: args.basePath || args.base,
    dryRun: args.execute ? false : args.dryRun ?? true,
    batchId: args.batchId,
    undoPath: args.undoPath ?? defaults.undoPath,
  }
}

async function writeSegments(output: string, segments: string[]): Promise<void> {
  if (segments.length <= 1) {
    await writeFile(output, `${segments[0] ?? ""}\n`, "utf8")
    return
  }
  const dot = output.lastIndexOf(".")
  const base = dot >= 0 ? output.slice(0, dot) : output
  const ext = dot >= 0 ? output.slice(dot) : ".json"
  await Promise.all(segments.map((segment, index) => writeFile(`${base}_${index + 1}${ext}`, `${segment}\n`, "utf8")))
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} scan --path <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }
  // Resolved before the first prompt, so an operator never answers a workflow to meet a dead host.
  if (!await hostReady(host)) return

  const runtime = createNodeTrenameRuntime()
  const defaults = await resolveTrenameDefaults(host, false)
  const defaultTask = GUIDED_TASKS[0]!
  let firstRender = true
  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const choice = await readGuidedChoice(host, defaultTask, runtime)
      if (choice.kind === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const needsPaths = choice.task.action === "scan"
      const paths = choice.kind === "paths"
        ? choice.paths
        : needsPaths ? await resolvePaths(host, runtime) : []

      if (needsPaths && !paths.length) {
        writeRichPanel(host, "Path", "未提供有效文件夹路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        paths.length ? `path: ${paths.join("; ")}` : "",
        "mode: host operation over /operations, no Taskfile shell hop",
      ].filter(Boolean), { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

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

function renderGuidedIntro(host: CliHost, includeHeader: boolean): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  writeRichPanel(host, "Xiranite Trename", [
    `${rich(host, "入口", "cyan")}  文件批量重命名工具，提供扫描、重命名、撤销和历史功能`,
    `${rich(host, "执行", "cyan")}  经宿主 /operations 执行 trename core，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；扫描默认包含根节点`,
    `${rich(host, "JSON", "cyan")}  重命名从剪贴板读取 JSON；先预览再确认执行`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认保持原 trename 习惯，扫描结果复制到剪贴板；需要预演请用 \`${CLI_NAME} rename --dry-run\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask, runtime: TrenameRuntime): Promise<ResolvedGuidedChoice> {
  const first = cleanPath(await promptRich(host, "粘贴文件夹路径直接执行扫描（可逐行输入多个）；留空进入任务选择", ""))
  if (first) {
    const inputs: string[] = [first]
    writeLine(host, rich(host, "继续输入路径，逐行回车；直接回车空行结束。", "grey"))
    while (true) {
      const suffix = ` (已收集 ${inputs.length} 条，留空结束)`
      const answer = cleanPath(await promptRich(host, `输入下一个路径${suffix}`, ""))
      if (!answer) break
      if (!inputs.includes(answer)) inputs.push(answer)
    }
    const verified = await validDirectoryPaths(inputs, runtime)
    if (verified.length) return { kind: "paths", paths: verified, task: defaultTask }
    writeRichPanel(host, "Path", "输入的路径均无效，进入任务选择。", { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 trename 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入路径并执行扫描" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 8 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") return { kind: "task", task: defaultTask }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolvePaths(host: CliHost, runtime: TrenameRuntime): Promise<string[]> {
  const clipboardPaths = await pathsFromClipboard(runtime)
  if (clipboardPaths.length) {
    writeLine(host, rich(host, `已从剪贴板读取 ${clipboardPaths.length} 个路径。`, "yellow"))
    for (const path of clipboardPaths) writeLine(host, rich(host, `  ${path}`, "green"))
    return clipboardPaths
  }

  const inputs = await promptPathLines(host, "输入要扫描的文件夹路径")
  return await validDirectoryPaths(inputs, runtime)
}

async function runGuidedTask(task: GuidedTask, paths: string[], host: CliHost, defaults: TrenameDefaults): Promise<boolean> {
  if (task.action === "scan") {
    return (await runAction({ action: "scan", paths }, false, host))?.success ?? false
  }
  if (task.action === "rename") {
    return await runGuidedRename(host, defaults)
  }
  if (task.action === "undo" || task.action === "history") {
    if (!defaults.enableUndo) {
      writeLine(host, rich(host, "Undo 功能已被配置禁用（[nodes.trename] enable_undo = false）。", "yellow"))
      return false
    }
    return (await runAction({ action: task.action, undoPath: defaults.undoPath }, false, host))?.success ?? false
  }
  return false
}

async function runGuidedRename(host: CliHost, defaults: TrenameDefaults): Promise<boolean> {
  const jsonContent = await resolveJsonContent(host)
  if (!jsonContent) {
    writeLine(host, rich(host, "未提供有效 JSON 内容。", "yellow"))
    return false
  }

  const basePath = (await promptRich(host, "输入基础路径（留空使用当前目录）", "")).trim() || process.cwd()

  writeLine(host)
  writeRichPanel(host, "Preview", [
    `base: ${basePath}`,
    "mode: dry-run preview",
  ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

  const previewResult = await runAction({ action: "rename", jsonContent, basePath, dryRun: true }, false, host)
  if (!previewResult) return false
  if (!previewResult.success) return false

  // The count the operator confirms against is the host's own plan, not a local re-computation.
  const operationCount = previewResult.data?.successCount ?? 0
  if (operationCount === 0) {
    writeLine(host, rich(host, "没有可重命名的项目。", "yellow"))
    return false
  }

  const confirmed = await confirmRich(host, `确认执行 ${operationCount} 个重命名操作?`, true)
  if (!confirmed) {
    writeLine(host, rich(host, "用户取消了重命名操作。", "yellow"))
    return false
  }

  return (await runAction({ action: "rename", jsonContent, basePath, dryRun: false, undoPath: defaults.undoPath }, false, host))?.success ?? false
}

async function resolveJsonContent(host: CliHost): Promise<string> {
  const clipboard = (await readClipboardText()).trim()
  if (clipboard.startsWith("{")) {
    writeLine(host, rich(host, "已从剪贴板读取 JSON 内容。", "yellow"))
    return clipboard
  }

  const answer = (await promptRich(host, "输入 JSON 文件路径或直接粘贴 JSON 内容", "")).trim()
  if (!answer) return ""
  if (answer.startsWith("{")) return answer
  try {
    return await readFile(answer, "utf8")
  } catch {
    writeLine(host, rich(host, `无法读取文件: ${answer}`, "red"))
    return ""
  }
}

function writeTrenameSummary(host: CliHost, result: TrenameResult): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const summaryLines = [
    `总计: ${rich(host, String(data.totalItems), "green")}  待翻译: ${rich(host, String(data.pendingCount), "yellow")}  可重命名: ${rich(host, String(data.readyCount), "green")}`,
    `成功: ${rich(host, String(data.successCount), "green")}  失败: ${rich(host, String(data.failedCount), "red")}  跳过: ${rich(host, String(data.skippedCount), "yellow")}`,
  ]
  if (data.basePath) summaryLines.push(`基础路径: ${data.basePath}`)
  if (data.operationId) summaryLines.push(`操作 ID: ${rich(host, data.operationId, "cyan")}`)
  writeRichPanel(host, "执行总结", summaryLines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })

  if (data.operations.length) {
    writeLine(host)
    writeLine(host, rich(host, "操作详情：", "cyan"))
    for (const operation of data.operations.slice(0, 30)) writeLine(host, `  ${formatOperation(operation, host)}`)
    if (data.operations.length > 30) writeLine(host, rich(host, `  ... 还有 ${data.operations.length - 30} 个操作`, "grey"))
  }

  if (data.conflicts.length) {
    writeLine(host)
    writeLine(host, rich(host, `冲突详情 (${data.conflicts.length})：`, "yellow"))
    for (const conflict of data.conflicts.slice(0, 30)) writeLine(host, `  ${rich(host, "•", "red")} ${conflict.message}`)
    if (data.conflicts.length > 30) writeLine(host, rich(host, `  ... 还有 ${data.conflicts.length - 30} 个冲突`, "grey"))
  }

  if (data.history.length) {
    writeLine(host)
    writeLine(host, rich(host, "操作历史：", "cyan"))
    for (const batch of data.history.slice(0, 20)) {
      const status = batch.undone ? rich(host, "已撤销", "grey") : rich(host, "活跃", "green")
      writeLine(host, `  ${rich(host, batch.id, "cyan")}  ${status}  ${batch.operations.length} 项  ${batch.timestamp}`)
    }
  }

  if (data.segments.length && data.jsonContent) {
    writeLine(host)
    writeLine(host, rich(host, "JSON 预览：", "cyan"))
    const previewLines = data.jsonContent.split("\n").slice(0, 12)
    for (const line of previewLines) writeLine(host, rich(host, `  ${truncateVisible(line, columns - 4)}`, "grey"))
    if (data.jsonContent.split("\n").length > 12) writeLine(host, rich(host, "  ...", "grey"))
  }
}

function formatOperation(operation: TrenameOperation, host: CliHost): string {
  if (!host.stdout.isTTY) return `${operation.originalPath} -> ${operation.newPath}`
  const columns = terminalColumns(host)
  const arrow = rich(host, "->", "grey")
  const budget = Math.max(0, columns - 6)
  const sourceWidth = Math.max(8, Math.floor(budget * 0.48))
  const targetWidth = Math.max(0, budget - sourceWidth)
  return `${truncateVisible(operation.originalPath, sourceWidth)} ${arrow} ${truncateVisible(operation.newPath, targetWidth)}`
}

async function pathsFromClipboard(runtime: TrenameRuntime): Promise<string[]> {
  const text = await readClipboardText()
  if (!text) return []
  return await validDirectoryPaths(splitPaths(text), runtime)
}

async function validDirectoryPaths(candidates: string[], runtime: TrenameRuntime): Promise<string[]> {
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

function numberArg(value?: string | number): number | undefined {
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

if (isEntryModule(import.meta.url)) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
