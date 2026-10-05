#!/usr/bin/env node
import { lstat, readFile } from "node:fs/promises"
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
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"

import type { BandiaAction, BandiaArchiveFormat, BandiaData, BandiaExtractMode, BandiaInput, BandiaOverwriteMode, BandiaPathMapping, BandiaResult } from "./core.js"
import { createNodeBandiaRuntime, readClipboardText } from "./platform.js"
import { createBandiaInteractionSchema, type BandiaInteractionValues } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("bandia")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "bandia"

const PREVIEW_LIMIT = 20
const COMPRESS_PREVIEW_LIMIT = 10

const DEFAULT_OUTPUT_PREFIX = "【a】"

interface BandiaCliOptions {
  path?: string
  paths?: string
  mappings?: string
  mappingFile?: string
  outputDir?: string
  outputPath?: string
  deleteAfter?: boolean
  useTrash?: boolean
  parallel?: boolean
  workers?: number | string
  extractMode?: BandiaExtractMode
  mode?: BandiaExtractMode
  outputPrefix?: string
  prefix?: string
  overwriteMode?: BandiaOverwriteMode
  overwrite?: BandiaOverwriteMode
  format?: BandiaArchiveFormat
  compressFormat?: BandiaArchiveFormat
  deleteSource?: boolean
  open?: boolean
  dryRun?: boolean
  json?: boolean
  clipboard?: boolean
}

interface BandiaNodeConfig extends CliInteractionPreferencesSource {
  enabled?: boolean
  mappings?: Array<Record<string, unknown>>
}

