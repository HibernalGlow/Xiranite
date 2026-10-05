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
  visibleWidth,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
  runGuidedInteraction,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { EncodebAction, EncodebData, EncodebInput, EncodebMapping, EncodebResult, EncodebStrategy, EncodebTransform } from "./core.js"
import { readClipboardText } from "./platform.js"
import { createEncodebInteractionSchema, encodebInputFromInteractionValues, type EncodebInteractionValues } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("encodeb")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "encodeb"
const PREVIEW_LIMIT = 40

interface EncodebCliOptions {
  paths?: string
  preset?: string
  srcEncoding?: string
  dstEncoding?: string
  transform?: string
  strategy?: string
  limit?: string
  json?: boolean
}

interface EncodebNodeConfig extends CliInteractionPreferencesSource {
  preset?: string
  src_encoding?: string
  dst_encoding?: string
  transform?: string
  strategy?: string
  limit?: number
}

interface EncodebDefaults {
  preset?: string
  srcEncoding?: string
  dstEncoding?: string
  transform?: EncodebTransform
  strategy?: EncodebStrategy
  limit?: number
}

/**
 * Resolve encodeb defaults from xiranite.config.toml [nodes.encodeb].
 */
async function resolveEncodebDefaults(host: CliHost, json = false): Promise<EncodebDefaults> {
  try {
    const { config } = await loadNodeConfigWithHints<EncodebNodeConfig>("encodeb", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      preset: config?.preset,
      srcEncoding: config?.src_encoding,
      dstEncoding: config?.dst_encoding,
      transform: config?.transform === "auto" || config?.transform === "decode-hash-u" || config?.transform === "normalize-middle-dot" ? config.transform : config?.transform === "recode" ? "recode" : undefined,
      strategy: config?.strategy === "copy" ? "copy" : config?.strategy === "replace" ? "replace" : undefined,
      limit: typeof config?.limit === "number" ? config.limit : undefined,
    }
  } catch {
    return {}
  }
}

interface GuidedTask {
  name: "find" | "preview" | "recover"
  description: string
  action: EncodebAction
}

type GuidedPresetId = EncodebInteractionValues["preset"]
type PathSource = "clipboard" | "manual" | "exit"
type StrategyChoice = EncodebStrategy | "exit"

/**
 * The encoding pair a preset stands for. Every field stays optional here exactly as it does in
 * `EncodebInput`: `normalizeEncodebInput` on the host fills cp437 → cp936/recode for anything the face leaves
 * out, so the face does not restate those defaults and does not hold a second copy of the preset table.
 */
interface GuidedPresetInfo {
  srcEncoding?: string
  dstEncoding?: string
  transform?: EncodebTransform
}

type ResolvedGuidedChoice =
  | { kind: "exit" }
  | { kind: "paths"; paths: string[]; task: GuidedTask }
  | { kind: "task"; task: GuidedTask }

type GuidedSelection = "exit" | "manual-path" | `task:${string}`

const GUIDED_TASKS: GuidedTask[] = [
  { name: "find", description: "扫描疑似乱码名称", action: "find" },
  { name: "preview", description: "预览名称重编码结果", action: "preview" },
  { name: "recover", description: "执行原地重命名（或复制）", action: "recover" },
]

/**
 * The preset table is node business data and lives in `core.ts`; the one reader this face is allowed to use is
 * the node's own shared contract (`interaction.ts`), so a preset id resolves to its encoding pair here and not
 * through a second list kept in step by hand.
 */
