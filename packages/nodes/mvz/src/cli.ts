#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
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
import {
  resolveInteractionPreferences,
  type CliInteractionPreferencesSource,
  type TerminalInteractionDefinition,
} from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { MvzAction, MvzData, MvzInput, MvzResult } from "./core.js"
import { readClipboardText } from "./platform.js"
import { createMvzInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("mvz")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "mvz"
const hasPipedInput = (stream: NodeJS.ReadableStream) => runtimeHasPipedInput(stream) && Symbol.asyncIterator in Object(stream)
const PREVIEW_LIMIT = 50

interface MvzNodeConfig extends CliInteractionPreferencesSource {
  output?: string
  near?: boolean
  auto_dir?: boolean
  flatten?: boolean
  separator?: string
  dry_run?: boolean
}

interface MvzDefaults {
  output?: string
  near?: boolean
  autoDir?: boolean
  flatten?: boolean
  separator?: string
  dryRun?: boolean
}

async function resolveMvzDefaults(host: CliHost, json = false): Promise<MvzDefaults> {
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<MvzNodeConfig>("mvz", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      output: nodeConfig?.output?.trim() || undefined,
      near: nodeConfig?.near,
      autoDir: nodeConfig?.auto_dir,
      flatten: nodeConfig?.flatten,
      separator: nodeConfig?.separator?.trim() || undefined,
      dryRun: nodeConfig?.dry_run,
    }
  } catch {
    return {}
  }
}

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
  // The attach flags belong to the face, not to the node: they leave argv before the command router sees
  // them and are folded into the host env, so one object carries the attach for the whole invocation and
  // the flags can never reach a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this invocation, so
  // it stops with it. An attached host is left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({
      args: attach.remaining,
      host: attachedHost,
      cliName: CLI_NAME,
      loadContext: async () => {
        const { config } = await loadNodeConfigWithHints<MvzNodeConfig>(NODE_ID, {
          env: attachedHost.env,
          cwd: attachedHost.cwd,
          hintSink: { stderr: attachedHost.stderr },
          jsonMode: true,
        })
        return { preferences: resolveInteractionPreferences(config), value: config ?? {} }
      },
      createDefinition: (defaults, language) => createMvzHostDefinition(attachedHost, defaults, language),
      runPipe: (pipeArgs, pipeHost) => pipeArgs.length
        ? runMain(createProgram(pipeHost), { rawArgs: pipeArgs })
        : runGuided(pipeHost),
      // The workbench asks the operator to paste a whole entry list before anything runs, so the host is
      // resolved before the first frame is drawn.
      runGuide: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runGuidedInteraction(definition, options)
      },
      runUi: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runTerminalUi(definition, options)
      },
      loadScreen: async () => (await import("./Tui.js")).MvzTui,
      createPreferences: (_defaults, current) => prefs(attachedHost, current),
      reexecEntrypoint: process.argv[1],
      help,
    })
  } finally {
    await stopSharedHost()
  }
}

/**
 * Folds `--backend`/`--token`/`--channel-file` into the host env, which is where
 * `@xiranite/cli-runtime/backend` reads them as its second and third resolution steps; a flag therefore
 * outranks a real environment value.
 */
function withAttachFlags(host: CliHost, flags: Partial<Record<HostAttachFlag, string>>): CliHost {
  const env = { ...host.env }
  if (flags.backend) env.XIRANITE_BACKEND_URL = flags.backend
  if (flags.token) env.XIRANITE_BACKEND_TOKEN = flags.token
  if (flags.channelFile) env.XIRANITE_CHANNEL_FILE = flags.channelFile
  return { ...host, env }
}

/**
 * The host for this face process, resolved once (ADR-0074 §6): attach to a host that is already running, or
 * start one as our own child when the operator configured nothing. The memo itself lives in
 * `@xiranite/cli-runtime`, because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is written to this face's error line (it already names every way to
 * attach and says when no host binary was found), so the interactive forms only have to stop before drawing
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
 * Attaches to the host, runs the operation and returns its result document, or `undefined` when the attach or
 * the transport failed — reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that fallback is the
 * compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to get a host. Failures are
 * caught here instead of thrown because citty's `runMain` answers a thrown error with `process.exit(1)` and
 * drops buffered stdout; setting `process.exitCode` keeps the two codes this CLI uses (1 failure, 2 usage)
 * and leaves `--json` output clean. A run that simply did not work is a result with `success: false`.
 */
async function runMvzOnHost(
  host: CliHost,
  input: MvzInput & { action: MvzAction },
  onEvent?: (event: OperationEvent) => void,
): Promise<MvzResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<MvzData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema — fields, defaults,
 * danger semantics and help — while the run and the control calls go to the host. The started record is kept
 * so cancel, pause and resume address the operation this face actually started.
 */
