#!/usr/bin/env node
import { isEntryModule,
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
  runGuidedInteraction,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { RawfilterAction, RawfilterData, RawfilterInput, RawfilterPlanItem, RawfilterResult, RawfilterRuntime } from "./core.js"
import { createNodeRawfilterRuntime, readClipboardText } from "./platform.js"
import { createRawfilterInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("rawfilter")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "rawfilter"

interface RawfilterNodeConfig extends CliInteractionPreferencesSource {
  name_only_mode?: boolean
  create_shortcuts?: boolean
  trash_only?: boolean
  min_similarity?: number
  dry_run?: boolean
}

interface RawfilterDefaults {
  nameOnlyMode?: boolean
  createShortcuts?: boolean
  trashOnly?: boolean
  minSimilarity?: number
  dryRun?: boolean
}

async function resolveRawfilterDefaults(host: CliHost, json = false): Promise<RawfilterDefaults> {
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<RawfilterNodeConfig>("rawfilter", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      nameOnlyMode: nodeConfig?.name_only_mode,
      createShortcuts: nodeConfig?.create_shortcuts,
      trashOnly: nodeConfig?.trash_only,
      minSimilarity: nodeConfig?.min_similarity,
      dryRun: nodeConfig?.dry_run,
    }
  } catch {
    return {}
  }
}

interface RawfilterCliOptions {
  path?: string
  nameOnly?: boolean
  nameOnlyMode?: boolean
  createShortcuts?: boolean
  trashOnly?: boolean
  minSimilarity?: string | number
  dryRun?: boolean
  json?: boolean
}

interface GuidedTask {
  name: string
  description: string
  input: Omit<RawfilterInput, "path">
}

type GuidedSelection = "exit" | "manual-path" | `task:${string}`

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "path"; path: string; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

const GUIDED_TASKS: GuidedTask[] = [
  {
    name: "basic",
    description: "标准模式：分组重复压缩包，保留翻译版，其余移入 multi",
    input: { action: "execute" },
  },
  {
    name: "name-only",
    description: "仅名称模式：仅按文件名分组，不读压缩包内容",
    input: { action: "execute", nameOnlyMode: true },
  },
  {
    name: "trash-only",
    description: "裁剪模式：保留翻译版，其余版本移入 trash",
    input: { action: "execute", nameOnlyMode: true, trashOnly: true },
  },
  {
    name: "shortcuts",
    description: "快捷方式模式：为重复版本创建快捷方式而不移动",
    input: { action: "execute", createShortcuts: true },
  },
  {
    name: "plan-only",
    description: "预览模式：只生成计划，不移动任何文件",
    input: { action: "plan" },
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Group similar archives and move duplicate/raw versions to trash or multi.",
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
    meta: { name: CLI_NAME, description: "Archive similarity filter with guided terminal mode." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan and group archives without changing files." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveRawfilterArgs(args as RawfilterCliOptions, host)
          const json = Boolean(opts.json)
          const defaults = await resolveRawfilterDefaults(host, json)
          await runAction({ action: "scan", ...inputFromArgs(opts, defaults) }, json, host)
        },
      }),
      plan: defineCommand({
        meta: { name: "plan", description: "Preview file operations." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveRawfilterArgs(args as RawfilterCliOptions, host)
          const json = Boolean(opts.json)
          const defaults = await resolveRawfilterDefaults(host, json)
          await runAction({ action: "plan", ...inputFromArgs(opts, defaults) }, json, host)
        },
      }),
      execute: defineCommand({
        meta: { name: "execute", description: "Move duplicate/raw versions according to the plan." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveRawfilterArgs(args as RawfilterCliOptions, host)
          const json = Boolean(opts.json)
          const defaults = await resolveRawfilterDefaults(host, json)
          await runAction({ action: "execute", ...inputFromArgs(opts, defaults) }, json, host)
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
    path: { type: "string", description: "Directory containing archive files." },
    nameOnly: { type: "boolean", description: "Use exact normalized names only." },
    nameOnlyMode: { type: "boolean", description: "Alias for --nameOnly." },
    createShortcuts: { type: "boolean", description: "Create shortcuts for multi versions instead of moving them." },
    trashOnly: { type: "boolean", description: "Move every non-kept duplicate to trash." },
    minSimilarity: { type: "string", description: "Fuzzy grouping threshold from 0 to 1." },
    dryRun: { type: "boolean", description: "Preview without changing files." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function resolveRawfilterArgs(args: RawfilterCliOptions, host: CliHost): Promise<RawfilterCliOptions> {
  if (!(args.path === "-" || (!args.path && hasPipedInput(host.stdin)))) return args
  const stdinLine = (await readStdinLines(host.stdin))[0] ?? ""
  return { ...args, path: stdinLine }
}

function inputFromArgs(args: RawfilterCliOptions, defaults: RawfilterDefaults = {}): RawfilterInput {
  return {
    path: args.path,
    nameOnlyMode: args.nameOnly ?? args.nameOnlyMode ?? defaults.nameOnlyMode ?? false,
    createShortcuts: args.createShortcuts ?? defaults.createShortcuts,
    trashOnly: args.trashOnly ?? defaults.trashOnly,
    minSimilarity: args.minSimilarity !== undefined ? numberArg(args.minSimilarity) : defaults.minSimilarity,
    dryRun: args.dryRun ?? defaults.dryRun,
  }
}

async function runAction(input: RawfilterInput & { action: RawfilterAction }, json: boolean, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runRawfilterOnHost(host, input, json ? undefined : (event) => {
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
  // No host, no run: the reason is already on this face's error line and `process.exitCode` is 1.
  if (!result) return

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writePlanSummary(host, result)
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} plan --path <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }
  // Nothing may be asked before the host is resolved: an operator who filled in the whole task selection
  // and then learned there is no host spent their attention for nothing.
  if (!await hostReady(host)) return

  const runtime = createNodeRawfilterRuntime()
  const defaults = await resolveRawfilterDefaults(host, false)
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

      const paths = choice.kind === "path" ? [choice.path] : await resolveGuidedPaths(host, runtime)
      if (!paths.length) {
        writeRichPanel(host, "Path", "未提供有效文件夹路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        continue
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        `path: ${paths.join("; ")}`,
        `mode: ${choice.task.input.action ?? "execute"}`,
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      for (const path of paths) {
        const ok = await runGuidedTask(choice.task, path, host, defaults)
        if (!ok) break
      }

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
  writeRichPanel(host, "Xiranite Rawfilter", [
    `${rich(host, "入口", "cyan")}  分组重复压缩包，保留翻译版，raw/未知版本移入 trash 或 multi`,
    `${rich(host, "任务", "cyan")}  basic / name-only / trash-only / shortcuts / plan-only`,
    `${rich(host, "路径", "cyan")}  可直接粘贴路径；否则读取剪贴板，失败时再手动输入`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: plan-only 只预览不移动；其他任务会直接移动文件。需要脚本化请用 \`${CLI_NAME} plan --path <folder> --json\`。`, "grey"))
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask, runtime: RawfilterRuntime): Promise<ResolvedGuidedChoice> {
  const directPath = cleanPath(await promptRich(host, "粘贴文件夹路径直接执行默认任务；留空进入任务选择", ""))
  if (directPath) {
    const info = await runtime.pathInfo(directPath)
    if (info.exists && info.isDirectory) return { kind: "path", path: info.path, task: defaultTask }
    writeRichPanel(host, "Path", `不是有效文件夹: ${directPath}`, { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 rawfilter 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入路径，并使用默认 basic 任务" },
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

async function resolveGuidedPaths(host: CliHost, runtime: RawfilterRuntime): Promise<string[]> {
  const clipboardPaths = await pathsFromClipboard(runtime)
  if (clipboardPaths.length) {
    writeLine(host, rich(host, `已从剪贴板读取 ${clipboardPaths.length} 个路径。`, "yellow"))
    return clipboardPaths
  }

  const answer = await promptRich(host, "输入文件夹路径", "")
  return await validDirectoryPaths(splitPaths(answer), runtime)
}

async function runGuidedTask(task: GuidedTask, path: string, host: CliHost, defaults: RawfilterDefaults = {}): Promise<boolean> {
  const input: RawfilterInput = { ...defaults, ...task.input, path }
  let progressActive = false
  const result = await runRawfilterOnHost(host, input, (event) => {
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
  // A host that could not be reached at all already reported its reason and set exit code 1.
  if (!result) return false

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writePlanSummary(host, result)
  if (!result.success) {
    process.exitCode = 1
    return false
  }
  return true
}

function writePlanSummary(host: CliHost, result: RawfilterResult): void {
  const data = result.data
  if (!data) return
  writeRichPanel(host, "Summary", [
    `archives: ${data.archiveCount}  groups: ${data.totalGroups}  duplicate: ${data.duplicateGroups}`,
    `kept: ${data.keptCount}  trash: ${data.movedToTrash}  multi: ${data.movedToMulti}  shortcut: ${data.createdShortcuts}`,
    `errors: ${data.errorCount}  skipped: ${data.skippedFiles}`,
  ], { color: result.success ? "green" : "yellow", minWidth: 76 })

  for (const item of data.plan.slice(0, 80)) writeLine(host, formatPlanItem(item, host))
  if (data.plan.length > 80) writeLine(host, rich(host, `... ${data.plan.length - 80} more item(s)`, "grey"))
  if (data.errors.length) writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })
}

function formatPlanItem(item: RawfilterPlanItem, host: CliHost): string {
  const status = item.status === "success"
    ? rich(host, "success", "green")
    : item.status === "error"
      ? rich(host, "error", "red")
      : item.status === "skipped"
        ? rich(host, "skipped", "yellow")
        : item.status === "kept"
          ? rich(host, "kept", "blue")
          : rich(host, "pending", "cyan")
  const destination = rich(host, item.destination, item.destination === "trash" ? "red" : item.destination === "multi" ? "magenta" : item.destination === "shortcut" ? "cyan" : "blue")
  const suffix = item.targetPath ? ` -> ${truncateVisible(item.targetPath, 48)}` : ` / ${item.reason}`
  return `${status} ${destination} ${truncateVisible(item.fileName, terminalColumns(host) - visibleWidth(`${status} ${destination} `) - 24)}${suffix}`
}

async function pathsFromClipboard(runtime: RawfilterRuntime = createNodeRawfilterRuntime()): Promise<string[]> {
  const text = await readClipboardText()
  if (!text) return []
  return await validDirectoryPaths(splitPaths(text), runtime)
}

async function validDirectoryPaths(candidates: string[], runtime: RawfilterRuntime): Promise<string[]> {
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
  if (typeof value === "number") return value
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

function endProgress(host: CliHost, active = true): void {
  if (active && host.stdout.isTTY) host.stdout.write("\n")
}

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  // The attach flags belong to the face, not to the node: they leave argv before the command router sees
  // them and are folded into the host env, so one object carries the attach for the whole invocation and a
  // `--backend` can never be read as an archive directory.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this invocation, so it
  // stops with it. An attached host is left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({
      args: attach.remaining,
      host: attachedHost,
      cliName: CLI_NAME,
      loadContext: async () => {
        const { config } = await loadNodeConfigWithHints<RawfilterNodeConfig>(NODE_ID, { env: attachedHost.env, cwd: attachedHost.cwd, hintSink: { stderr: attachedHost.stderr }, jsonMode: true })
        return { preferences: resolveInteractionPreferences(config), value: config ?? {} }
      },
      createDefinition: (defaults, language) => createRawfilterHostDefinition(attachedHost, defaults, language),
      runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runMain(createProgram(pipeHost), { rawArgs: pipeArgs }) : Promise.resolve(writeLine(pipeHost, `${CLI_NAME} ui | gd | scan | plan | execute`)),
      runGuide: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runGuidedInteraction(definition, options)
      },
      // The TUI form is the product, but opening it without a host would let the operator fill in the whole
      // workbench before the first dead end, so the host is resolved before the renderer starts.
      runUi: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runTerminalUi(definition, options)
      },
      loadScreen: async () => (await import("./Tui.js")).RawfilterTui,
      createPreferences: (_defaults, current) => rawfilterPreferences(attachedHost, current),
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
 * The host for this face process, resolved once: attach to a host that is already running, or start one as our
 * own child when the operator configured nothing. The memo lives in `@xiranite/cli-runtime`, because host
 * lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is written to this face's error line (it already names every way to
 * attach and says when no host binary was found), so the interactive faces only have to stop before drawing
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
 * drops buffered stdout; setting `process.exitCode` keeps the two codes this CLI uses (1 failure, 2 usage) and
 * leaves `--json` output a clean document. A run that simply did not work is a result with `success: false`,
 * not a throw — and rawfilter moving archives is exactly such a run, so it must not look like a crash.
 */
async function runRawfilterOnHost(
  host: CliHost,
  input: RawfilterInput,
  onEvent?: (event: OperationEvent) => void,
): Promise<RawfilterResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<RawfilterData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema; the run and the control
 * calls go to the host, and the started record is kept so cancel, pause and resume address the operation this
 * face actually started — rawfilter's `execute` moves archives, so a cancel has to reach that move loop.
 */
export function createRawfilterHostDefinition(
  host: CliHost,
  defaults: RawfilterNodeConfig,
  language: TerminalLanguage,
): TerminalInteractionDefinition<RawfilterInput, RawfilterResult> {
  const schema = createRawfilterInteractionSchema({
    nameOnlyMode: defaults.name_only_mode,
    createShortcuts: defaults.create_shortcuts,
    trashOnly: defaults.trash_only,
    minSimilarity: defaults.min_similarity,
    dryRun: defaults.dry_run,
  }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<RawfilterData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<RawfilterData>(started, onEvent as (event: OperationEvent) => void)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function rawfilterPreferences(host:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:host.env,cwd:host.cwd};return{nodeId:"rawfilter",current,async save(v){await updateNodeConfigFile("rawfilter", {cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}, o)},async restore(){const{config}=await loadNodeConfigWithHints<RawfilterNodeConfig>("rawfilter",{...o,jsonMode:true});const p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

if (isEntryModule(import.meta.url)) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
