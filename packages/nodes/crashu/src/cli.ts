#!/usr/bin/env node
import { lstat } from "node:fs/promises"
import { resolve } from "node:path"
import { isEntryModule,
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  hasPipedInput as runtimeHasPipedInput,
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
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { CrashuAction, CrashuConflictPolicy, CrashuData, CrashuInput, CrashuMoveDirection, CrashuResult } from "./core.js"
import { readClipboardText } from "./platform.js"
import { createCrashuInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("crashu")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "crashu"
const DEFAULT_TARGET_PATH = "E:\\1Hub\\EH\\1EHV"
const DEFAULT_DESTINATION_PATH = "E:\\1Hub\\EH\\2EHV\\crash"
const DEFAULT_THRESHOLD = 0.8
const DEFAULT_PAIRS_FILE = "folder_pairs.json"

function hasPipedInput(stream: NodeJS.ReadableStream): boolean {
  return runtimeHasPipedInput(stream) && Symbol.asyncIterator in Object(stream)
}

interface CrashuCliOptions {
  source?: string
  sourcePaths?: string
  targetPath?: string
  targetNames?: string
  destinationPath?: string
  threshold?: string | number
  similarityThreshold?: string | number
  autoMove?: boolean
  moveDirection?: CrashuMoveDirection
  conflictPolicy?: CrashuConflictPolicy
  pairsFileName?: string
  dryRun?: boolean
  json?: boolean
}

interface CrashuNodeConfig extends CliInteractionPreferencesSource {
  enabled?: boolean
  output?: {
    pairs_file_name?: string
    directory?: string
    overwrite?: boolean
  }
}

interface CrashuOutputDefaults {
  pairsFileName: string
  directory?: string
  overwrite: boolean
}

interface GuidedTask {
  name: string
  description: string
  action: CrashuAction
  autoMove: boolean
  moveDirection?: CrashuMoveDirection
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "path"; path: string; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "scan",
    description: "扫描相似文件夹（只读预览，不移动）",
    action: "scan",
    autoMove: false,
  },
  {
    name: "plan",
    description: "生成移动计划（预演，不写盘）",
    action: "plan",
    autoMove: false,
  },
  {
    name: "move-to-source",
    description: "把相似文件夹从目标侧移到源侧（原版默认 target_to_source）",
    action: "move",
    autoMove: true,
    moveDirection: "to_source",
  },
  {
    name: "move-to-target",
    description: "把相似文件夹从源侧移到 destinationPath（1=源->目标）",
    action: "move",
    autoMove: true,
    moveDirection: "to_target",
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Match similar folder names and optionally move matched folders.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

async function legacyRunProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  if (args.length === 0) {
    await runGuided(host)
    return
  }
  await runMain(createProgram(host), { rawArgs: args })
}

export async function runProgram(args=process.argv.slice(2),host:CliHost=createDefaultHost()):Promise<void>{
  // The attach flags belong to the face, not to the node: they leave argv before the command router sees
  // them and are folded into the host env, so `--backend <url>` can never be read as a path and never
  // reaches a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5 puts the host lifecycle in this invocation: a host this face started stops with it, while a
  // host it attached to is left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({args:attach.remaining,host:attachedHost,cliName:CLI_NAME,loadContext:async()=>{const{config}=await loadNodeConfigWithHints<CrashuNodeConfig>(NODE_ID,{env:attachedHost.env,cwd:attachedHost.cwd,hintSink:{stderr:attachedHost.stderr},jsonMode:true});return{preferences:resolveInteractionPreferences(config),value:config??{}}},createDefinition:(defaults,language)=>createCrashuHostDefinition(attachedHost,defaults,language),runPipe:legacyRunProgram,runGuide:async(definition,options)=>{if(await hostReady(attachedHost))await runGuidedInteraction(definition,options)},runUi:async(definition,options)=>{if(await hostReady(attachedHost))await runTerminalUi(definition,options)},loadScreen:async()=>(await import("./Tui.js")).CrashuTui,createPreferences:(_d,current)=>crashuPreferences(attachedHost,current),reexecEntrypoint:process.argv[1],help})
  } finally {
    await stopSharedHost()
  }
}

/**
 * The `ui`/`gd` definition. The node owns only the shared schema — including `isDangerous` and `dangerPrompt`,
 * which the session consults *before* it calls `run`, so a live move still needs an explicit confirmation —
 * and every byte of work goes to the host, whose root grants come from the node manifest rather than from
 * anything invented here. The started record is kept so cancel, pause and resume address the operation this
 * face actually started.
 */
export function createCrashuHostDefinition(host: CliHost, defaults: CrashuNodeConfig, language: TerminalLanguage): TerminalInteractionDefinition<CrashuInput, CrashuResult> {
  const schema = createCrashuInteractionSchema({ pairsFileName: defaults.output?.pairs_file_name, destinationPath: defaults.output?.directory, conflictPolicy: defaults.output?.overwrite ? "overwrite" : undefined }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<CrashuData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<CrashuData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

/** Folds `--backend`/`--token`/`--channel-file` into the host env, which is where
 * `@xiranite/cli-runtime/backend` reads them as its second and third resolution steps; a flag therefore
 * outranks a real environment value. */
function withAttachFlags(host: CliHost, flags: Partial<Record<HostAttachFlag, string>>): CliHost {
  const env = { ...host.env }
  if (flags.backend) env.XIRANITE_BACKEND_URL = flags.backend
  if (flags.token) env.XIRANITE_BACKEND_TOKEN = flags.token
  if (flags.channelFile) env.XIRANITE_CHANNEL_FILE = flags.channelFile
  return { ...host, env }
}

/** The host for this face process, resolved once: attach to one that is already running, or start our own. */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason goes to this face's error line (it already names every way to attach
 * and says when no host binary was found), so a guided or ui run only has to stop before drawing anything —
 * burning seven prompts and then reporting a dead host spends attention to deliver a late message.
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
 * Attaches to the host, runs the operation and returns its result document, or `undefined` when the attach or
 * the transport failed — reported on this face's error line with exit code 1. A terminal face that cannot
 * reach a host stops rather than running `core.ts` locally: that fallback is the compat path ADR-0074 §5
 * removes, and `HostAttachmentError` names every way to get a host. Failures are caught here instead of
 * thrown because citty's `runMain` answers a thrown error with `process.exit(1)` and drops buffered stdout,
 * which would leave `--json` without a clean document and collapse the 1 (failure) and 2 (usage) codes into
 * one. A run that simply did not work is a result with `success: false`, not a throw.
 */
async function runCrashuOnHost(
  host: CliHost,
  input: CrashuInput & { action: CrashuAction },
  onEvent?: (event: OperationEvent) => void,
): Promise<CrashuResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<CrashuData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

function crashuPreferences(host:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:host.env,cwd:host.cwd};return{nodeId:"crashu",current,async save(v){await updateNodeConfigFile("crashu", {cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}, o)},async restore(){const{config}=await loadNodeConfigWithHints<CrashuNodeConfig>("crashu",{...o,jsonMode:true});const p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

function createDefaultHost(): CliHost {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

/**
 * Resolve crashu default output parameters from xiranite.config.toml [nodes.crashu.output].
 * Falls back to hardcoded defaults when the config file or section is missing.
 */
async function resolveCrashuDefaults(host: CliHost, json: boolean): Promise<CrashuOutputDefaults> {
  const fallback: CrashuOutputDefaults = {
    pairsFileName: DEFAULT_PAIRS_FILE,
    directory: undefined,
    overwrite: false,
  }
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<CrashuNodeConfig>("crashu", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    const output = nodeConfig?.output
    if (!output) return fallback
    return {
      pairsFileName: output.pairs_file_name ?? DEFAULT_PAIRS_FILE,
      directory: output.directory,
      overwrite: output.overwrite ?? false,
    }
  } catch {
    return fallback
  }
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "Folder similarity matcher with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Find similar folders." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveCrashuDefaults(host, Boolean(args.json))
          await runAction({ action: "scan", ...inputFromArgs({ ...args, sourcePaths: (args.sourcePaths === "-" || (!args.sourcePaths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.sourcePaths, source: (args.source === "-" || (!args.source && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.source } as CrashuCliOptions, defaults) }, Boolean(args.json), host)
        },
      }),
      plan: defineCommand({
        meta: { name: "plan", description: "Preview move operations." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveCrashuDefaults(host, Boolean(args.json))
          await runAction({ action: "plan", ...inputFromArgs({ ...args, sourcePaths: (args.sourcePaths === "-" || (!args.sourcePaths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.sourcePaths, source: (args.source === "-" || (!args.source && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.source } as CrashuCliOptions, defaults) }, Boolean(args.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move matched folders." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveCrashuDefaults(host, Boolean(args.json))
          await runAction({ action: "move", ...inputFromArgs({ ...args, sourcePaths: (args.sourcePaths === "-" || (!args.sourcePaths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.sourcePaths, source: (args.source === "-" || (!args.source && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.source } as CrashuCliOptions, defaults), autoMove: true }, Boolean(args.json), host)
        },
      }),
      execute: defineCommand({
        meta: { name: "execute", description: "Alias for move." },
        args: commonArgs(),
        async run({ args }) {
          const defaults = await resolveCrashuDefaults(host, Boolean(args.json))
          await runAction({ action: "execute", ...inputFromArgs({ ...args, sourcePaths: (args.sourcePaths === "-" || (!args.sourcePaths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.sourcePaths, source: (args.source === "-" || (!args.source && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin))[0] : args.source } as CrashuCliOptions, defaults), autoMove: true }, Boolean(args.json), host)
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
    source: { type: "string", description: "Source directory. Repeat with --sourcePaths for more." },
    sourcePaths: { type: "string", description: "Comma, semicolon, or newline separated source directories." },
    targetPath: { type: "string", description: "Directory whose child folder names are targets." },
    targetNames: { type: "string", description: "Comma, semicolon, or newline separated target names." },
    destinationPath: { type: "string", description: "Move destination root." },
    threshold: { type: "string", description: "Similarity threshold from 0 to 1." },
    similarityThreshold: { type: "string", description: "Similarity threshold from 0 to 1." },
    autoMove: { type: "boolean", description: "Allow move actions." },
    moveDirection: { type: "string", description: "to_target or to_source." },
    conflictPolicy: { type: "string", description: "skip, overwrite, or rename." },
    pairsFileName: { type: "string", description: "Pairs JSON file name." },
    dryRun: { type: "boolean", description: "Preview without moving." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: CrashuCliOptions, defaults: CrashuOutputDefaults): CrashuInput {
  return {
    sourcePaths: splitArg(args.sourcePaths, args.source ? [args.source] : []),
    targetPath: args.targetPath,
    targetNames: splitArg(args.targetNames),
    destinationPath: args.destinationPath ?? defaults.directory,
    similarityThreshold: numberArg(args.similarityThreshold ?? args.threshold),
    autoMove: args.autoMove,
    moveDirection: isDirection(args.moveDirection) ? args.moveDirection : undefined,
    conflictPolicy: resolveConflictPolicy(args.conflictPolicy, defaults.overwrite),
    pairsFileName: args.pairsFileName ?? defaults.pairsFileName,
    dryRun: args.dryRun,
  }
}

async function runAction(input: CrashuInput & { action: CrashuAction }, json: boolean, host: CliHost): Promise<boolean> {
  let progressActive = false
  const result = await runCrashuOnHost(host, input, json ? undefined : (event) => {
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
  // No host answer at all: the reason is already on the error line and `process.exitCode` is 1.
  if (!result) return false

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return result.success
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeCrashuSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result.success
}

function writeCrashuSummary(host: CliHost, result: { success: boolean; message: string; data?: CrashuDataLike }): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const summaryLines = [
    `matched: ${rich(host, String(data.similarFound), "yellow")}  moved: ${rich(host, String(data.movedCount), "green")}  skipped: ${rich(host, String(data.skippedCount), "grey")}  errors: ${rich(host, String(data.errorCount), data.errorCount ? "red" : "grey")}`,
    data.pairsFile ? `pairsFile: ${data.pairsFile}` : "",
  ].filter(Boolean)
  writeRichPanel(host, "Summary", summaryLines, { color: result.success ? "green" : "yellow", minWidth: Math.min(76, columns - 6) })

  if (data.similarFolders.length) {
    writeLine(host)
    writeLine(host, rich(host, "相似文件夹：", "cyan"))
    for (const item of data.similarFolders.slice(0, 40)) {
      const percent = rich(host, `${Math.round(item.similarity * 100)}%`, "yellow")
      const arrow = rich(host, "->", "grey")
      writeLine(host, `  ${percent}  ${truncateVisible(item.path, Math.max(20, columns - 32))}  ${arrow}  ${item.target}`)
    }
    if (data.similarFolders.length > 40) writeLine(host, rich(host, `  ... 还有 ${data.similarFolders.length - 40} 个匹配`, "grey"))
  }

  if (data.plan.length) {
    writeLine(host)
    writeLine(host, rich(host, "移动计划：", "cyan"))
    for (const item of data.plan.slice(0, 40)) {
      const status = item.status === "success"
        ? rich(host, "success", "green")
        : item.status === "error"
          ? rich(host, "error", "red")
          : item.status === "skipped"
            ? rich(host, "skipped", "yellow")
            : rich(host, "planned", "cyan")
      const tail = item.destinationPath
        ? `  ${rich(host, "->", "grey")}  ${truncateVisible(item.destinationPath, Math.max(20, columns - 40))}`
        : `  ${rich(host, "/", "grey")}  ${item.reason}`
      writeLine(host, `  ${status}  ${truncateVisible(item.sourcePath, Math.max(20, columns - 40))}${tail}`)
    }
    if (data.plan.length > 40) writeLine(host, rich(host, `  ... 还有 ${data.plan.length - 40} 条计划`, "grey"))
  }

  if (data.errors.length) {
    writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: Math.min(76, columns - 6) })
  }
}

interface CrashuDataLike {
  similarFound: number
  movedCount: number
  skippedCount: number
  errorCount: number
  pairsFile: string
  similarFolders: Array<{ name: string; path: string; target: string; similarity: number }>
  plan: Array<{ sourcePath: string; destinationPath: string; status: string; reason: string }>
  errors: string[]
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} scan --source <folder> --targetPath <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }
  // Asking for paths the host would never see is worse than saying "no host" first.
  if (!await hostReady(host)) return

  const defaultTask = GUIDED_TASKS[0]!
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

      const paths = choice.kind === "path" ? [choice.path] : await resolveGuidedPaths(host)
      if (!paths.length) {
        writeRichPanel(host, "Path", "未提供有效文件夹路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      const task = choice.task
      writeRichPanel(host, "Run", [
        `task: ${task.name}`,
        `path: ${paths.join("; ")}`,
        "mode: host operation over /operations, no Taskfile shell hop",
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const ok = await runGuidedTask(task, paths, host)
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
  writeRichPanel(host, "Xiranite Crashu", [
    `${rich(host, "工具", "cyan")}  文件夹相似度检测与批量移动`,
    `${rich(host, "入口", "cyan")}  内置 TypeScript guided flow`,
    `${rich(host, "执行", "cyan")}  经 /operations 打宿主内的节点 bundle，不经过 lata 或 Taskfile`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；移动前需确认`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认目标目录 ${DEFAULT_TARGET_PATH}；移动任务会单独询问 destinationPath、阈值并要求确认。`, "grey"))
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask): Promise<ResolvedGuidedChoice> {
  const directPath = cleanPath(await promptRich(host, "粘贴 auto_dir 路径直接执行默认 scan 任务；留空进入任务选择", ""))
  if (directPath) {
    const verified = await verifyDirectory(directPath)
    if (verified) return { kind: "path", path: verified, task: defaultTask }
    writeRichPanel(host, "Path", `不是有效文件夹: ${directPath}`, { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 crashu 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入路径，并使用默认 scan 任务" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 8 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") {
    const answer = await promptRich(host, "输入 auto_dir 文件夹路径", DEFAULT_TARGET_PATH)
    const [path] = await validDirectoryPaths(splitPaths(answer))
    if (path) return { kind: "path", path, task: defaultTask }
    writeRichPanel(host, "Path", "未提供有效文件夹路径。", { color: "yellow", minWidth: 48 })
    return { kind: "task", task: defaultTask }
  }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolveGuidedPaths(host: CliHost): Promise<string[]> {
  const clipboardText = await readClipboardText()
  if (clipboardText) {
    const clipboardPaths = await validDirectoryPaths(splitPaths(clipboardText))
    if (clipboardPaths.length) {
      writeLine(host, rich(host, `已从剪贴板读取 ${clipboardPaths.length} 个路径。`, "yellow"))
      return clipboardPaths
    }
  }

  const answer = await promptRich(host, "输入 auto_dir 文件夹路径", DEFAULT_TARGET_PATH)
  return await validDirectoryPaths(splitPaths(answer))
}

async function runGuidedTask(task: GuidedTask, paths: string[], host: CliHost): Promise<boolean> {
  const defaults = await resolveCrashuDefaults(host, false)
  const targetPath = paths[0]!
  const sourcePaths = paths
  let destinationPath: string | undefined
  let threshold = DEFAULT_THRESHOLD

  if (task.autoMove) {
    destinationPath = (await promptRich(host, "destinationPath（移动目标根目录）", defaults.directory ?? DEFAULT_DESTINATION_PATH)).trim() || undefined
    const thresholdInput = await promptRich(host, "相似度阈值 (0-1)", String(DEFAULT_THRESHOLD))
    const parsed = Number(thresholdInput)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) threshold = parsed

    const confirmed = await confirmRich(host, "确认执行移动?（默认否，安全门）", false)
    if (!confirmed) {
      writeLine(host, rich(host, "已取消移动，未写盘。", "yellow"))
      return true
    }
  }

  const input: CrashuInput & { action: CrashuAction } = {
    action: task.action,
    sourcePaths,
    targetPath,
    destinationPath,
    similarityThreshold: threshold,
    autoMove: task.autoMove,
    moveDirection: task.moveDirection,
    conflictPolicy: defaults.overwrite ? "overwrite" : "skip",
    pairsFileName: defaults.pairsFileName,
  }
  return await runAction(input, false, host)
}

/**
 * Prompt-time path checks are this face's own business — the host's core re-checks every root with its own
 * `pathInfo` before it plans or moves anything. The resolved absolute path is what travels, because the host
 * resolves relative input against its own working directory and not against the terminal's.
 */
async function verifyDirectory(candidate: string): Promise<string | null> {
  const cleaned = cleanPath(candidate)
  if (!cleaned) return null
  const absolute = resolve(cleaned)
  try {
    const info = await lstat(absolute)
    if (info.isDirectory()) return absolute
  } catch {
    return null
  }
  return null
}

async function validDirectoryPaths(candidates: string[]): Promise<string[]> {
  const paths: string[] = []
  for (const candidate of candidates) {
    const verified = await verifyDirectory(candidate)
    if (verified) paths.push(verified)
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

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

function numberArg(value?: string | number): number | undefined {
  if (typeof value === "number") return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isDirection(value?: string): value is CrashuMoveDirection {
  return value === "to_target" || value === "to_source"
}

function isConflict(value?: string): value is CrashuConflictPolicy {
  return value === "skip" || value === "overwrite" || value === "rename"
}

function resolveConflictPolicy(value: string | undefined, overwriteDefault: boolean): CrashuConflictPolicy | undefined {
  if (isConflict(value)) return value
  if (value === undefined && overwriteDefault) return "overwrite"
  return undefined
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