export function createMvzHostDefinition(
  host: CliHost,
  defaults: MvzNodeConfig,
  language: TerminalLanguage,
): TerminalInteractionDefinition<MvzInput, MvzResult> {
  const schema = createMvzInteractionSchema({
    output: defaults.output,
    near: defaults.near,
    autoDir: defaults.auto_dir,
    flatten: defaults.flatten,
    separator: defaults.separator,
    dryRun: defaults.dry_run,
  }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<MvzData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<MvzData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}
function prefs(h:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:h.env,cwd:h.cwd};return{nodeId:"mvz",current,async save(v){await updateNodeConfigFile("mvz", {cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}, o)},async restore(){const{config}=await loadNodeConfigWithHints<MvzNodeConfig>("mvz",{...o,jsonMode:true}),p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

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
          const json = Boolean(args.json)
          const defaults = await resolveMvzDefaults(host, json)
          await runAction("extract", await inputFromArgs(args as MvzCliOptions, defaults, host), json, host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Extract matching files, then delete them from archives." },
        args: commonArgs(),
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveMvzDefaults(host, json)
          await runAction("move", await inputFromArgs(args as MvzCliOptions, defaults, host), json, host)
        },
      }),
      delete: defineCommand({
        meta: { name: "delete", description: "Delete matching archive-internal files." },
        args: commonArgs(),
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveMvzDefaults(host, json)
          await runAction("delete", await inputFromArgs(args as MvzCliOptions, defaults, host), json, host)
        },
      }),
      rename: defineCommand({
        meta: { name: "rename", description: "Rename matching archive-internal files with a regex replacement." },
        args: commonArgs(),
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveMvzDefaults(host, json)
          await runAction("rename", await inputFromArgs(args as MvzCliOptions, defaults, host), json, host)
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

async function inputFromArgs(args: MvzCliOptions, defaults: MvzDefaults = {}, host: CliHost): Promise<MvzInput> {
  const fileText = args.file ? await readFile(args.file, "utf8") : undefined
  let files: string[]
  if (args.entry === "-" || args.entries === "-" || ((!args.entry && !args.entries) && hasPipedInput(host.stdin))) {
    files = await readStdinLines(host.stdin)
  } else {
    files = splitArg(args.entries, args.entry ? [args.entry] : [])
  }
  return {
    fileText,
    files,
    output: args.output ?? defaults.output,
    pattern: args.pattern,
    replacement: args.replacement,
    separator: args.separator ?? defaults.separator,
    near: args.near ?? defaults.near,
    autoDir: args.autoDir ?? defaults.autoDir,
    flatten: args.flatten ?? defaults.flatten,
    dryRun: args.dryRun ?? defaults.dryRun,
  }
}

async function runAction(action: MvzAction, input: MvzInput, json: boolean, host: CliHost): Promise<boolean> {
  let progressActive = false
  const result = await runMvzOnHost(host, { ...input, action }, (event) => {
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
  // `false` means the host was unreachable at all — a different thing from a run that did not work, which is
  // a `success: false` result and still prints.
  if (!result) return false

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return true
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeMvzSummary(host, result)
  if (!result.success) process.exitCode = 1
  return true
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
  if (!await hostReady(host)) return

  let firstRender = true

  const defaults = await resolveMvzDefaults(host, false)

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

      // A host that cannot be reached will not come back mid-session, so the loop ends rather than asking
      // for another entry list.
      if (!await runGuidedAction(action, entries, options, host, defaults)) return

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
  const columns = terminalColumns(host)
  const lines = [
    `${rich(host, "动作", "cyan")}  ${action}`,
    // Splitting `archive//internal/path` into groups is core's job, so the pre-run panel only counts what the
    // operator typed; the per-archive grouping arrives in the host's own preview.
    `${rich(host, "条目", "cyan")}  ${entries.length} 条（压缩包分组见执行结果预览）`,
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

async function runGuidedAction(action: MvzAction, entries: string[], options: MvzGuidedOptions, host: CliHost, defaults: MvzDefaults = {}): Promise<boolean> {
  const input: MvzInput = {
    action,
    files: entries,
    output: options.output,
    near: options.near,
    autoDir: options.autoDir,
    flatten: options.flatten,
    pattern: options.pattern,
    replacement: options.replacement,
    separator: defaults.separator,
    dryRun: options.dryRun,
  }
  return await runAction(action, input, false, host)
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

if (isEntryModule(import.meta.url)) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
