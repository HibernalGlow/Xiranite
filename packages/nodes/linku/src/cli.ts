#!/usr/bin/env node
import { lstat } from "node:fs/promises"
import { resolve as resolveAbsolutePath } from "node:path"
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
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { LinkuAction, LinkuData, LinkuInput, LinkuPathKind, LinkuResult } from "./core.js"
import { readClipboardText } from "./platform.js"
import { createLinkuInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("linku")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "linku"
const hasPipedInput = (stream: NodeJS.ReadableStream) => runtimeHasPipedInput(stream) && Symbol.asyncIterator in Object(stream)

interface LinkuCliOptions {
  path?: string
  target?: string
  configPath?: string
  includeInvalid?: boolean
  json?: boolean
}

interface LinkuNodeConfig extends CliInteractionPreferencesSource {
  default_path?: string
  default_target?: string
}

interface LinkuDefaults {
  defaultPath?: string
  defaultTarget?: string
}

/**
 * Resolve linku defaults from xiranite.config.toml [nodes.linku].
 */
async function resolveLinkuDefaults(host: CliHost, json = false): Promise<LinkuDefaults> {
  try {
    const { config } = await loadNodeConfigWithHints<LinkuNodeConfig>("linku", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      defaultPath: config?.default_path,
      defaultTarget: config?.default_target,
    }
  } catch {
    return {}
  }
}

interface GuidedTask {
  name: string
  description: string
  action: LinkuAction
  needsPath: boolean
  needsTarget: boolean
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "info",
    description: "查看文件/目录/符号链接的路径信息",
    action: "info",
    needsPath: true,
    needsTarget: false,
  },
  {
    name: "create",
    description: "创建直接软链接，不移动源文件",
    action: "create",
    needsPath: true,
    needsTarget: true,
  },
  {
    name: "move-link",
    description: "移动源到目标位置，并在原位置创建软链接",
    action: "move_link",
    needsPath: true,
    needsTarget: true,
  },
  {
    name: "list",
    description: "列出 xiranite.config.toml 中已记录的所有链接",
    action: "list",
    needsPath: false,
    needsTarget: false,
  },
  {
    name: "recover",
    description: "检查并恢复/修复已记录的链接",
    action: "recover",
    needsPath: false,
    needsTarget: false,
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Create, move, list, and recover symlink records.",
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
        const { config } = await loadNodeConfigWithHints<LinkuNodeConfig>("linku", {
          env: attachedHost.env,
          cwd: attachedHost.cwd,
          hintSink: { stderr: attachedHost.stderr },
          jsonMode: true,
        })
        return { preferences: resolveInteractionPreferences(config), value: config ?? {} }
      },
      createDefinition: (defaults, language) => createLinkuHostDefinition(attachedHost, defaults, language),
      runPipe: legacyRunProgram,
      // Refuse before the first prompt rather than after the last one: a guide that walks the operator
      // through path, target and confirmation and only then reports a dead host spends attention late.
      runGuide: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runGuidedInteraction(definition, options)
      },
      loadScreen: async () => (await import("./Tui.js")).LinkuTui,
      runUi: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runTerminalUi(definition, options)
      },
      createPreferences: (_defaults, values) => prefs(attachedHost, values),
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
 * start one as our own child when the operator configured nothing. The memo lives in `@xiranite/cli-runtime`,
 * because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason goes to this face's error line (it already names every way to attach
 * and says when no host binary was found), so interactive callers only have to stop before drawing anything.
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
 * thrown because citty's `runMain` answers a thrown error with `process.exit(1)` and drops buffered stdout;
 * setting `process.exitCode` keeps the two codes this CLI uses (1 failure, 2 usage) and leaves `--json`
 * output clean. A run that simply did not work is a result with `success: false`, not a throw.
 */
async function runLinkuOnHost(
  host: CliHost,
  input: LinkuInput,
  onEvent?: (event: OperationEvent) => void,
): Promise<LinkuResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<LinkuData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema; the run and the
 * control calls go to the host, and the started record is kept so cancel, pause and resume address the
 * operation this face actually started.
 */
