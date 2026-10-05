#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
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
  runGuidedInteraction,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { createTerminalTranslator, resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { MarkuAction, MarkuData, MarkuInput, MarkuModuleId, MarkuResult } from "./core.js"
import { MARKU_MODULE_VOCABULARY, createMarkuInteractionSchema } from "./interaction.js"
import { normalizeMarkuWorkflowLibrary } from "./workflow.js"
import { createNodeMarkuRuntime, readClipboardText } from "./platform.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("marku")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "marku"
/** Marku's module vocabulary, read through the node's interaction contract rather than `core.js`. */
const MARKU_MODULES = MARKU_MODULE_VOCABULARY

interface MarkuCliOptions {
  module?: string
  path?: string
  paths?: string
  input?: string
  inputFile?: string
  outputFile?: string
  config?: string
  recursive?: boolean
  dryRun?: boolean
  write?: boolean
  enableUndo?: boolean
  historyPath?: string
  undoId?: string
  json?: boolean
  workflow?: string
  workflowFile?: string
  name?: string
}

type GuidedMode = "files" | "text" | "exit"

/** Shape of the `[nodes.marku]` section in xiranite.config.toml. */
interface MarkuNodeConfig extends CliInteractionPreferencesSource {
  enable_undo?: boolean
  history_path?: string
  default_module?: string
  /** Saved MarkuWorkflowLibrary; normalized before use, never trusted as-is. */
  workflowLibrary?: unknown
}

/** Resolved marku defaults merged from TOML and built-in fallbacks. */
interface MarkuDefaults {
  /** Whether undo recording is enabled (TOML `enable_undo`, default true). */
  enableUndo: boolean
  /** TOML `history_path`; falls back to platform default when undefined. */
  historyPath?: string
  /** TOML `default_module`; falls back to "markt" when undefined/invalid. */
  defaultModule?: string
}

/**
 * Load marku defaults from the `[nodes.marku]` section of xiranite.config.toml.
 * Returns safe fallbacks (enableUndo=true, no paths) when the file or section
 * is missing. The `--historyPath` CLI flag and platform default still take
 * precedence when this returns undefined for `historyPath`.
 */
async function resolveMarkuDefaults(host: CliHost, json: boolean): Promise<MarkuDefaults> {
  try {
    const { config: marku } = await loadNodeConfigWithHints<MarkuNodeConfig>("marku", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    const historyPath = marku?.history_path?.trim() || undefined
    const defaultModule = marku?.default_module?.trim() || undefined
    return {
      enableUndo: marku?.enable_undo ?? true,
      historyPath,
      defaultModule,
    }
  } catch {
    return { enableUndo: true }
  }
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Markdown module toolbox with text, file, diff, and undo modes.",
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
  // The attach flags belong to the face, not to the node: they leave argv before the command
  // router sees them and are folded into the host env, so one object carries the attach for the whole
  // invocation and `--backend`/`--token` can never reach a node input document.
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
        const { config } = await loadNodeConfigWithHints<MarkuNodeConfig>(NODE_ID, {
          env: attachedHost.env,
          cwd: attachedHost.cwd,
          hintSink: { stderr: attachedHost.stderr },
          jsonMode: true,
        })
        return { preferences: resolveInteractionPreferences(config), value: config ?? {} }
      },
      createDefinition: (defaults, language) => createMarkuHostDefinition(attachedHost, defaults, language),
      runPipe: (pipeArgs, pipeHost) => pipeArgs.length
        ? runMain(createProgram(pipeHost), { rawArgs: pipeArgs })
        : Promise.resolve(writeLine(pipeHost, `${CLI_NAME} ui | gd | text | run | history | undo`)),
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
      loadScreen: async () => (await import("./Tui.js")).MarkuTui,
      createPreferences: (_defaults, current) => markuPreferences(attachedHost, current),
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
 * The host for this face process, resolved once: attach to a host that is already running, or start one as
 * our own child when the operator configured nothing. The memo lives in `@xiranite/cli-runtime`, because host
 * lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is written to this face's error line (it already names every way to
 * attach and says when no host binary was found), so the interactive faces only have to stop before drawing
 * anything — a guide that spends several prompts and then reports a dead host burns the operator's attention
 * to deliver a message they could have been given first.
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
 * not a throw.
 */
async function runMarkuOnHost(
  host: CliHost,
  input: MarkuInput & { action: MarkuAction },
  onEvent?: (event: OperationEvent) => void,
): Promise<MarkuResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<MarkuData>(NODE_ID, input, onEvent)
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
export function createMarkuHostDefinition(
  host: CliHost,
  defaults: MarkuNodeConfig,
  language: TerminalLanguage,
): TerminalInteractionDefinition<MarkuInput, MarkuResult> {
  const schema = createMarkuInteractionSchema({
    module: defaults.default_module && isMarkuModule(defaults.default_module) ? defaults.default_module : undefined,
    enableUndo: defaults.enable_undo,
    historyPath: defaults.history_path,
  }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<MarkuData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<MarkuData>(started, onEvent as (event: OperationEvent) => void)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function markuPreferences(host:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:host.env,cwd:host.cwd};return{nodeId:"marku",current,async save(v){await updateNodeConfigFile("marku", {cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}, o)},async restore(){const{config}=await loadNodeConfigWithHints<MarkuNodeConfig>("marku",{...o,jsonMode:true});const p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

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
    meta: { name: CLI_NAME, description: "Markdown processing toolbox with guided terminal mode." },
    subCommands: {
      text: defineCommand({
        meta: { name: "text", description: "Process inline text or an input file." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "text", ...await inputFromArgs(args as MarkuCliOptions, host, Boolean(args.json)) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      run: defineCommand({
        meta: { name: "run", description: "Process Markdown files or folders." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "run", ...await inputFromArgs(args as MarkuCliOptions, host, Boolean(args.json)) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      history: defineCommand({
        meta: { name: "history", description: "Show undo history." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "history", ...await inputFromArgs(args as MarkuCliOptions, host, Boolean(args.json)) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      undo: defineCommand({
        meta: { name: "undo", description: "Undo the latest or selected write run." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "undo", ...await inputFromArgs(args as MarkuCliOptions, host, Boolean(args.json)) }, Boolean(args.json), host, args as MarkuCliOptions)
        },
      }),
      workflow: defineCommand({
        meta: { name: "workflow", description: "Run an ordered multi-step workflow over text or files." },
        args: {
          ...commonArgs(),
          workflow: { type: "string", description: "Inline workflow JSON: { id, name, steps: [{ module, config }] }." },
          workflowFile: { type: "string", description: "Read workflow JSON from this file." },
          name: { type: "string", description: "Named workflow resolved from [nodes.marku].workflowLibrary." },
        } as const,
        async run({ args }) {
          const options = args as MarkuCliOptions
          const json = Boolean(args.json)
          const workflow = await resolveWorkflowDefinition(options, host, json)
          await runAction({ action: "workflow", workflow, ...await inputFromArgs(options, host, json) }, json, host, options)
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
    module: { type: "string", description: `Module: ${MARKU_MODULES.map((item) => item.id).join(", ")}` },
    path: { type: "string", description: "Input file or folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated paths." },
    input: { type: "string", description: "Inline Markdown text." },
    inputFile: { type: "string", description: "Read Markdown text from this file." },
    outputFile: { type: "string", description: "Write text-mode output to this file." },
    config: { type: "string", description: "Module config JSON." },
    recursive: { type: "boolean", description: "Recurse into folders." },
    dryRun: { type: "boolean", description: "Preview file changes without writing." },
    write: { type: "boolean", description: "Write file changes. Overrides dry-run." },
    enableUndo: { type: "boolean", description: "Record undo state when writing." },
    historyPath: { type: "string", description: "Undo history JSON path." },
    undoId: { type: "string", description: "Undo record id." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function inputFromArgs(args: MarkuCliOptions, host: CliHost, json: boolean): Promise<MarkuInput> {
  const defaults = await resolveMarkuDefaults(host, json)
  const inputText = args.inputFile
    ? await readFile(args.inputFile, "utf8")
    : args.input === "-" || (!args.input && hasPipedInput(host.stdin) && Symbol.asyncIterator in Object(host.stdin))
      ? await readStdinText(host.stdin)
      : args.input
  const module = args.module
    ? (isMarkuModule(args.module) ? args.module : "markt")
    : (defaults.defaultModule && isMarkuModule(defaults.defaultModule) ? defaults.defaultModule : "markt")
  return {
    module,
    paths: splitArg(args.paths, args.path ? [args.path] : []),
    inputText,
    stepConfig: parseConfig(args.config),
    recursive: args.recursive,
    dryRun: args.write ? false : args.dryRun,
    enableUndo: args.enableUndo ?? defaults.enableUndo,
    historyPath: args.historyPath ?? defaults.historyPath,
    undoId: args.undoId,
  }
}

/**
 * Resolves the workflow definition for the workflow subcommand. Precedence:
 * inline JSON, then a JSON file, then a named workflow from the configured
 * library. Returns undefined so the core reports the canonical
 * missing/malformed failure instead of duplicating validation here.
 */
async function resolveWorkflowDefinition(options: MarkuCliOptions, host: CliHost, json: boolean): Promise<unknown> {
  if (options.workflow?.trim()) return parseWorkflowJson(options.workflow)
  if (options.workflowFile) return parseWorkflowJson(await readFile(options.workflowFile, "utf8"))
  if (options.name?.trim()) {
    const target = options.name.trim()
    const { config } = await loadNodeConfigWithHints<MarkuNodeConfig>("marku", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    const library = normalizeMarkuWorkflowLibrary(config?.workflowLibrary)
    return library.workflows.find((workflow) => workflow.name === target || workflow.id === target)
  }
  return undefined
}

function parseWorkflowJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

async function runAction(input: MarkuInput & { action: MarkuAction }, json: boolean, host: CliHost, options: MarkuCliOptions): Promise<void> {
  let progressActive = false
  const result = await runMarkuOnHost(host, input, json ? undefined : (event) => {
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

  if (options.outputFile && result.data?.outputText) await writeFile(options.outputFile, result.data.outputText, "utf8")
  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeMarkuSummary(host, result)
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} text --module markt --input "# Title" --json\` for scripted use.`)
    process.exitCode = 2
    return
  }
  if (!await hostReady(host)) return

  const runtime = createNodeMarkuRuntime()
  const defaults = await resolveMarkuDefaults(host, false)
  const initialModule = defaults.defaultModule && isMarkuModule(defaults.defaultModule) ? defaults.defaultModule : "markt"
  // The shared schema is the only source of marku's danger rule and its wording: the write gate below calls
  // `isDangerous`/`dangerPrompt` instead of re-deciding in this face what counts as a live write.
  const language = resolveTerminalLanguage(undefined, host.env)
  const interaction = createMarkuInteractionSchema({ module: initialModule, historyPath: defaults.historyPath }, language)
  let firstRender = true

  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const module = await selectRich<MarkuModuleId>(
        host,
        "选择 marku 模块",
        MARKU_MODULES.map((item): { value: MarkuModuleId; label: string; hint: string } => ({
          value: item.id,
          label: item.id,
          hint: item.name,
        })),
        { initialValue: initialModule, maxItems: 9 },
      )

      const mode = await selectRich<GuidedMode>(
        host,
        "选择运行模式",
        [
          { value: "files", label: "处理文件/目录", hint: "扫描 .md 文件并应用模块" },
          { value: "text", label: "内联文本", hint: "粘贴 Markdown 文本，输出结果" },
          { value: "exit", label: "退出", hint: "不执行任何操作" },
        ],
        { initialValue: "files", maxItems: 4 },
      )

      if (mode === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      if (mode === "files") {
        const paths = await resolveInputPaths(host, runtime)
        if (!paths.length) continue
        const recursive = await confirmRich(host, "递归扫描子目录?", false)
        const dryRun = await confirmRich(host, "以 dry-run 模式运行 (不写文件，只输出 diff)?", true)
        const input = { action: "run" as const, module, paths, recursive, dryRun, enableUndo: !dryRun, historyPath: defaults.historyPath }
        // marku writes Markdown files in place, so a live write is confirmed before the run starts — never
        // after it. A preview (dry-run) stays unconfirmed, because nothing on disk changes.
        if (!await confirmDangerousRun(host, interaction, input)) return
        // A host that cannot be reached will not come back mid-session, so the loop ends rather than
        // prompting for another path.
        if (!await runGuidedAction(input, host)) return
      } else {
        const text = await resolveInputText(host)
        if (!text) continue
        if (!await runGuidedAction({ action: "text", module, inputText: text, historyPath: defaults.historyPath }, host)) return
      }

      if (!await confirmRich(host, "继续选择其他模块?", false)) return
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
 * Confirms a run this node marks dangerous **before** it is sent to the host, and reports the refusal as a
 * choice to leave the guided session (`false`) rather than as a failed run. Non-dangerous runs — text mode and
 * every dry-run — answer `true` without an extra prompt, exactly as they did before this face talked to a host.
 *
 * What counts as dangerous and how it is worded are read from the node's own schema (`isDangerous` /
 * `dangerPrompt`), not re-decided here: the shared `gd` runner applies the same two fields, and a face that
 * invented its own second rule would let an operator see two different safety answers for one node. The
 * fallback wording is the one `runGuidedInteraction` uses, so the two guided faces cannot disagree.
 *
 * `confirm` is a seam, not a feature: the guided loop answers through this face's Clack prompts, while the test
 * injects a scripted answer, because what has to stay provable is the order — confirm first, `POST` second.
 */
export async function confirmDangerousRun(
  host: CliHost,
  schema: ReturnType<typeof createMarkuInteractionSchema>,
  input: MarkuInput,
  confirm: (message: string, defaultValue: boolean) => Promise<boolean> = (message, defaultValue) => confirmRich(host, message, defaultValue),
): Promise<boolean> {
  if (!schema.isDangerous(input)) return true
  const t = createTerminalTranslator(resolveTerminalLanguage(undefined, host.env))
  const danger = schema.dangerPrompt?.(input)
  writeLine(host, rich(host, danger?.body ?? t("hazardNotice"), "red", "bold"))
  if (!await confirm(danger?.confirmLabel ?? t("runReal"), false)) {
    writeLine(host, rich(host, "操作已取消。", "yellow"))
    return false
  }
  return true
}

function renderGuidedIntro(host: CliHost, includeHeader: boolean): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  const moduleLines = MARKU_MODULES.map((item) => `${rich(host, item.id, "magenta")}  ${item.name}`)
  writeRichPanel(host, "Xiranite Marku", [
    `${rich(host, "入口", "cyan")}  Markdown 模块工具箱，支持标题/列表/表格/去重等转换`,
    `${rich(host, "模块", "cyan")}  9 个模块，下方列出全部可用模块`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；dry-run 默认开启`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    ...moduleLines,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function resolveInputPaths(host: CliHost, runtime: { pathInfo: (path: string) => Promise<{ exists: boolean; isDirectory: boolean; path: string }> }): Promise<string[]> {
  const clipboard = (await readClipboardText()).trim()
  if (clipboard) {
    const info = await runtime.pathInfo(clipboard)
    if (info.exists && info.isDirectory) {
      writeLine(host, rich(host, `已从剪贴板读取路径: ${info.path}`, "yellow"))
      return [info.path]
    }
  }

  const inputs = await promptPathLines(host, "输入文件或目录路径")
  const paths: string[] = []
  for (const input of inputs) {
    const info = await runtime.pathInfo(input)
    if (!info.exists) {
      writeRichPanel(host, "Path", `路径不存在: ${input}`, { color: "red", minWidth: 48 })
      continue
    }
    paths.push(info.path)
  }
  return paths
}

async function resolveInputText(host: CliHost): Promise<string | null> {
  const clipboard = (await readClipboardText()).trim()
  if (clipboard) {
    writeLine(host, rich(host, `已从剪贴板读取 ${clipboard.split(/\r?\n/).length} 行文本。`, "yellow"))
    return clipboard
  }
  const text = await promptRich(host, "粘贴 Markdown 文本，用 \\n 表示多行", "")
  return text || null
}

/** Returns `false` when the host could not be reached at all, which ends the guided session. */
async function runGuidedAction(input: MarkuInput & { action: MarkuAction }, host: CliHost): Promise<boolean> {
  let progressActive = false
  const result = await runMarkuOnHost(host, input, (event) => {
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
  if (!result) return false

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeMarkuSummary(host, result)
  if (!result.success) process.exitCode = 1
  return true
}

function writeMarkuSummary(host: CliHost, result: MarkuResult): void {
  const data = result.data
  if (!data) return

  if (data.filesProcessed !== undefined) {
    writeRichPanel(host, "Summary", [
      `files: ${data.filesProcessed}  changed: ${data.filesChanged ?? 0}`,
    ], { color: result.success ? "green" : "yellow", minWidth: 48 })

    for (const diff of data.diffs?.slice(0, 20) ?? []) {
      const status = diff.changed ? rich(host, "changed", "yellow") : rich(host, "same", "grey")
      writeLine(host, `${status} ${truncateVisible(diff.file, terminalColumns(host) - 16)}`)
    }
    if ((data.diffs?.length ?? 0) > 20) writeLine(host, rich(host, `... ${(data.diffs?.length ?? 0) - 20} more file(s)`, "grey"))
  }

  if (data.outputText && data.outputText !== data.inputText) {
    writeLine(host)
    writeRichPanel(host, "Output", truncateVisible(data.outputText, terminalColumns(host) - 6), { color: "green", minWidth: 48 })
  }

  if (data.history?.length) {
    writeLine(host)
    writeLine(host, rich(host, "Undo history:", "cyan"))
    for (const record of data.history.slice(0, 20)) {
      const status = record.undone ? rich(host, "undone", "grey") : rich(host, "active", "green")
      writeLine(host, `${status} ${record.id} ${rich(host, record.module, "magenta")} ${record.files.length} file(s)`)
    }
  }
}

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim()).filter(Boolean)
}

function parseConfig(value?: string): Record<string, unknown> {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function isMarkuModule(value?: string): value is MarkuModuleId {
  return MARKU_MODULES.some((item) => item.id === value)
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