type ActionChoice = "extract" | "compress" | "repack" | "export-efu" | "exit"
type PathSource = "clipboard" | "manual" | "exit"
type OverwriteChoice = "overwrite" | "skip" | "rename"
type ExtractModeChoice = "auto" | "normal"
type FormatChoice = "zip" | "7z"
type MappingSource = "clipboard" | "file" | "exit"

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Batch extract, compress, repack, and export archive paths with Bandizip.",
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

  try {
    await runInteractionCli({ args: attach.remaining, host: attachedHost, cliName: CLI_NAME,
      loadContext: async () => { const { config } = await loadNodeConfigWithHints<BandiaNodeConfig>(NODE_ID, { env: attachedHost.env, cwd: attachedHost.cwd, hintSink: { stderr: attachedHost.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
      createDefinition: (defaults, language) => createBandiaHostDefinition(attachedHost, defaults, language),
      runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runMain(createProgram(pipeHost), { rawArgs: pipeArgs }) : Promise.resolve(writeUsage(pipeHost)),
      // The ui and gd screens are the product, but opening one without a host would let the operator fill
      // in the whole workbench before the first dead end, so the host is resolved before the renderer starts.
      runGuide: async (definition, options) => { if (!await hostReady(attachedHost)) return; await runGuidedInteraction(definition, options) },
      runUi: async (definition, options) => { if (!await hostReady(attachedHost)) return; await runTerminalUi(definition, options) },
      loadScreen: async () => (await import("./Tui.js")).BandiaTui,
      createPreferences: (_defaults, values) => createBandiaPreferences(attachedHost, values),
      reexecEntrypoint: process.argv[1], help,
    })
  } finally {
    // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this invocation,
    // so it stops with it. An attached host is left exactly where it was (`stop()` is a no-op on it).
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
 * The host for this face process, resolved once (ADR-0074 §6): attach to a host that is already running,
 * or start one as our own child when the operator configured nothing. The memo itself lives in
 * `@xiranite/cli-runtime`, because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is already written to this face's error line, and that line names
 * every way to attach, so an interactive caller only has to stop before drawing anything.
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
 * the compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to get a host.
 * Failures are caught here instead of thrown because citty's `runMain` answers a thrown error with
 * `process.exit(1)` and drops buffered stdout; setting `process.exitCode` keeps the two codes this CLI uses
 * (1 failure, 2 usage) and leaves `--json` output clean. A run that simply did not work is a result with
 * `success: false`, not a throw.
 */
async function runBandiaOnHost(
  host: CliHost,
  input: BandiaInput & { action: BandiaAction },
  onEvent?: (event: OperationEvent) => void,
): Promise<BandiaResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<BandiaData>(NODE_ID, input, onEvent)
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
export function createBandiaHostDefinition(
  host: CliHost,
  defaults: BandiaNodeConfig,
  language: TerminalLanguage,
): TerminalInteractionDefinition<BandiaInput, BandiaResult> {
  const schema = createBandiaInteractionSchema({ mappingText: defaults.mappings ? JSON.stringify({ mappings: defaults.mappings }, null, 2) : "" } satisfies Partial<BandiaInteractionValues>, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<BandiaData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<BandiaData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function createBandiaPreferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController { const options = { env: host.env, cwd: host.cwd }; return { nodeId: "bandia", current, async save(values) { await updateNodeConfigFile("bandia", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<BandiaNodeConfig>("bandia", { ...options, jsonMode: true }); const prefs = resolveInteractionPreferences(config); return { theme: prefs.theme, defaultMode: prefs.mode, language: prefs.language ?? "zh" } } } }
function writeUsage(host: CliHost) { writeLine(host, `${CLI_NAME} - Bandizip archive pipeline`); writeLine(host, `  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]`); writeLine(host, `  ${CLI_NAME} gd`); writeLine(host, `  ${CLI_NAME} extract|compress|repack|export-efu [options] [--json]`) }

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
    meta: { name: CLI_NAME, description: "Bandizip batch archive workflow with guided terminal mode." },
    subCommands: {
      extract: defineCommand({
        meta: { name: "extract", description: "Extract archive paths." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("extract", await inputFromArgs("extract", await pipedPathOptions(args as BandiaCliOptions, host), host, Boolean(args.json)), Boolean(args.json), host)
        },
      }),
      compress: defineCommand({
        meta: { name: "compress", description: "Compress source paths to archives." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("compress", await inputFromArgs("compress", await pipedPathOptions(args as BandiaCliOptions, host), host, Boolean(args.json)), Boolean(args.json), host)
        },
      }),
      repack: defineCommand({
        meta: { name: "repack", description: "Compress extracted folders back through archive mappings." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("repack", await inputFromArgs("repack", await pipedPathOptions(args as BandiaCliOptions, host), host, Boolean(args.json)), Boolean(args.json), host)
        },
      }),
      "export-efu": defineCommand({
        meta: { name: "export-efu", description: "Export archive or extracted paths to Everything EFU." },
        args: commonArgs(),
        async run({ args }) {
          await runAction("export_efu", await inputFromArgs("export_efu", await pipedPathOptions(args as BandiaCliOptions, host), host, Boolean(args.json)), Boolean(args.json), host)
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

async function pipedPathOptions(args: BandiaCliOptions, host: CliHost): Promise<BandiaCliOptions> {
  if (args.paths !== "-" && args.path !== "-" && (args.paths || args.path || !hasPipedInput(host.stdin))) return args
  const paths = await readStdinLines(host.stdin)
  return { ...args, paths: args.paths === "-" || (!args.paths && !args.path) ? paths.join(";") : args.paths, path: args.path === "-" || (!args.path && !args.paths) ? paths[0] : args.path }
}

function commonArgs() {
  return {
    path: { type: "string", description: "Single path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated paths." },
    mappings: { type: "string", description: "Mapping JSON or archive=>folder lines." },
    mappingFile: { type: "string", description: "Mapping JSON file." },
    outputDir: { type: "string", description: "Archive output directory for compress." },
    outputPath: { type: "string", description: "EFU output path." },
    deleteAfter: { type: "boolean", description: "Delete archive after successful extract." },
    useTrash: { type: "boolean", description: "Use recycle bin when deleting archives." },
    parallel: { type: "boolean", description: "Extract archives concurrently." },
    workers: { type: "string", description: "Parallel worker count." },
    extractMode: { type: "string", description: "auto or normal." },
    mode: { type: "string", description: "Alias for --extractMode." },
    outputPrefix: { type: "string", description: "Normal extract output folder prefix." },
    prefix: { type: "string", description: "Alias for --outputPrefix." },
    overwriteMode: { type: "string", description: "overwrite, skip, or rename." },
    overwrite: { type: "string", description: "Alias for --overwriteMode." },
    format: { type: "string", description: "zip or 7z." },
    compressFormat: { type: "string", description: "zip or 7z." },
    deleteSource: { type: "boolean", description: "Delete source after successful compression." },
    open: { type: "boolean", description: "Open EFU in Everything." },
    dryRun: { type: "boolean", description: "Plan commands without executing Bandizip." },
    json: { type: "boolean", description: "Print JSON result." },
    clipboard: { type: "boolean", description: "Read paths from clipboard." },
  } as const
}

async function inputFromArgs(action: BandiaAction, args: BandiaCliOptions, host: CliHost, json: boolean): Promise<BandiaInput> {
  const mappingText = await resolveBandiaMappings(args, host, json)
  const paths = splitArg(args.paths, args.path ? [args.path] : [])
  // `--clipboard` hands the clipboard's own text over as the node's `pathText`/`mappingText` and the host
  // parses it. Reading archive shapes out of that text here would put a second copy of the node's parsing
  // in the face, and the face is not where the mapping grammar lives.
  let pathText: string | undefined
  if (args.clipboard && !paths.length && !mappingText) {
    const clipboard = await readClipboardText()
    if (clipboard) {
      if (action === "repack") return { ...pipeFields(action, args), mappingText: clipboard }
      pathText = clipboard
    }
  }
  return { ...pipeFields(action, args), mappingText, pathText }
}

/** The input document every pipe subcommand shares; only the raw argument values, no defaults invented here. */
function pipeFields(action: BandiaAction, args: BandiaCliOptions): BandiaInput {
  return {
    action,
    paths: splitArg(args.paths, args.path ? [args.path] : []),
    deleteAfter: args.deleteAfter,
    useTrash: args.useTrash,
    parallel: args.parallel,
    workers: numberArg(args.workers),
    extractMode: args.extractMode || args.mode,
    outputPrefix: args.outputPrefix || args.prefix,
    overwriteMode: args.overwriteMode || args.overwrite,
    outputDir: args.outputDir,
    compressFormat: args.compressFormat || args.format,
    deleteSource: args.deleteSource,
    efuOutputPath: args.outputPath,
    openInEverything: args.open,
    dryRun: args.dryRun,
  }
}

/**
 * Resolve the mapping text bandia runs on, with priority:
 * 1. --mappingFile explicit JSON file (large mappings stay external)
 * 2. --mappings inline JSON string
 * 3. xiranite.config.toml [[nodes.bandia.mappings]] array (small mappings)
 * 4. No mappings
 *
 * The answer is text, not parsed mappings: `collectMappings()` in `core.ts` reads both `mappingText` and an
 * explicit `mappings` array, so the host parses this once and the face keeps no copy of that grammar.
 */
async function resolveBandiaMappings(args: BandiaCliOptions, host: CliHost, json: boolean): Promise<string | undefined> {
  // Priority 1: --mappingFile explicit JSON file (large mappings stay external)
  if (args.mappingFile) {
    return await readFile(args.mappingFile, "utf8")
  }

  // Priority 2: --mappings inline JSON string
  if (args.mappings) {
    return args.mappings
  }

  // Priority 3: xiranite.config.toml [[nodes.bandia.mappings]] array (small mappings)
  try {
    const { config: bandiaNode } = await loadNodeConfigWithHints<BandiaNodeConfig>(NODE_ID, {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    if (bandiaNode?.mappings?.length) {
      return JSON.stringify({ mappings: bandiaNode.mappings }, null, 2)
    }
  } catch {
    // ignore config read errors, fall through to no mappings
  }

  // Priority 4: No mappings
  return undefined
}

async function runAction(action: BandiaAction, input: BandiaInput, json: boolean, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runBandiaOnHost(host, { ...input, action }, json ? undefined : (event) => {
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
  // The attach or transport failure is already on this face's error line with exit code 1.
  if (!result) return

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeBandiaSummary(host, result)
  if (!result.success) process.exitCode = 1
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} extract --path <archive> --dryRun --json\` for scripted use.`)
    process.exitCode = 2
    return
  }
  // A guided run that spends its prompts and only then reports a dead host burns the operator's attention
  // to deliver a message they could have been given first.
  if (!await hostReady(host)) return

  let firstRender = true

  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const action = await resolveAction(host)
      if (!action) continue

      const input = await resolveGuidedInput(action, host)
      if (!input) continue

      const confirmed = await confirmRich(host, `确认执行 ${actionLabel(action)}?`, true)
      if (!confirmed) {
        writeLine(host, rich(host, "操作已取消。", "yellow"))
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      // A host that cannot be reached will not come back mid-session, so the loop ends rather than
      // prompting for another path.
      if (!await runGuidedAction(action, input, host)) return

      if (!await confirmRich(host, "继续其他操作?", false)) return
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
  writeRichPanel(host, "Xiranite Bandia", [
    `${rich(host, "入口", "cyan")}  批量解压/压缩工具，使用 Bandizip`,
    `${rich(host, "动作", "cyan")}  extract 解压 / compress 压缩 / repack 重压缩 / export-efu 导出 EFU`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback`,
    `${rich(host, "默认", "cyan")}  无参数时进入 guided，等价于原版 extract --clipboard`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: 需要脚本化请用 \`${CLI_NAME} extract --path <archive> --dryRun --json\`。`, "grey"))
}

async function resolveAction(host: CliHost): Promise<BandiaAction | null> {
  const choice = await selectRich<ActionChoice>(
    host,
    "选择 bandia 操作",
    [
      { value: "extract", label: "extract  解压压缩包", hint: "默认从剪贴板读取路径" },
      { value: "compress", label: "compress 压缩目录", hint: "把目录压缩成压缩包" },
      { value: "repack", label: "repack   根据映射重压缩", hint: "从剪贴板或文件读取映射" },
      { value: "export-efu", label: "export-efu 导出 EFU", hint: "导出路径到 Everything" },
      { value: "exit", label: "exit     退出", hint: "不执行任何操作" },
    ],
    { initialValue: "extract", maxItems: 6 },
  )

  if (choice === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return null
  }
  if (choice === "export-efu") return "export_efu"
  return choice
}

async function resolveGuidedInput(action: BandiaAction, host: CliHost): Promise<BandiaInput | null> {
  if (action === "extract") return resolveExtractInput(host)
  if (action === "compress") return resolveCompressInput(host)
  if (action === "repack") return resolveRepackInput(host)
  if (action === "export_efu") return resolveExportEfuInput(host)
  return null
}

async function resolveExtractInput(host: CliHost): Promise<BandiaInput | null> {
  const source = await resolveArchivePaths(host)
  // The queue the operator confirms is what is being handed over: the parsed list for typed paths, the pasted
  // lines verbatim when the clipboard travelled as `pathText` for the host to interpret.
  const candidates = source.paths.length ? source.paths : splitArg(source.pathText ?? "")
  if (!candidates.length) return null

  const extractMode = await selectRich<ExtractModeChoice>(
    host,
    "选择解压模式",
    [
      { value: "auto", label: "auto   智能解压", hint: "-target:auto，单根目录则解到同级" },
      { value: "normal", label: "normal 普通解压", hint: "解到【前缀】压缩包名 目录" },
    ],
    { initialValue: "auto", maxItems: 3 },
  )

  let outputPrefix = DEFAULT_OUTPUT_PREFIX
  if (extractMode === "normal") {
    outputPrefix = (await promptRich(host, "输入普通模式输出目录前缀", DEFAULT_OUTPUT_PREFIX)) || DEFAULT_OUTPUT_PREFIX
  }

  const overwriteMode = await selectRich<OverwriteChoice>(
    host,
    "选择冲突处理模式",
    [
      { value: "overwrite", label: "overwrite 覆盖", hint: "-aoa" },
      { value: "skip", label: "skip      跳过", hint: "-aos" },
      { value: "rename", label: "rename    重命名", hint: "-aou" },
    ],
    { initialValue: "overwrite", maxItems: 4 },
  )

  const deleteAfter = await confirmRich(host, "解压后删除源压缩包?", true)
  let useTrash = true
  if (deleteAfter) {
    useTrash = await confirmRich(host, "使用回收站删除?", true)
  }

  const parallel = await confirmRich(host, "启用并行解压?", false)
  let workers: number | undefined
  if (parallel) {
    const answer = await promptRich(host, "并行工作线程数 (留空使用默认)", "")
    workers = numberArg(answer)
  }

  renderExtractPreview(host, candidates, extractMode, outputPrefix)

  return {
    action: "extract",
    paths: source.paths,
    pathText: source.pathText,
    extractMode,
    outputPrefix,
    overwriteMode,
    deleteAfter,
    useTrash,
    parallel,
    workers,
  }
}

async function resolveCompressInput(host: CliHost): Promise<BandiaInput | null> {
  const sources = await resolveDirectoryPaths(host, "粘贴要压缩的目录路径")
  if (!sources.length) return null

  const format = await selectRich<FormatChoice>(
    host,
    "选择压缩格式",
    [
      { value: "zip", label: "zip", hint: "默认" },
      { value: "7z", label: "7z", hint: "7-Zip 格式" },
    ],
    { initialValue: "zip", maxItems: 3 },
  )

  const outputDir = (await promptRich(host, "输入输出目录 (留空则与源目录同级)", "")) || undefined
  const deleteSource = await confirmRich(host, "压缩后删除源目录?", true)

  renderCompressPreview(host, sources, outputDir, format, "compress")

  return {
    action: "compress",
    paths: sources,
    outputDir,
    compressFormat: format,
    deleteSource,
  }
}

async function resolveRepackInput(host: CliHost): Promise<BandiaInput | null> {
  const source = await selectRich<MappingSource>(
    host,
    "选择映射来源",
    [
      { value: "clipboard", label: "从剪贴板读取映射 JSON", hint: "复制的 mappings JSON" },
      { value: "file", label: "从文件读取映射 JSON", hint: "输入映射文件路径" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return null
  }

  let mappingText: string
  if (source === "clipboard") {
    const clipboard = (await readClipboardText()).trim()
    if (!clipboard) {
      writeRichPanel(host, "Clipboard", "剪贴板为空，请改用文件读取。", { color: "yellow", minWidth: 48 })
      return null
    }
    mappingText = clipboard
  } else {
    const filePath = (await promptRich(host, "输入映射文件路径", "")).trim()
    if (!filePath) {
      writeLine(host, rich(host, "未提供文件路径。", "yellow"))
      return null
    }
    try {
      mappingText = await readFile(filePath, "utf8")
    } catch (error) {
      writeRichPanel(host, "File", `读取文件失败: ${error instanceof Error ? error.message : String(error)}`, { color: "red", minWidth: 48 })
      return null
    }
  }

  // The mapping text travels as written: `collectMappings()` in `core.ts` reads both JSON and the `=>`/tab/`|`
  // spellings, and it reports a source folder that is not there as a failed item. Parsing or filtering that
  // grammar here would put the node's mapping rules in the face and hide rows the host is about to answer for.
  const lines = displayLines(mappingText)
  if (!lines.length) {
    writeRichPanel(host, "Mappings", "未解析到有效映射，请检查 JSON 格式。", { color: "red", minWidth: 48 })
    return null
  }

  const deleteSource = await confirmRich(host, "压缩后删除源目录?", true)

  renderMappingTextPreview(host, lines)

  return {
    action: "repack",
    mappingText,
    deleteSource,
  }
}

async function resolveExportEfuInput(host: CliHost): Promise<BandiaInput | null> {
  const paths = await resolveAnyPaths(host, "粘贴要导出的路径")
  if (!paths.length) return null

  const efuOutputPath = (await promptRich(host, "输入 EFU 输出路径 (留空使用临时目录)", "")) || undefined
  const openInEverything = await confirmRich(host, "导出后用 Everything 打开?", false)

  return {
    action: "export_efu",
    paths,
    efuOutputPath,
    openInEverything,
  }
}

/**
 * The extract queue, as the node's own input fields carry it: a list the operator typed, or the clipboard's
 * text as `pathText` for the host's `parseBandiaPaths()` to interpret. The face does not read archive shapes
 * out of pasted text — that grammar is the node's, and it lives in `core.ts`.
 */
interface GuidedArchiveSource {
  paths: string[]
  pathText?: string
}

async function resolveArchivePaths(host: CliHost): Promise<GuidedArchiveSource> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的多行压缩包路径" },
      { value: "manual", label: "手动输入路径", hint: "每行一个，分号或换行分隔" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return { paths: [] }
  }

  if (source === "clipboard") {
    const clipboard = (await readClipboardText()).trim()
    const lines = displayLines(clipboard)
    if (!lines.length) {
      writeRichPanel(host, "Clipboard", "剪贴板中未找到有效压缩包路径。", { color: "yellow", minWidth: 48 })
      return { paths: [] }
    }
    writeLine(host, rich(host, `已从剪贴板读取 ${lines.length} 个候选路径。`, "yellow"))
    return { paths: [], pathText: clipboard }
  }

  const inputs = await promptPathLines(host, "输入压缩包路径")
  if (!inputs.length) {
    writeLine(host, rich(host, "未输入任何路径。", "yellow"))
    return { paths: [] }
  }
  return { paths: inputs }
}

/** The rows a pasted document actually carries, for a preview that says what is being handed to the host. */
function displayLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

async function resolveDirectoryPaths(host: CliHost, promptLabel: string): Promise<string[]> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的多行目录路径" },
      { value: "manual", label: "手动输入路径", hint: "每行一个，分号或换行分隔" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return []
  }

  if (source === "clipboard") {
    const rawText = (await readClipboardText()).trim()
    if (!rawText) {
      writeRichPanel(host, "Clipboard", "未提供有效路径。", { color: "yellow", minWidth: 48 })
      return []
    }
    const candidates = splitArg(rawText)
    const verified = await verifyDirectories(candidates)
    if (!verified.length) {
      writeRichPanel(host, "Path", "输入的路径均不存在或不是目录。", { color: "red", minWidth: 48 })
      return []
    }
    writeLine(host, rich(host, `已识别 ${verified.length} 个有效目录。`, "yellow"))
    return verified
  }

  const inputs = await promptPathLines(host, promptLabel)
  if (!inputs.length) {
    writeRichPanel(host, "Path", "未提供有效路径。", { color: "yellow", minWidth: 48 })
    return []
  }
  const verified = await verifyDirectories(inputs)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在或不是目录。", { color: "red", minWidth: 48 })
    return []
  }
  writeLine(host, rich(host, `已识别 ${verified.length} 个有效目录。`, "yellow"))
  return verified
}

async function resolveAnyPaths(host: CliHost, promptLabel: string): Promise<string[]> {
  const source = await selectRich<PathSource>(
    host,
    "选择路径输入方式",
    [
      { value: "clipboard", label: "从剪贴板读取路径", hint: "复制的多行路径" },
      { value: "manual", label: "手动输入路径", hint: "每行一个，分号或换行分隔" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "clipboard", maxItems: 4 },
  )

  if (source === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return []
  }

  if (source === "clipboard") {
    const rawText = (await readClipboardText()).trim()
    if (!rawText) {
      writeRichPanel(host, "Clipboard", "未提供有效路径。", { color: "yellow", minWidth: 48 })
      return []
    }
    const candidates = splitArg(rawText)
    const verified = await verifyPaths(candidates)
    if (!verified.length) {
      writeRichPanel(host, "Path", "输入的路径均不存在。", { color: "red", minWidth: 48 })
      return []
    }
    writeLine(host, rich(host, `已识别 ${verified.length} 个有效路径。`, "yellow"))
    return verified
  }

  const inputs = await promptPathLines(host, promptLabel)
  if (!inputs.length) {
    writeRichPanel(host, "Path", "未提供有效路径。", { color: "yellow", minWidth: 48 })
    return []
  }
  const verified = await verifyPaths(inputs)
  if (!verified.length) {
    writeRichPanel(host, "Path", "输入的路径均不存在。", { color: "red", minWidth: 48 })
    return []
  }
  writeLine(host, rich(host, `已识别 ${verified.length} 个有效路径。`, "yellow"))
  return verified
}

function renderExtractPreview(host: CliHost, archives: string[], mode: BandiaExtractMode, prefix: string): void {
  const columns = terminalColumns(host)
  const modeDesc = mode === "auto" ? "智能解压" : `普通解压 (前缀: ${prefix})`
  const lines = [
    `待解压: ${archives.length} 个  -  ${modeDesc}`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
    ...archives.slice(0, PREVIEW_LIMIT).map((archive, index) => {
      const num = rich(host, String(index + 1).padStart(3), "cyan")
      return `${num}  ${rich(host, truncateVisible(archive, columns - 8), "magenta")}`
    }),
  ]
  if (archives.length > PREVIEW_LIMIT) {
    lines.push(rich(host, `...  还有 ${archives.length - PREVIEW_LIMIT} 个`, "grey"))
  }
  writeRichPanel(host, "Extract", lines, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

function renderCompressPreview(host: CliHost, sources: string[], outputDir: string | undefined, format: BandiaArchiveFormat, title: string): void {
  const columns = terminalColumns(host)
  const runtime = createNodeBandiaRuntime()
  const lines = [
    `待压缩: ${sources.length} 个  -  格式: ${format}`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
  ]
  for (const [index, source] of sources.slice(0, COMPRESS_PREVIEW_LIMIT).entries()) {
    const sourceName = runtime.basename(source)
    const targetName = `${sourceName}.${format}`
    const targetPath = outputDir ? runtime.join(outputDir, targetName) : runtime.join(runtime.dirname(source), targetName)
    const num = rich(host, String(index + 1).padStart(3), "cyan")
    const arrow = rich(host, "->", "grey")
    lines.push(`${num}  ${rich(host, truncateVisible(sourceName, Math.floor((columns - 16) * 0.5)), "cyan")} ${arrow} ${rich(host, truncateVisible(targetName, Math.floor((columns - 16) * 0.5)), "green")}`)
  }
  if (sources.length > COMPRESS_PREVIEW_LIMIT) {
    lines.push(rich(host, `...  还有 ${sources.length - COMPRESS_PREVIEW_LIMIT} 个`, "grey"))
  }
  writeRichPanel(host, title, lines, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

/**
 * The repack confirmation shows the mapping document the host is about to read, line by line. It used to show
 * a `basename -> basename` pair the face had parsed and filtered itself; the rows below are what travels.
 */
function renderMappingTextPreview(host: CliHost, lines: string[]): void {
  const columns = terminalColumns(host)
  const body = [
    `待重新压缩: ${lines.length} 行映射`,
    rich(host, "─".repeat(Math.min(70, columns - 8)), "grey"),
  ]
  for (const [index, line] of lines.slice(0, COMPRESS_PREVIEW_LIMIT).entries()) {
    const num = rich(host, String(index + 1).padStart(3), "cyan")
    body.push(`${num}  ${rich(host, truncateVisible(line, columns - 12), "magenta")}`)
  }
  if (lines.length > COMPRESS_PREVIEW_LIMIT) {
    body.push(rich(host, `...  还有 ${lines.length - COMPRESS_PREVIEW_LIMIT} 行`, "grey"))
  }
  writeRichPanel(host, "Repack", body, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

/** Returns `false` when the host could not be reached at all, which ends the guided session. */
async function runGuidedAction(action: BandiaAction, input: BandiaInput, host: CliHost): Promise<boolean> {
  let progressActive = false
  const result = await runBandiaOnHost(host, { ...input, action }, (event) => {
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
  writeBandiaSummary(host, result)
  if (!result.success) process.exitCode = 1
  return true
}

function writeBandiaSummary(host: CliHost, result: { success: boolean; message: string; data?: { extractedCount: number; compressedCount: number; failedCount: number; totalCount: number; exportedCount: number; efuPath?: string; pathMappings: BandiaPathMapping[]; results: Array<{ kind: string; sourcePath: string; archivePath?: string; outputPath?: string; success: boolean; durationMs: number; fileSize?: number; command?: string; error?: string; skipped?: boolean }> } }): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)
  const lines = [
    `extract: ${rich(host, String(data.extractedCount), "green")}  compress: ${rich(host, String(data.compressedCount), "green")}  failed: ${rich(host, String(data.failedCount), "red")}  total: ${data.totalCount}  exported: ${data.exportedCount}`,
  ]
  if (data.efuPath) lines.push(`efu: ${data.efuPath}`)
  if (data.pathMappings.length) lines.push(`mappings: ${data.pathMappings.length} 个`)
  writeRichPanel(host, "Summary", lines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })

  for (const item of data.results.slice(0, 50)) {
    const status = item.success ? rich(host, "ok", "green") : item.skipped ? rich(host, "skip", "yellow") : rich(host, "fail", "red")
    const arrow = item.outputPath || item.archivePath ? ` ${rich(host, "->", "grey")} ` : ""
    const target = item.outputPath || item.archivePath || ""
    const error = item.error ? ` ${rich(host, "/", "grey")} ${item.error}` : ""
    writeLine(host, `  ${status} ${truncateVisible(item.sourcePath, Math.max(8, columns - visibleWidth(`  ${status} ${arrow}${target}${error}`) - 4))}${arrow}${target}${error}`)
  }
  if (data.results.length > 50) {
    writeLine(host, rich(host, `... 还有 ${data.results.length - 50} 个结果`, "grey"))
  }

  if (data.pathMappings.length && (data.extractedCount > 0 || data.compressedCount > 0)) {
    writeLine(host)
    // Display formatting of the host's own result document, not a second copy of the mapping grammar: the
    // panel used to print `core.ts`'s `mappingsToText()`, which is this same two-space JSON of the array.
    writeRichPanel(host, "Path Mappings (JSON)", JSON.stringify({ mappings: data.pathMappings }, null, 2), { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  }
}

function actionLabel(action: BandiaAction): string {
  if (action === "extract") return "解压"
  if (action === "compress") return "压缩"
  if (action === "repack") return "重压缩"
  if (action === "export_efu") return "EFU 导出"
  return String(action)
}

async function verifyDirectories(candidates: string[]): Promise<string[]> {
  const verified: string[] = []
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate)
      if (info.isDirectory()) verified.push(candidate)
    } catch {
      // skip invalid paths
    }
  }
  return verified
}

async function verifyPaths(candidates: string[]): Promise<string[]> {
  const verified: string[] = []
  for (const candidate of candidates) {
    try {
      await lstat(candidate)
      verified.push(candidate)
    } catch {
      // skip invalid paths
    }
  }
  return verified
}

function splitArg(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)].map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
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

if (isEntryModule(import.meta.url)) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