export function createLinkuHostDefinition(
  host: CliHost,
  defaults: LinkuNodeConfig,
  language: TerminalLanguage,
): TerminalInteractionDefinition<LinkuInput, LinkuResult> {
  const schema = createLinkuInteractionSchema({ path: defaults.default_path, target: defaults.default_target }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<LinkuData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<LinkuData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

/**
 * The prompt-time path probe for this face, answered by `node:fs` in this process.
 *
 * It only tells the operator whether a pasted path exists before anything is sent to the host — presentation,
 * not linku's business logic, so it is a local `lstat` here rather than an import of `./core.js` or of the
 * node's `createNodeLinkuRuntime` (ADR-0074 §5 puts every run of that runtime in the host). `lstat` is the
 * same read `hostCapabilities.fs.stat` gives the node, so a link stays a link here too: linku lives on links,
 * and `resolvePaths` accepts one exactly where the node's own `pathInfo` accepts it.
 */
interface FacePathInfo {
  path: string
  exists: boolean
}

async function probePath(candidate: string): Promise<FacePathInfo> {
  const path = resolveAbsolutePath(candidate)
  try {
    await lstat(path)
    return { path, exists: true }
  } catch {
    return { path, exists: false }
  }
}
function prefs(h:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:h.env,cwd:h.cwd};return{nodeId:"linku",current,async save(v){await updateNodeConfigFile("linku", {cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}, o)},async restore(){const{config}=await loadNodeConfigWithHints<LinkuNodeConfig>("linku",{...o,jsonMode:true}),p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

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
    meta: { name: CLI_NAME, description: "Symlink manager with guided terminal mode." },
    subCommands: {
      info: defineCommand({
        meta: { name: "info", description: "Show file, directory, or symlink information." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLinkuPathArgs(args as LinkuCliOptions, host)
          const defaults = await resolveLinkuDefaults(host, Boolean(opts.json))
          await runAction({ action: "info", ...inputFromArgs(opts, defaults) }, Boolean(opts.json), host)
        },
      }),
      create: defineCommand({
        meta: { name: "create", description: "Create a symlink from --target to --path." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLinkuPathArgs(args as LinkuCliOptions, host)
          const defaults = await resolveLinkuDefaults(host, Boolean(opts.json))
          await runAction({ action: "create", ...inputFromArgs(opts, defaults) }, Boolean(opts.json), host)
        },
      }),
      move: defineCommand({
        meta: { name: "move", description: "Move --path to --target and create a link at the original path." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLinkuPathArgs(args as LinkuCliOptions, host)
          const defaults = await resolveLinkuDefaults(host, Boolean(opts.json))
          await runAction({ action: "move_link", ...inputFromArgs(opts, defaults) }, Boolean(opts.json), host)
        },
      }),
      list: defineCommand({
        meta: { name: "list", description: "List recorded links." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLinkuPathArgs(args as LinkuCliOptions, host)
          const defaults = await resolveLinkuDefaults(host, Boolean(opts.json))
          await runAction({ action: "list", ...inputFromArgs(opts, defaults) }, Boolean(opts.json), host)
        },
      }),
      import: defineCommand({
        meta: { name: "import", description: "Import legacy linku.toml records; invalid links are skipped by default." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLinkuPathArgs(args as LinkuCliOptions, host)
          await runAction({
            action: "import",
            path: opts.path,
            configPath: opts.configPath,
            includeInvalid: Boolean(opts.includeInvalid),
          }, Boolean(opts.json), host)
        },
      }),
      restore: defineCommand({
        meta: { name: "restore", description: "Move a recorded live link target back to its original path and remove the record." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLinkuPathArgs(args as LinkuCliOptions, host)
          await runAction({ action: "restore", path: opts.path, configPath: opts.configPath }, Boolean(opts.json), host)
        },
      }),
      recover: defineCommand({
        meta: { name: "recover", description: "Recover missing or incorrect recorded symlinks." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLinkuPathArgs(args as LinkuCliOptions, host)
          const defaults = await resolveLinkuDefaults(host, Boolean(opts.json))
          await runAction({ action: "recover", ...inputFromArgs(opts, defaults) }, Boolean(opts.json), host)
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
    path: { type: "string", description: "Source path." },
    target: { type: "string", description: "Target path or symlink path." },
    configPath: { type: "string", description: "xiranite.config.toml path (defaults to XIRANITE_CONFIG_PATH / XIRANITE_DATA_DIR / system dir)." },
    includeInvalid: { type: "boolean", description: "Import invalid or missing legacy records (default: false)." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function resolveLinkuPathArgs(args: LinkuCliOptions, host: CliHost): Promise<LinkuCliOptions> {
  if (!(args.path === "-" || (!args.path && hasPipedInput(host.stdin)))) return args
  const stdinLine = (await readStdinLines(host.stdin))[0] ?? ""
  return { ...args, path: stdinLine }
}

function inputFromArgs(args: LinkuCliOptions, defaults: LinkuDefaults = {}): LinkuInput {
  return {
    path: args.path ?? defaults.defaultPath,
    target: args.target ?? defaults.defaultTarget,
    configPath: args.configPath,
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} info --path <path> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }
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

      const defaults = await resolveLinkuDefaults(host)
      const outcome = await runGuidedTask(choice.task, host, defaults)
      // `undefined` is the host being gone, which will not come back mid-session; `runAction` has already
      // written the reason and set exit code 1, so the loop ends rather than prompting for another path.
      if (outcome === undefined) return
      if (!outcome) process.exitCode = 1
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
  const taskLines = GUIDED_TASKS.map((task) => `${rich(host, "•", "cyan")} ${rich(host, task.name, "magenta")}  ${task.description}`)
  writeRichPanel(host, "Xiranite Linku", [
    `${rich(host, "入口", "cyan")}  软链接管理工具，提供创建、移动、查看、列表、恢复操作`,
    `${rich(host, "任务", "cyan")}  ${GUIDED_TASKS.length} 个内置任务，下方列出全部可用任务`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；创建/移动前会预览确认`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    ...taskLines,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认读取 xiranite.config.toml 的 [nodes.linku]；可用 --config 覆盖；需要预演请用 \`${CLI_NAME} info --path <path> --json\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask): Promise<ResolvedGuidedChoice> {
  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 linku 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 8 },
  )

  if (selection === "exit") return { kind: "exit" }
  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolvePaths(host: CliHost, label: string, mustExist: boolean, defaultPath?: string): Promise<string | undefined> {
  const clipboard = (await readClipboardText()).trim()
  if (clipboard) {
    const info = await probePath(clipboard)
    if (info.exists) {
      writeLine(host, rich(host, `已从剪贴板读取路径: ${info.path}`, "yellow"))
      return info.path
    }
  }

  const answer = (await promptRich(host, `输入${label}（留空取消）`, defaultPath ?? "")).trim()
  if (!answer) {
    writeLine(host, rich(host, "未输入路径。", "yellow"))
    return undefined
  }
  const info = await probePath(answer)
  if (mustExist && !info.exists) {
    writeRichPanel(host, "Path", `路径不存在: ${answer}`, { color: "red", minWidth: 48 })
    return undefined
  }
  return info.path
}

async function resolveTarget(host: CliHost, label: string, defaultTarget?: string): Promise<string | undefined> {
  const answer = (await promptRich(host, `输入${label}（留空取消）`, defaultTarget ?? "")).trim()
  if (!answer) {
    writeLine(host, rich(host, "未输入目标路径。", "yellow"))
    return undefined
  }
  return answer
}

/** `undefined` means the host could not be reached at all, which ends the guided session. */
async function runGuidedTask(task: GuidedTask, host: CliHost, defaults: LinkuDefaults = {}): Promise<boolean | undefined> {
  let path: string | undefined
  let target: string | undefined

  if (task.needsPath) {
    path = await resolvePaths(host, task.action === "info" ? "要查看的路径" : "源路径", true, defaults.defaultPath)
    if (!path) return false
  }
  if (task.needsTarget) {
    const label = task.action === "create" ? "链接路径（软链接位置）" : "目标路径（移动到的位置）"
    target = await resolveTarget(host, label, defaults.defaultTarget)
    if (!target) return false
  }

  writeLine(host)
  writeRichPanel(host, "Run", [
    `task: ${task.name}`,
    path ? `path: ${path}` : "",
    target ? `target: ${target}` : "",
    "mode: host operation over /operations",
  ].filter(Boolean), { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

  // The gate stays in front of the run: linku creates, moves and restores links, so nothing is started on
  // the host until the operator has confirmed this exact path pair.
  const confirmed = await confirmRich(host, "确认执行?", true)
  if (!confirmed) {
    writeLine(host, rich(host, "已取消。", "yellow"))
    return false
  }

  const result = await runAction({ action: task.action, path, target }, false, host)
  return result && result.success
}

async function runAction(input: LinkuInput, json: boolean, host: CliHost): Promise<LinkuResult | undefined> {
  let progressActive = false
  const result = await runLinkuOnHost(host, input, json ? undefined : (event) => {
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
  writeLinkuSummary(host, result)
  if (!result.success) process.exitCode = 1
  return result
}

function writeLinkuSummary(host: CliHost, result: LinkuResult): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)

  if (data.pathInfo) {
    const info = data.pathInfo
    const lines = [
      `${rich(host, "路径", "cyan")}: ${info.path}`,
      `${rich(host, "存在", "cyan")}: ${info.exists ? "是" : "否"}`,
      `${rich(host, "类型", "cyan")}: ${kindLabel(info.kind)}`,
      `${rich(host, "软链接", "cyan")}: ${info.isSymlink ? "是" : "否"}`,
    ]
    if (info.linkTarget) lines.push(`${rich(host, "链接目标", "cyan")}: ${info.linkTarget}`)
    if (typeof info.targetExists === "boolean") lines.push(`${rich(host, "目标存在", "cyan")}: ${info.targetExists ? "是" : "否"}`)
    if (typeof info.sizeMb === "number") lines.push(`${rich(host, "大小", "cyan")}: ${info.sizeMb.toFixed(2)} MB`)
    if (typeof info.fileCount === "number") lines.push(`${rich(host, "文件数", "cyan")}: ${info.fileCount}`)
    writeRichPanel(host, "Path Info", lines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  }

  if (data.links.length) {
    const lines = data.links.map((link) => [
      `${rich(host, "•", "cyan")} ${truncateVisible(link.link, Math.max(20, columns - 24))}`,
      `  ${rich(host, "->", "grey")} ${truncateVisible(link.target, Math.max(20, columns - 8))}`,
      `  ${rich(host, link.type || "unknown", "magenta")}  ${link.createdAt ? rich(host, link.createdAt, "yellow") : ""}`,
    ].join("\n"))
    writeRichPanel(host, `Recorded Links (${data.links.length})`, lines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  }

  if (result.success && (data.recoveredCount > 0 || data.failedCount > 0)) {
    writeRichPanel(host, "Recovery Summary", [
      `${rich(host, "恢复", "green")}: ${data.recoveredCount}  ${rich(host, "失败", "red")}: ${data.failedCount}`,
    ], { color: data.failedCount ? "yellow" : "green", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  }

  if (data.restoredCount > 0) {
    writeRichPanel(host, "Restore Summary", [
      `${rich(host, "已还原", "green")}: ${data.restoredCount}`,
    ], { color: "green", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  }

  if (data.importedCount > 0 || data.skippedCount > 0) {
    writeRichPanel(host, "Import Summary", [
      `${rich(host, "导入", "green")}: ${data.importedCount}  ${rich(host, "跳过", "yellow")}: ${data.skippedCount}`,
    ], { color: data.skippedCount ? "yellow" : "green", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  }
}

function kindLabel(kind: LinkuPathKind): string {
  switch (kind) {
    case "dir": return "目录"
    case "file": return "文件"
    case "missing": return "缺失"
    default: return "其他"
  }
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