function encodebPresetTriple(presetId: string): GuidedPresetInfo {
  const { srcEncoding, dstEncoding, transform } = encodebInputFromInteractionValues({ preset: presetId })
  return { srcEncoding, dstEncoding, transform }
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Preview and recover garbled filenames by re-decoding path components.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  // The attach flags belong to the face, not to the node: they leave argv before the command router sees
  // them and are folded into the host env, so `--backend <url>` can never be mistaken for a scanned path and
  // never reaches a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5 puts the host lifecycle in this invocation: a host this face started stops with it, while a
  // host it attached to is left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({ args: attach.remaining, host: attachedHost, cliName: CLI_NAME,
      loadContext: async () => { const { config } = await loadNodeConfigWithHints<EncodebNodeConfig>(NODE_ID, { env: attachedHost.env, cwd: attachedHost.cwd, hintSink: { stderr: attachedHost.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
      createDefinition: (defaults, language) => createEncodebHostDefinition(attachedHost, defaults, language),
      runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runMain(createProgram(pipeHost), { rawArgs: pipeArgs }) : Promise.resolve(writeUsage(pipeHost)),
      // Opening a screen without a host would let the operator fill the whole workbench, or answer every
      // recover prompt, before the first dead end — so the host is resolved before anything is rendered.
      runGuide: async (definition, options) => { if (await hostReady(attachedHost)) await runGuidedInteraction(definition, options) },
      runUi: async (definition, options) => { if (await hostReady(attachedHost)) await runTerminalUi(definition, options) },
      loadScreen: async () => (await import("./Tui.js")).EncodebTui,
      createPreferences: (_defaults, values) => createEncodebPreferences(attachedHost, values),
      reexecEntrypoint: process.argv[1], help,
    })
  } finally {
    await stopSharedHost()
  }
}

/**
 * The `ui`/`gd` definition. The node owns only the shared schema — including `isDangerous` and `dangerPrompt`,
 * which the session consults *before* it calls `run`, so a live rename still needs an explicit confirmation —
 * and every byte of work goes to the host, whose root grants come from the node manifest rather than from
 * anything invented here. The started record is kept so cancel, pause and resume address the operation this
 * face actually started.
 */
export function createEncodebHostDefinition(host: CliHost, defaults: EncodebNodeConfig, language: TerminalLanguage): TerminalInteractionDefinition<EncodebInput, EncodebResult> {
  const schema = createEncodebInteractionSchema({ preset: defaults.preset ?? "cn", srcEncoding: defaults.src_encoding ?? "cp437", dstEncoding: defaults.dst_encoding ?? "cp936", strategy: defaults.strategy === "copy" ? "copy" : "replace", limit: defaults.limit ?? 200 } satisfies Partial<EncodebInteractionValues>, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<EncodebData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<EncodebData>(started, onEvent)
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
 * and says when no host binary was found), so an interactive caller only has to stop before drawing anything.
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
async function runEncodebOnHost(
  host: CliHost,
  input: EncodebInput,
  onEvent?: (event: OperationEvent) => void,
): Promise<EncodebResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<EncodebData>(NODE_ID, input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

function createEncodebPreferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController { const options = { env: host.env, cwd: host.cwd }; return { nodeId: "encodeb", current, async save(values) { await updateNodeConfigFile("encodeb", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<EncodebNodeConfig>("encodeb", { ...options, jsonMode: true }); const prefs = resolveInteractionPreferences(config); return { theme: prefs.theme, defaultMode: prefs.mode, language: prefs.language ?? "zh" } } } }
function writeUsage(host: CliHost) { writeLine(host, `${CLI_NAME} - filename encoding recovery`); writeLine(host, `  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]`); writeLine(host, `  ${CLI_NAME} gd`); writeLine(host, `  ${CLI_NAME} find|preview|recover <paths...> [--json]`) }

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
      description: "Filename encoding recovery with Typer-style commands and a Clack guided mode.",
    },
    subCommands: {
      find: defineCommand({
        meta: { name: "find", description: "Find suspicious garbled filenames." },
        args: encodebArgs(),
        async run({ args }) {
          const defaults = await resolveEncodebDefaults(host, Boolean(args.json))
          await runAction({ ...inputFromArgs({ ...args, paths: (args.paths === "-" || (!args.paths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.paths } as EncodebCliOptions, defaults), action: "find" }, Boolean(args.json), host)
        },
      }),
      preview: defineCommand({
        meta: { name: "preview", description: "Preview filename re-encoding mappings." },
        args: encodebArgs(),
        async run({ args }) {
          const defaults = await resolveEncodebDefaults(host, Boolean(args.json))
          await runAction({ ...inputFromArgs({ ...args, paths: (args.paths === "-" || (!args.paths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.paths } as EncodebCliOptions, defaults), action: "preview" }, Boolean(args.json), host)
        },
      }),
      recover: defineCommand({
        meta: { name: "recover", description: "Apply filename recovery." },
        args: encodebArgs(),
        async run({ args }) {
          const defaults = await resolveEncodebDefaults(host, Boolean(args.json))
          await runAction({ ...inputFromArgs({ ...args, paths: (args.paths === "-" || (!args.paths && hasPipedInput(host.stdin))) ? (await readStdinLines(host.stdin)).join(";") : args.paths } as EncodebCliOptions, defaults), action: "recover" }, Boolean(args.json), host)
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

function encodebArgs() {
  return {
    paths: { type: "string", description: "Paths separated by semicolon or new lines." },
    preset: { type: "string", description: "Built-in repair preset or custom." },
    srcEncoding: { type: "string", description: "Source encoding, e.g. cp437." },
    dstEncoding: { type: "string", description: "Destination encoding, e.g. cp936." },
    transform: { type: "string", description: "recode, decode-hash-u, or normalize-middle-dot." },
    strategy: { type: "string", description: "replace or copy." },
    limit: { type: "string", description: "Maximum preview/find results." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: EncodebCliOptions, defaults: EncodebDefaults = {}): EncodebInput {
  const presetId = args.preset ?? defaults.preset ?? "auto"
  const preset = encodebPresetTriple(presetId)
  const strategy = args.strategy ?? defaults.strategy ?? "replace"
  return {
    paths: splitPathArg(args.paths ?? ""),
    srcEncoding: args.srcEncoding ?? defaults.srcEncoding ?? preset.srcEncoding,
    dstEncoding: args.dstEncoding ?? defaults.dstEncoding ?? preset.dstEncoding,
    transform: args.transform === "auto" || args.transform === "decode-hash-u" || args.transform === "normalize-middle-dot" ? args.transform : args.transform === "recode" ? "recode" : defaults.transform ?? preset.transform,
    strategy: strategy === "copy" ? "copy" : "replace",
    limit: Number(args.limit ?? defaults.limit ?? 200),
  }
}

/**
 * How this face cuts a `--paths` value into elements — the delimiter the flag has always documented, and
 * nothing more. Trimming, quote-stripping and dropping empties stay the node's own rule: `normalizeEncodebInput`
 * re-applies `parseEncodebPaths` to every element on the host, so the face does not carry a second copy of it.
 */
function splitPathArg(value: string): string[] {
  return value.split(";").map(cleanPath).filter(Boolean)
}

/** Same split as the flag's, but on the line breaks a pasted clipboard block is written with. */
function splitClipboardPaths(value: string): string[] {
  return value.split(/\r?\n/).map(cleanPath).filter(Boolean)
}

async function runAction(input: EncodebInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runWithProgress(input, host, json)
  // No host answer at all: the reason is already on the error line and `process.exitCode` is 1.
  if (!result) return

  if (json) {
    writeJson(host, result)
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  if (input.action === "find") {
    for (const match of result.data?.matches ?? []) writeLine(host, match)
  } else if (input.action === "preview") {
    for (const mapping of result.data?.mappings ?? []) {
      writeLine(host, `${mapping.src} ${rich(host, "->", "grey")} ${mapping.dst}`)
    }
  }
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} find --paths <folder> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }
  // Asking for paths, a preset and a live-rename confirmation the host would never see is worse than
  // saying "no host" first.
  if (!await hostReady(host)) return

  const defaultTask = GUIDED_TASKS[1]!
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

      const paths = choice.kind === "paths" ? choice.paths : await resolvePaths(host)
      if (!paths.length) {
        writeRichPanel(host, "Path", "未提供有效路径。可以复制路径到剪贴板，或在选择处直接粘贴路径。", { color: "yellow", minWidth: 56 })
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const preset = await resolvePreset(host)
      if (!preset) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const defaults = await resolveEncodebDefaults(host)

      let strategy: EncodebStrategy | undefined
      if (choice.task.name === "recover") {
        strategy = await resolveStrategy(host)
        if (!strategy) {
          if (!await confirmRich(host, "重新开始?", false)) return
          continue
        }
      }

      writeRichPanel(host, "Run", [
        `task: ${choice.task.name}`,
        `paths: ${paths.join("; ")}`,
        `preset: ${preset.srcEncoding} -> ${preset.dstEncoding}`,
        ...(choice.task.name === "recover" ? [`strategy: ${strategy}`] : []),
      ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

      const outcome = await runGuidedTask(choice.task, paths, preset, strategy, host, defaults)
      // A host that cannot be reached will not come back mid-session, so the loop ends instead of asking
      // the operator to pick another path.
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
  writeRichPanel(host, "Xiranite Encodeb", [
    `${rich(host, "入口", "cyan")}  名称修复工具，内置 TypeScript guided flow`,
    `${rich(host, "任务", "cyan")}  find 扫描疑似乱码名称 / preview 预览重编码 / recover 原地重命名或复制`,
    `${rich(host, "预设", "cyan")}  支持 ZIP 中日韩、GBK→日文、1252→UTF-8、#Uxxxx 和日文间隔点`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback；recover 执行前需二次确认`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
}

async function readGuidedChoice(host: CliHost, defaultTask: GuidedTask): Promise<ResolvedGuidedChoice> {
  const first = cleanPath(await promptRich(host, "粘贴路径直接执行默认任务（可逐行输入多个）；留空进入任务选择", ""))
  if (first) {
    const inputs: string[] = [first]
    writeLine(host, rich(host, "继续输入路径，逐行回车；直接回车空行结束。", "grey"))
    while (true) {
      const suffix = ` (已收集 ${inputs.length} 条，留空结束)`
      const answer = cleanPath(await promptRich(host, `输入下一个路径${suffix}`, ""))
      if (!answer) break
      if (!inputs.includes(answer)) inputs.push(answer)
    }
    const verified = await verifyPaths(inputs)
    if (verified.length) return { kind: "paths", paths: verified, task: defaultTask }
    writeRichPanel(host, "Path", "输入的路径均无效，进入任务选择。", { color: "red", minWidth: 48 })
  }

  const selection = await selectRich<GuidedSelection>(
    host,
    "选择 encodeb 任务",
    [
      ...GUIDED_TASKS.map((task): { value: GuidedSelection; label: string; hint: string } => ({
        value: `task:${task.name}`,
        label: task.name,
        hint: task.description,
      })),
      { value: "manual-path", label: "paste-path", hint: "手动输入路径，并使用默认 preview 任务" },
      { value: "exit", label: "exit", hint: "离开引导模式" },
    ],
    { initialValue: `task:${defaultTask.name}`, maxItems: 6 },
  )

  if (selection === "exit") return { kind: "exit" }
  if (selection === "manual-path") return { kind: "task", task: defaultTask }

  const taskName = selection.slice("task:".length)
  return { kind: "task", task: GUIDED_TASKS.find((task) => task.name === taskName) ?? defaultTask }
}

async function resolvePaths(host: CliHost): Promise<string[]> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的多行路径" },
      { value: "manual", label: "手动输入路径", hint: "用分号或换行分隔" },
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
    const paths = splitClipboardPaths(clipboard)
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

  const inputs = await promptPathLines(host, "输入要处理的路径")
  if (!inputs.length) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return []
  }
  const verified = await verifyPaths(inputs)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在。", { color: "red", minWidth: 48 })
    return []
  }
  return verified
}

async function resolvePreset(host: CliHost): Promise<GuidedPresetInfo | undefined> {
  const presetId = await selectRich<GuidedPresetId | "exit">(
    host,
    "选择编码预设",
    [
      { value: "auto", label: "auto", hint: "自动识别明显乱码（推荐，不确定时保持原样）" },
      { value: "cn", label: "cn", hint: "cp437 -> cp936（中文）" },
      { value: "jp", label: "jp", hint: "cp437 -> cp932（日文）" },
      { value: "kr", label: "kr", hint: "cp437 -> cp949（韩文）" },
      { value: "jp_from_cn", label: "jp_from_cn", hint: "cp936 -> cp932（日文被中文误解码）" },
      { value: "jp_iso2022_from_cn", label: "jp_iso2022_from_cn", hint: "cp936 -> ISO-2022-JP（旧日文2模式）" },
      { value: "latin1_utf8", label: "latin1_utf8", hint: "Windows-1252 -> UTF-8（ã‚» 类乱码）" },
      { value: "hash_u", label: "hash_u", hint: "解码 #U30BB 一类转义" },
      { value: "middle_dot", label: "middle_dot", hint: "日文间隔点 ・ -> ·" },
      { value: "custom", label: "custom", hint: "手动输入源/目标编码" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "auto", maxItems: 11 },
  )

  if (presetId === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }

  if (presetId === "custom") {
    const srcEncoding = (await promptRich(host, "输入源编码", "cp437")).trim() || "cp437"
    const dstEncoding = (await promptRich(host, "输入目标编码", "cp936")).trim() || "cp936"
    return { srcEncoding, dstEncoding, transform: "recode" }
  }

  return encodebPresetTriple(presetId)
}

async function resolveStrategy(host: CliHost): Promise<EncodebStrategy | undefined> {
  const strategy = await selectRich<StrategyChoice>(
    host,
    "选择执行策略",
    [
      { value: "replace", label: "replace", hint: "原地重命名（默认）" },
      { value: "copy", label: "copy", hint: "复制到新目录" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "replace", maxItems: 4 },
  )

  if (strategy === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return undefined
  }

  return strategy
}

/** `false` = the host answered and the task did not work; `undefined` = no host answer, so the session ends. */
async function runGuidedTask(task: GuidedTask, paths: string[], preset: GuidedPresetInfo, strategy: EncodebStrategy | undefined, host: CliHost, defaults: EncodebDefaults = {}): Promise<boolean | undefined> {
  const baseInput: EncodebInput = {
    paths,
    srcEncoding: preset.srcEncoding,
    dstEncoding: preset.dstEncoding,
    transform: preset.transform,
    limit: defaults.limit ?? 200,
  }

  if (task.action === "find") {
    const result = await runWithProgress({ ...baseInput, action: "find" }, host)
    if (!result) return undefined
    writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
    writeEncodebSummary(host, "Find Summary", result, "find")
    return result.success
  }

  if (task.action === "preview") {
    const result = await runWithProgress({ ...baseInput, action: "preview" }, host)
    if (!result) return undefined
    writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
    writeEncodebSummary(host, "Preview Summary", result, "preview")
    return result.success
  }

  const previewResult = await runWithProgress({ ...baseInput, action: "preview" }, host)
  if (!previewResult) return undefined
  writeLine(host, previewResult.success ? rich(host, previewResult.message, "green", "bold") : rich(host, previewResult.message, "red", "bold"))
  writeEncodebSummary(host, "Preview Summary", previewResult, "preview")

  const mappings = previewResult.data?.mappings ?? []
  if (!mappings.length) {
    writeLine(host, rich(host, "没有检测到会变化的名称，无需执行恢复。", "yellow"))
    return true
  }

  // The live rename is still gated the same way it was when this face ran the node in-process: the preview
  // travels first, the operator confirms what it showed, and only then does a `recover` operation start.
  const strategyDesc = strategy === "copy" ? "复制到新目录" : "原地重命名"
  const confirmed = await confirmRich(host, `确认执行 recover（${strategyDesc}）?`, true)
  if (!confirmed) {
    writeLine(host, rich(host, "操作已取消。", "yellow"))
    return true
  }

  const result = await runWithProgress({ ...baseInput, action: "recover", strategy: strategy ?? defaults.strategy ?? "replace" }, host)
  if (!result) return undefined
  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeEncodebSummary(host, "Recover Summary", result, "recover", strategy)
  return result.success
}

/**
 * One host operation with this face's progress line. `quiet` is the `--json` contract: stdout holds the result
 * document and nothing else, so the event stream is read but never printed.
 */
async function runWithProgress(input: EncodebInput, host: CliHost, quiet = false): Promise<EncodebResult | undefined> {
  let progressActive = false
  const result = await runEncodebOnHost(host, input, quiet ? undefined : (event) => {
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
  return result
}

function writeEncodebSummary(host: CliHost, title: string, result: EncodebResult, kind: EncodebAction, strategy?: EncodebStrategy): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const panelWidth = Math.min(76, columns - 6)

  if (kind === "find") {
    const matches = data.matches.slice(0, PREVIEW_LIMIT)
    const lines = [
      `${rich(host, "matches", "cyan")}  ${rich(host, String(data.matches.length), "green")}`,
      rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
      ...matches.map((match, index) => `${rich(host, String(index + 1).padStart(2), "cyan")}. ${truncateVisible(match, columns - 8)}`),
    ]
    if (data.matches.length > PREVIEW_LIMIT) lines.push(rich(host, `... 还有 ${data.matches.length - PREVIEW_LIMIT} 条`, "grey"))
    writeRichPanel(host, title, lines, { color: result.success ? "green" : "yellow", minWidth: panelWidth })
    return
  }

  if (kind === "preview") {
    const mappings = data.mappings.slice(0, PREVIEW_LIMIT)
    const lines = [
      `${rich(host, "mappings", "cyan")}  ${rich(host, String(data.mappings.length), "green")}`,
      rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
      ...mappings.map((mapping) => formatMapping(host, mapping, columns - 8)),
    ]
    if (data.mappings.length > PREVIEW_LIMIT) lines.push(rich(host, `... 还有 ${data.mappings.length - PREVIEW_LIMIT} 条`, "grey"))
    writeRichPanel(host, title, lines, { color: result.success ? "green" : "yellow", minWidth: panelWidth })
    return
  }

  const lines = [
    `${rich(host, "processed", "cyan")}  ${rich(host, String(data.processed), "green")}`,
    `${rich(host, "strategy", "cyan")}  ${strategy === "copy" ? "复制到新目录" : "原地重命名"}`,
  ]
  writeRichPanel(host, title, lines, { color: result.success ? "green" : "yellow", minWidth: panelWidth })
}

function formatMapping(host: CliHost, mapping: EncodebMapping, budget: number): string {
  const arrow = ` ${rich(host, "->", "grey")} `
  if (budget < 24) return `${truncateVisible(mapping.src, budget)}`
  const arrowWidth = visibleWidth(arrow)
  const half = Math.floor((budget - arrowWidth) / 2)
  return `${truncateVisible(mapping.src, half)}${arrow}${truncateVisible(mapping.dst, Math.max(8, budget - half - arrowWidth))}`
}

async function verifyPaths(paths: string[]): Promise<string[]> {
  const verified: string[] = []
  for (const path of paths) {
    try {
      await lstat(path)
      verified.push(path)
    } catch {
      // skip invalid paths
    }
  }
  return verified
}

function cleanPath(value = ""): string {
  return value.trim().replace(/^["']|["']$/g, "")
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
