#!/usr/bin/env node
import { lstat } from "node:fs/promises"
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
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { CleanfData, CleanfInput, CleanfPresetId, CleanfResult } from "./core.js"
import { readClipboardText } from "./platform.js"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { createCleanfInteractionSchema, type CleanfInteractionValues } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("cleanf")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "cleanf"
const PREVIEW_TARGET_LIMIT = 40

interface CleanfCliOptions {
  paths?: string
  presets?: string
  exclude?: string
  preview?: boolean
  json?: boolean
}

interface CleanfNodeConfig extends CliInteractionPreferencesSource {
  presets?: string[]
  exclude?: string
  preview?: boolean
}

interface CleanfDefaults {
  presets?: string[]
  exclude?: string
  preview?: boolean
}

type PathSource = "clipboard" | "manual" | "exit"
type ModeChoice = "custom" | "default" | "exit"

/**
 * Resolve cleanf defaults from xiranite.config.toml [nodes.cleanf].
 */
async function resolveCleanfDefaults(host: CliHost, json = false): Promise<CleanfDefaults> {
  try {
    const { config } = await loadNodeConfigWithHints<CleanfNodeConfig>("cleanf", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      presets: config?.presets,
      exclude: config?.exclude,
      preview: config?.preview,
    }
  } catch {
    return {}
  }
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Remove empty folders, backup files, temp folders, and trash patterns.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  // The attach flags belong to the face, not to the node: they leave argv before the command router sees
  // them and are folded into the host env, so one object carries the attach for the whole invocation.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this invocation, so
  // it stops with it. An attached host is left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({
      args: attach.remaining,
      host: attachedHost,
      cliName: CLI_NAME,
      loadContext: async () => { const { config } = await loadNodeConfigWithHints<CleanfNodeConfig>(NODE_ID, { env: attachedHost.env, cwd: attachedHost.cwd, hintSink: { stderr: attachedHost.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
      createDefinition: (defaults, language) => createCleanfHostDefinition(attachedHost, defaults, language),
      runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runMain(createProgram(pipeHost), { rawArgs: pipeArgs }) : Promise.resolve(writeUsage(pipeHost)),
      // The guide and the workbench are the product, but opening either without a host would let the
      // operator fill in the whole form before the first dead end, so the host is resolved first.
      runGuide: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runGuidedInteraction(definition, options)
      },
      runUi: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runTerminalUi(definition, options)
      },
      loadScreen: async () => (await import("./Tui.js")).CleanfTui,
      createPreferences: (_defaults, values) => createPreferenceController(host, values),
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
 * the transport failed — reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that fallback is the
 * compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to get a host.
 * Failures are caught here instead of thrown because citty's `runMain` answers a thrown error with
 * `process.exit(1)` and drops buffered stdout; setting `process.exitCode` keeps the two codes this CLI uses
 * (1 failure, 2 usage) and leaves `--json` output clean. A run that simply did not work is a result with
 * `success: false`, not a throw.
 */
async function runCleanfOnHost(
  host: CliHost,
  input: CleanfInput,
  onEvent?: (event: OperationEvent) => void,
): Promise<CleanfResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<CleanfData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema; the run and the control
 * calls go to the host, and the started record is kept so cancel, pause and resume address the operation this
 * face actually started.
 */
export function createCleanfHostDefinition(
  host: CliHost,
  defaults: CleanfDefaults,
  language: TerminalLanguage,
): TerminalInteractionDefinition<CleanfInput, CleanfResult> {
  // An operator-configured preset list overrides the form; otherwise the schema's own default — seeded from
  // `core.ts`'s enabled presets — stays the single source (`""` here would reach the host as `[]`).
  const configuredPresets = defaults.presets?.length ? defaults.presets.join("\n") : undefined
  const schema = createCleanfInteractionSchema({
    ...(configuredPresets ? { presetsText: configuredPresets } : {}),
    exclude: defaults.exclude ?? "",
    preview: defaults.preview ?? true,
  } satisfies Partial<CleanfInteractionValues>, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<CleanfData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<CleanfData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function createPreferenceController(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController { const options = { env: host.env, cwd: host.cwd }; return { nodeId: "cleanf", current, async save(values) { await updateNodeConfigFile("cleanf", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<CleanfNodeConfig>("cleanf", { ...options, jsonMode: true }); const prefs = resolveInteractionPreferences(config); return { theme: prefs.theme, defaultMode: prefs.mode, language: prefs.language ?? resolveTerminalLanguage(undefined, host.env) } } } }

function writeUsage(host: CliHost): void { writeLine(host, `${CLI_NAME} - preview or execute cleanup presets`); writeLine(host, `  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]`); writeLine(host, `  ${CLI_NAME} gd`); writeLine(host, `  ${CLI_NAME} preview|run [--paths <folders>] [--presets <ids>] [--json]`) }

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
    meta: {
      name: CLI_NAME,
      description: "File cleanup CLI with guided terminal mode and preset combinations.",
    },
    subCommands: {
      preview: defineCommand({
        meta: { name: "preview", description: "Preview cleanup targets without deleting." },
        args: cleanfArgs(true),
        async run({ args }) {
          const defaults = await resolveCleanfDefaults(host, Boolean(args.json))
          const pathsValue = (args.paths === "-" || (!args.paths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.paths
          await runAction(inputFromArgs({ ...args, paths: pathsValue } as CleanfCliOptions, true, defaults), Boolean(args.json), host)
        },
      }),
      run: defineCommand({
        meta: { name: "run", description: "Execute cleanup." },
        args: cleanfArgs(false),
        async run({ args }) {
          const defaults = await resolveCleanfDefaults(host, Boolean(args.json))
          const pathsValue = (args.paths === "-" || (!args.paths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.paths
          const preview = args.preview || defaults.preview || false
          await runAction(inputFromArgs({ ...args, paths: pathsValue } as CleanfCliOptions, preview, defaults), Boolean(args.json), host)
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

function cleanfArgs(previewDefault: boolean) {
  return {
    paths: { type: "string", description: "Paths separated by semicolon or new lines." },
    presets: { type: "string", description: "Comma-separated presets." },
    exclude: { type: "string", description: "Comma-separated exclude keywords." },
    preview: { type: "boolean", default: previewDefault, description: "Preview mode." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

/**
 * Face-side splitting of a user-supplied list. `core.ts` normalises the same fields again on the host
 * (`parseCleanfPaths` / `parseExcludeKeywords`), so this only has to keep the CLI's own separators working:
 * paths arrive semicolon- or newline-separated from flags, stdin and the clipboard.
 */
function splitList(value: string | undefined): string[] {
  return (value ?? "").split(/[\r\n;,]+/).map((item) => item.trim()).filter(Boolean)
}

function inputFromArgs(args: CleanfCliOptions, preview: boolean, defaults: CleanfDefaults = {}): CleanfInput {
  const presets = args.presets
    ? splitList(args.presets) as CleanfPresetId[]
    : defaults.presets?.length
      ? [...defaults.presets] as CleanfPresetId[]
      : undefined
  return {
    paths: splitList(args.paths),
    ...(presets ? { presets } : {}),
    exclude: args.exclude ?? defaults.exclude,
    preview,
  }
}

async function runAction(input: CleanfInput, json: boolean, host: CliHost): Promise<void> {
  let progressActive = false
  // No host, no run: `runCleanfOnHost` has already reported the reason on this face's error line and set
  // exit code 1 — the removed compat path used to answer here by cleaning files in this process.
  const result = await runCleanfOnHost(host, input, json ? undefined : (event) => {
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
  if (!result) return

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeCleanfSummary(host, result, Boolean(input.preview), input.action === "undo")
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} preview --paths <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }
  // Four questions are asked before anything touches a file, so a host that is not there is named first
  // rather than after the operator has answered all of them.
  if (!await hostReady(host)) return

  const defaults = await resolveCleanfDefaults(host)
  const defaultPresets = guidedDefaultPresets(defaults)
  let firstRender = true

  try {
    while (true) {
      renderGuidedIntro(host, defaultPresets, firstRender)
      firstRender = false

      const paths = await resolvePaths(host)
      if (!paths.length) continue

      const presets = await resolvePresets(host, defaultPresets)
      if (!presets) continue

      const exclude = await resolveExcludeKeywords(host, defaults.exclude)

      writeLine(host)
      writeSelectedPresets(host, presets, exclude)

      const confirmed = await confirmRich(host, `确认开始清理 ${paths.length} 个路径?`, true)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const previewInput: CleanfInput = { paths, presets, exclude, preview: true }
      const previewResult = await runGuidedAction(previewInput, host)
      // A host that cannot be reached will not come back mid-session, so the loop ends rather than asking
      // for another path.
      if (!previewResult) return

      if (!previewResult.success || !previewResult.data?.previewFiles.length) {
        writeLine(host, rich(host, "没有找到要删除的文件。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const proceed = await confirmRich(host, `确认将以上 ${previewResult.data.previewFiles.length} 个项目移入系统回收站?`, true)
      if (!proceed) {
        writeLine(host, rich(host, "用户取消了清理操作。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const executeInput: CleanfInput = { paths, presets, exclude, preview: false }
      const executeResult = await runGuidedAction(executeInput, host)
      if (!executeResult) return

      if (executeResult.success && executeResult.data?.undoAvailable && await confirmRich(host, "撤销刚才的清理并恢复文件?", false)) {
        if (!await runGuidedAction({ action: "undo" }, host)) return
      }

      if (!await confirmRich(host, "继续清理其他路径?", false)) return
    }
  } catch (error) {
    if (error instanceof CliPromptExitError) {
      writeLine(host, rich(host, "已退出。", "yellow"))
      return
    }
    throw error
  }
}

/**
 * The preset ids guided mode can offer. Which presets exist and which are enabled is `core.ts`'s answer; the
 * interaction schema publishes that answer as the form default, and that is the face's only legitimate view
 * of the list — the full catalog (ids with their names, and the preset combinations) has no `/operations`
 * surface yet, so guided mode no longer redraws it here.
 */
function guidedDefaultPresets(defaults: CleanfDefaults): string[] {
  if (defaults.presets?.length) return [...defaults.presets]
  // `initialValues` is published as an untyped record by the schema contract, so the field is read as text.
  return splitList(String(createCleanfInteractionSchema({}, "zh").initialValues.presetsText ?? ""))
}

function renderGuidedIntro(host: CliHost, defaultPresets: string[], includeHeader: boolean): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  writeRichPanel(host, "Xiranite Cleanf", [
    `${rich(host, "入口", "cyan")}  文件清理工具，提供多种清理预设和自定义组合功能`,
    `${rich(host, "预设", "cyan")}  ${defaultPresets.length ? defaultPresets.join(", ") : "（由节点默认）"}`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；默认先预览再删除`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    `${rich(host, "提示", "grey")}  完整预设与组合见 \`${CLI_NAME} --help\`；脚本化用 \`${CLI_NAME} preview --paths <folder> --json\``,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function resolvePaths(host: CliHost): Promise<string[]> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
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
    const paths = splitList(clipboard)
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

  const inputs = await promptPathLines(host, "输入要处理的文件夹路径")
  if (!inputs.length) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return []
  }
  const verified = await verifyPaths(inputs)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在或不是文件夹。", { color: "red", minWidth: 48 })
    return []
  }
  return verified
}

async function resolvePresets(host: CliHost, defaultPresets: string[]): Promise<CleanfPresetId[] | undefined> {
  const mode = await selectRich<ModeChoice>(
    host,
    "选择清理模式",
    [
      { value: "default", label: "使用默认启用的预设", hint: defaultPresets.join(", ") || "由节点默认" },
      { value: "custom", label: "自定义选择清理项目", hint: "输入预设 id，逗号分隔；完整清单见 --help" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "default", maxItems: 4 },
  )

  // `undefined` is the operator leaving the guide; an empty list is not the same thing, it means "let the
  // host apply its own enabled defaults" and the loop must keep going.
  if (mode === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }

  if (mode === "default") return [...defaultPresets] as CleanfPresetId[]

  const answer = (await promptRich(host, "请选择要执行的清理项目", defaultPresets.join(","))).trim()
  if (!answer) return [...defaultPresets] as CleanfPresetId[]
  return splitList(answer) as CleanfPresetId[]
}

async function resolveExcludeKeywords(host: CliHost, defaultExclude?: string): Promise<string | undefined> {
  const wantsExclude = await confirmRich(host, "是否要排除某些文件夹/文件?", Boolean(defaultExclude))
  if (!wantsExclude) return undefined
  const answer = (await promptRich(host, "输入排除关键词，多个关键词用逗号分隔", defaultExclude ?? "")).trim()
  return answer || undefined
}

function writeSelectedPresets(host: CliHost, presets: CleanfPresetId[], exclude: string | undefined): void {
  const columns = terminalColumns(host)
  // The preset catalog — names, descriptions, combinations — is `core.ts`'s data and has no `/operations`
  // surface yet, so this panel echoes exactly the ids that go into the request instead of redrawing a copy.
  const lines: string[] = presets.length
    ? presets.map((id) => `${rich(host, "•", "cyan")} ${rich(host, id, "green")}`)
    : [rich(host, "（由节点默认预设决定）", "grey")]
  if (exclude) {
    lines.push(rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"))
    lines.push(`${rich(host, "排除", "red")}  ${splitList(exclude).join(", ")}`)
  }
  writeRichPanel(host, "将执行以下清理项目", lines, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

/** Returns `undefined` when the host could not be reached at all, which ends the guided session. */
async function runGuidedAction(input: CleanfInput, host: CliHost): Promise<CleanfResult | undefined> {
  let progressActive = false
  const result = await runCleanfOnHost(host, input, (event) => {
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

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeCleanfSummary(host, result, Boolean(input.preview), input.action === "undo")
  if (!result.success) process.exitCode = 1
  return result
}

function writeCleanfSummary(host: CliHost, result: CleanfResult, preview: boolean, undo = false): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  // `removedDetails` is keyed by preset id. The id is what this face may print, since the id→name table is
  // host-side vocabulary with no `/operations` surface yet.
  const detailLines = Object.entries(data.removedDetails).map(([key, count]) =>
    `${rich(host, "•", "cyan")} ${key}: ${rich(host, String(count), "green")} 个`)

  const summaryLines = [
    undo
      ? `撤销完成，恢复 ${rich(host, String(data.restored ?? 0), "green")} 个项目${data.skipped ? `，失败 ${data.skipped} 个` : ""}。`
      : preview
      ? `预览完成，找到 ${rich(host, String(data.totalRemoved), "yellow")} 个待删除项目。`
      : `已移入系统回收站: ${rich(host, String(data.totalRemoved), "green")} 个项目${data.skipped ? `，跳过 ${data.skipped} 个` : ""}。`,
    ...detailLines,
  ]
  writeRichPanel(host, "清理总结", summaryLines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })

  if (preview && data.previewFiles.length) {
    writeLine(host)
    writeLine(host, rich(host, "待删除文件预览：", "cyan"))
    const targets = parsePreviewTargets(data.previewFiles)
    for (const target of targets.slice(0, PREVIEW_TARGET_LIMIT)) {
      const icon = target.type === "dir" ? "📁" : "📄"
      writeLine(host, `  ${icon} ${truncateVisible(target.path, columns - 6)}`)
    }
    if (targets.length > PREVIEW_TARGET_LIMIT) {
      writeLine(host, rich(host, `  ... 还有 ${targets.length - PREVIEW_TARGET_LIMIT} 个项目`, "grey"))
    }
    const fileCount = targets.filter((target) => target.type === "file").length
    const dirCount = targets.filter((target) => target.type === "dir").length
    writeLine(host)
    writeLine(host, rich(host, `统计: ${fileCount} 个文件, ${dirCount} 个文件夹`, "blue"))
  }
}

interface PreviewTarget {
  path: string
  type: "file" | "dir"
}

function parsePreviewTargets(paths: string[]): PreviewTarget[] {
  return paths.map((path) => ({ path, type: "file" as const }))
}

async function verifyPaths(paths: string[]): Promise<string[]> {
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

if (isEntryModule(import.meta.url)) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
