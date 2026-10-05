#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  defineCommand,
  hasPipedInput as runtimeHasPipedInput,
  isEntryModule,
  nodeCliName,
  promptRich,
  readStdinText,
  rich,
  runMain,
  runGuidedInteraction,
  selectRich,
  terminalColumns,
  truncateVisible,
  writeError,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationsClient } from "@xiranite/cli-runtime/backend"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"

import type { LinedupFilterInput, LinedupFilterResult } from "./core.js"
import { readClipboardText } from "./platform.js"
import { createLinedupInteractionSchema, splitWireLines, toLinedupWireInput, type LinedupInput, type LinedupResult } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("linedup")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "linedup"
const hasPipedInput = (stream: NodeJS.ReadableStream) => runtimeHasPipedInput(stream) && Symbol.asyncIterator in Object(stream)
const REMOVAL_DETAIL_LIMIT = 20
type GuidedMode = "preset-files" | "clipboard-source" | "custom-files" | "inline-text" | "exit"

interface FilterOptions {
  source?: string
  sourceFile?: string
  filter?: string
  filterFile?: string
  outputFile?: string
  json?: boolean
  caseInsensitive?: boolean
  preserveOrder?: boolean
}

interface LinedupNodeConfig extends CliInteractionPreferencesSource {
  source_file?: string
  filter_file?: string
  output_file?: string
  case_insensitive?: boolean
  preserve_order?: boolean
}

interface LinedupDefaults {
  sourceFile?: string
  filterFile?: string
  outputFile?: string
  caseInsensitive?: boolean
  preserveOrder?: boolean
}

/**
 * Resolve linedup defaults from xiranite.config.toml [nodes.linedup].
 */
async function resolveLinedupDefaults(host: CliHost, json = false): Promise<LinedupDefaults> {
  try {
    const { config } = await loadNodeConfigWithHints<LinedupNodeConfig>("linedup", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      sourceFile: config?.source_file,
      filterFile: config?.filter_file,
      outputFile: config?.output_file,
      caseInsensitive: typeof config?.case_insensitive === "boolean" ? config.case_insensitive : undefined,
      preserveOrder: typeof config?.preserve_order === "boolean" ? config.preserve_order : undefined,
    }
  } catch {
    return {}
  }
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Filter source lines by removing any line containing a filter token.",
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
  // The attach flags belong to the face, not to the node: they leave argv before the command router
  // sees them and are folded into the host env, so one object carries the attach for the whole
  // invocation and the flags can never reach a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)
  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this
  // invocation, so it stops with it. An attached host is left exactly where it was.
  try {
    await runInteractionCli({args:attach.remaining,host:attachedHost,cliName:CLI_NAME,loadContext:async()=>{const{config}=await loadNodeConfigWithHints<LinedupNodeConfig>("linedup",{env:attachedHost.env,cwd:attachedHost.cwd,hintSink:{stderr:attachedHost.stderr},jsonMode:true});return{preferences:resolveInteractionPreferences(config),value:config??{}}},createDefinition:(d,l)=>createLinedupHostDefinition(attachedHost,d,l),runPipe:legacyRunProgram,runGuide:async(definition,options)=>{if(!await hostReady(attachedHost))return;await runGuidedInteraction(definition,options)},runUi:async(definition,options)=>{if(!await hostReady(attachedHost))return;await runTerminalUi(definition,options)},loadScreen:async()=>(await import("./Tui.js")).LinedupTui,createPreferences:(_d,c)=>prefs(attachedHost,c),reexecEntrypoint:process.argv[1],help})
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
 * The host for this face process, resolved once (ADR-0074 §6): attach to a host that is already
 * running, or start one as our own child when the operator configured nothing. The memo lives in
 * `@xiranite/cli-runtime`, because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason goes to this face's error line (it already names every way to
 * attach and says when no host binary was found), so an interactive caller stops before drawing
 * anything — a guided run that spends seven prompts and then reports a dead host burns the
 * operator's attention to deliver a message they could have been given first.
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
 * Attaches to the host, starts the `filterLines` operation and returns its result document, or
 * `undefined` when the attach or the transport failed — reported on this face's error line with exit
 * code 1. A terminal face that cannot reach a host stops rather than running `core.ts` locally: that
 * fallback is the compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to get a
 * host. Failures are caught here instead of thrown because citty's `runMain` answers a thrown error
 * with `process.exit(1)` and drops buffered stdout; setting `process.exitCode` keeps the two codes
 * this CLI uses (1 failure, 2 usage) and leaves `--json` output clean.
 *
 * No event sink is passed: a pure node's entry is `run(input)` (`filterLines` takes no `onEvent`), so
 * the host has nothing to emit for this node. The interactive definition still forwards events,
 * because that is the shape the terminal session reads progress from.
 */
async function runLinedupOnHost(host: CliHost, input: LinedupFilterInput): Promise<LinedupResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<LinedupFilterResult>(NODE_ID, input)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema; the run and
 * the control calls go to the host, and the started record is kept so cancel, pause and resume
 * address the operation this face actually started.
 */
export function createLinedupHostDefinition(
  host: CliHost,
  config: LinedupNodeConfig,
  language: TerminalLanguage,
): TerminalInteractionDefinition<LinedupInput, LinedupResult> {
  const schema = createLinedupInteractionSchema({ caseSensitive: config.case_insensitive !== true, sort: config.preserve_order !== true }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<LinedupFilterResult>(NODE_ID, toLinedupWireInput(input))
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<LinedupFilterResult>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function prefs(h:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:h.env,cwd:h.cwd};return{nodeId:"linedup",current,async save(v){await updateNodeConfigFile("linedup", {cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}, o)},async restore(){const{config}=await loadNodeConfigWithHints<LinedupNodeConfig>("linedup",{...o,jsonMode:true}),p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

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
      description: "Line filter with Typer-style commands and a Clack guided mode.",
    },
    subCommands: {
      filter: defineCommand({
        meta: {
          name: "filter",
          description: "Filter line content from inline strings or files.",
        },
        args: {
          source: { type: "string", description: "Inline source text. Use \\n for new lines." },
          sourceFile: { type: "string", description: "Source file path." },
          filter: { type: "string", description: "Inline filter text. Use \\n for new lines." },
          filterFile: { type: "string", description: "Filter file path." },
          outputFile: { type: "string", description: "Write kept lines to this file." },
          json: { type: "boolean", description: "Print JSON result." },
          caseInsensitive: { type: "boolean", description: "Match filters case-insensitively." },
          preserveOrder: { type: "boolean", description: "Preserve source order instead of sorting output." },
        },
        async run({ args }) {
          const defaults = await resolveLinedupDefaults(host, Boolean(args.json))
          await runFilter(args as FilterOptions, host, defaults)
        },
      }),
      guided: defineCommand({
        meta: {
          name: "guided",
          description: "Open a rich terminal guided workflow.",
        },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} filter --help\` for scripted use.`)
    process.exitCode = 2
    return
  }
  // A host that cannot be reached will not come back mid-session, so the whole guide is refused
  // before the first prompt rather than after the operator has answered six of them.
  if (!await hostReady(host)) return

  try {
    const defaults = await resolveLinedupDefaults(host)
    const preset = await detectPresetFiles(host.cwd, defaults)
    renderGuidedIntro(host, preset)

    const mode = await selectRich<GuidedMode>(
      host,
      "选择 linedup 工作流",
      guidedModeOptions(preset),
      { initialValue: preset.available ? "preset-files" : "clipboard-source", maxItems: 6 },
    )

    if (mode === "exit") {
      writeLine(host, rich(host, "已退出。", "yellow"))
      return
    }

    await runGuidedMode(mode, preset, host, defaults)
  } catch (error) {
    if (error instanceof CliPromptExitError) {
      writeLine(host, rich(host, "已取消。", "yellow"))
      return
    }
    throw error
  }
}

function renderGuidedIntro(host: CliHost, preset: GuidedPresetFiles): void {
  const columns = terminalColumns(host)
  const lines = [
    `${rich(host, "入口", "cyan")}  移除 source 中包含 filter 任意 token 的行`,
    `${rich(host, "习惯", "cyan")}  当前目录 source.txt + filter.txt -> output.txt`,
    `${rich(host, "路径", "cyan")}  剪贴板优先；手动输入仅作 fallback`,
  ]
  if (preset.available) {
    lines.push(`${rich(host, "检测", "green")}  已发现 source.txt / filter.txt，回车直接执行`)
  } else if (preset.sourceExists && !preset.filterExists) {
    lines.push(`${rich(host, "检测", "yellow")}  仅发现 source.txt，缺少 filter.txt`)
  } else if (!preset.sourceExists && preset.filterExists) {
    lines.push(`${rich(host, "检测", "yellow")}  仅发现 filter.txt，缺少 source.txt`)
  } else {
    lines.push(`${rich(host, "检测", "yellow")}  未发现约定文件，将使用剪贴板或手动输入`)
  }
  writeRichPanel(host, "Xiranite Linedup", lines, {
    color: "blue",
    minWidth: 72,
    maxWidth: columns - 2,
  })
  writeLine(host)
}

async function runGuidedMode(mode: GuidedMode, preset: GuidedPresetFiles, host: CliHost, defaults: LinedupDefaults = {}): Promise<void> {
  if (mode === "preset-files") {
    await runGuidedFilter({
      host,
      sourceFile: preset.sourceFile,
      filterFile: preset.filterFile,
      outputFile: preset.outputFile,
      sourceLabel: preset.sourceFile,
      filterLabel: preset.filterFile,
      caseInsensitive: defaults.caseInsensitive,
      preserveOrder: defaults.preserveOrder,
    })
    return
  }

  if (mode === "custom-files") {
    const sourceFile = (await promptRich(host, "Source file path", preset.sourceFile)).trim() || preset.sourceFile
    const filterFile = (await promptRich(host, "Filter file path", preset.filterFile)).trim() || preset.filterFile
    const outputFile = (await promptRich(host, "Output file path (留空则只输出到终端)", preset.outputFile)).trim() || undefined
    await runGuidedFilter({ host, sourceFile, filterFile, outputFile, sourceLabel: sourceFile, filterLabel: filterFile, caseInsensitive: defaults.caseInsensitive, preserveOrder: defaults.preserveOrder })
    return
  }

  if (mode === "clipboard-source") {
    const clipboard = (await readClipboardText()).trim()
    let sourceText: string
    if (clipboard) {
      writeLine(host, rich(host, `已从剪贴板读取 ${splitWireLines(clipboard).filter(Boolean).length} 行源文本。`, "yellow"))
      sourceText = clipboard
    } else {
      sourceText = await promptRich(host, "剪贴板为空。粘贴源文本，用 \\n 表示多行", "")
    }
    const filterText = await promptRich(host, "Filter token(s)，用 \\n 表示多个", "")
    const outputFile = (await promptRich(host, "可选输出文件路径 (留空只输出到终端)", "")).trim() || undefined
    await runGuidedText({ host, sourceText, filterText, outputFile, caseInsensitive: defaults.caseInsensitive, preserveOrder: defaults.preserveOrder })
    return
  }

  const sourceText = await promptRich(host, "Source text，用 \\n 表示多行", "")
  const filterText = await promptRich(host, "Filter token(s)，用 \\n 表示多行", "")
  const outputFile = (await promptRich(host, "可选输出文件路径 (留空只输出到终端)", "")).trim() || undefined
  await runGuidedText({ host, sourceText, filterText, outputFile, caseInsensitive: defaults.caseInsensitive, preserveOrder: defaults.preserveOrder })
}

interface GuidedFilterInput {
  host: CliHost
  sourceFile: string
  filterFile: string
  outputFile?: string
  sourceLabel: string
  filterLabel: string
  caseInsensitive?: boolean
  preserveOrder?: boolean
}

async function runGuidedFilter(input: GuidedFilterInput): Promise<void> {
  const sourceText = await readGuidedFile(input.host, input.sourceFile, "source")
  if (sourceText === null) return
  const filterText = await readGuidedFile(input.host, input.filterFile, "filter")
  if (filterText === null) return
  await runGuidedText({
    host: input.host,
    sourceText,
    filterText,
    outputFile: input.outputFile,
    sourceLabel: input.sourceLabel,
    filterLabel: input.filterLabel,
    caseInsensitive: input.caseInsensitive,
    preserveOrder: input.preserveOrder,
  })
}

interface GuidedTextInput {
  host: CliHost
  sourceText: string
  filterText: string
  outputFile?: string
  sourceLabel?: string
  filterLabel?: string
  caseInsensitive?: boolean
  preserveOrder?: boolean
}

async function runGuidedText(input: GuidedTextInput): Promise<void> {
  const sourceText = input.sourceText.replace(/\\n/g, "\n")
  const filterText = input.filterText.replace(/\\n/g, "\n")

  // Both guards look at the text this face just read, not at node statistics: `analyzeReadLines` is
  // not a host entry, so no line count is claimed here that the host did not answer with.
  if (!sourceText.trim()) {
    writeRichPanel(input.host, "错误", "源文本为空，无法过滤。", { color: "red", minWidth: 48 })
    process.exitCode = 1
    return
  }
  reportReadAttempt(input.host, input.sourceLabel ?? "source")

  if (!filterText.trim()) {
    writeRichPanel(input.host, "错误", "过滤 token 为空，无法过滤。", { color: "red", minWidth: 48 })
    process.exitCode = 1
    return
  }
  reportReadAttempt(input.host, input.filterLabel ?? "filter")

  writeLine(input.host, rich(input.host, "▸ 开始过滤...", "cyan"))

  const result = await runLinedupOnHost(input.host, toLinedupWireInput({
    sourceText,
    filterText,
    caseSensitive: !input.caseInsensitive,
    sort: !input.preserveOrder,
  }))
  const data = unwrapFilterResult(input.host, result)
  if (!data) return

  reportFilterStats(input.host, data)

  const outputFile = input.outputFile?.trim() || undefined
  if (outputFile) {
    writeLine(input.host, rich(input.host, `▸ 正在写入输出文件: ${outputFile}...`, "green"))
    await writeFile(outputFile, `${data.filteredLines.join("\n")}\n`, "utf8")
  }

  writeRichPanel(input.host, "Summary", [
    `kept: ${data.keptCount}`,
    `removed: ${data.removedCount}`,
    outputFile ? `output: ${outputFile}` : "output: stdout",
  ], { color: "green", minWidth: 48 })

  writeLine(input.host, rich(input.host, `处理完成！共过滤出 ${data.keptCount} 个唯一行`, "green", "bold"))
  if (outputFile) {
    writeLine(input.host, rich(input.host, `结果已保存到: ${outputFile}`, "green"))
  } else {
    writeLine(input.host)
    writeLine(input.host, data.filteredLines.join("\n"))
  }
}

/** The `▸ 正在读取` line the guided flow used to print next to its read statistics. */
function reportReadAttempt(host: CliHost, label: string): void {
  writeLine(host, rich(host, `▸ 正在读取: ${label}...`, "cyan"))
}

/**
 * Reports what the host answered. `keptCount + removedCount` is the host's own two counts, so the
 * unique-source line still adds up; the duplicate lines and the filter file's unique count came from
 * `analyzeReadLines`, and the matched token per removed line came from `explainRemovals` — neither is
 * a host entry for this node (`crates/xiranite-quickjs-executor/bundles/linedup.js` exports
 * `filterLines` only), so those two reports left with the in-process runner instead of being
 * recomputed here, which would put a second engine in the face.
 */
function reportFilterStats(host: CliHost, data: LinedupFilterResult): void {
  writeRichPanel(host, "过滤统计", [
    `源文本中共有 ${data.keptCount + data.removedCount} 个唯一行`,
  ], { color: "cyan", minWidth: 56 })

  const removed = data.removedLines
  for (let index = 0; index < Math.min(removed.length, REMOVAL_DETAIL_LIMIT); index += 1) {
    writeLine(host, `${rich(host, "移除行: ", "red")}${truncateVisible(removed[index]!, terminalColumns(host) - 24)}`)
  }
  if (removed.length > REMOVAL_DETAIL_LIMIT) {
    writeLine(host, rich(host, `... 以及 ${removed.length - REMOVAL_DETAIL_LIMIT} 个其他被移除行`, "grey"))
  }

  writeLine(host, rich(host, `被移除的行数: ${data.removedCount}`, "red"))
  writeLine(host, rich(host, `保留的行数: ${data.keptCount}`, "green"))
}

/**
 * The host's answer or nothing. A rejected run is reported on the error line with exit code 1 — a run
 * that simply did not work is a result with `success: false`, not a throw, while an absent result
 * document means the attach or the transport already failed and said so.
 */
function unwrapFilterResult(host: CliHost, result: LinedupResult | undefined): LinedupFilterResult | undefined {
  if (!result) return undefined
  if (!result.success || !result.data) {
    writeError(host, result.message || "The host returned no linedup result document.")
    process.exitCode = 1
    return undefined
  }
  return result.data
}

async function readGuidedFile(host: CliHost, filePath: string, kind: "source" | "filter"): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeRichPanel(host, "错误", `读取${kind === "source" ? "源" : "过滤"}文件失败: ${filePath}\n${message}`, { color: "red", minWidth: 56 })
    process.exitCode = 1
    return null
  }
}

async function runFilter(options: FilterOptions, host: CliHost, defaults: LinedupDefaults = {}): Promise<void> {
  const sourceText = options.source === "-" || (!options.source && hasPipedInput(host.stdin))
    ? await readStdinText(host.stdin)
    : await readInput(options.source, options.sourceFile)
  const filterText = options.filter === "-" || (!options.filter && hasPipedInput(host.stdin))
    ? await readStdinText(host.stdin)
    : await readInput(options.filter, options.filterFile)

  if (!sourceText.trim()) {
    throw new Error("Missing source content. Use --source or --sourceFile, or run guided mode.")
  }

  const caseInsensitive = options.caseInsensitive ?? defaults.caseInsensitive ?? false
  const preserveOrder = options.preserveOrder ?? defaults.preserveOrder ?? false

  const result = await runLinedupOnHost(host, toLinedupWireInput({
    sourceText,
    filterText,
    caseSensitive: !caseInsensitive,
    sort: !preserveOrder,
  }))
  const data = unwrapFilterResult(host, result)
  if (!data) return

  const outputFile = options.outputFile ?? defaults.outputFile
  if (outputFile) {
    await writeFile(outputFile, `${data.filteredLines.join("\n")}\n`, "utf8")
  }

  if (options.json) {
    writeLine(host, JSON.stringify(data, null, 2))
    return
  }

  writeLine(host, data.filteredLines.join("\n"))
  writeLine(host, `kept=${data.keptCount} removed=${data.removedCount}`)
}

async function readInput(inline?: string, filePath?: string): Promise<string> {
  if (filePath) {
    return readFile(filePath, "utf8")
  }
  return (inline ?? "").replace(/\\n/g, "\n")
}

interface GuidedPresetFiles {
  sourceFile: string
  filterFile: string
  outputFile: string
  sourceExists: boolean
  filterExists: boolean
  available: boolean
}

function guidedModeOptions(preset: GuidedPresetFiles) {
  const presetOption = {
    value: "preset-files" as const,
    label: "当前目录约定文件",
    hint: preset.available ? "source.txt / filter.txt -> output.txt" : "缺少 source.txt 或 filter.txt",
    disabled: !preset.available,
  }
  const activeOptions = [
    { value: "clipboard-source" as const, label: "剪贴板作为源文本", hint: "只需再输入过滤 token" },
    { value: "custom-files" as const, label: "手动选择文件", hint: "自定义 source/filter/output 路径" },
    { value: "inline-text" as const, label: "粘贴文本", hint: "用 \\n 表示多行" },
  ]
  const exitOption = { value: "exit" as const, label: "退出", hint: "不执行任何操作" }
  return preset.available ? [presetOption, ...activeOptions, exitOption] : [...activeOptions, presetOption, exitOption]
}

async function detectPresetFiles(cwd: string, defaults: LinedupDefaults = {}): Promise<GuidedPresetFiles> {
  const sourceFile = join(cwd, defaults.sourceFile ?? "source.txt")
  const filterFile = join(cwd, defaults.filterFile ?? "filter.txt")
  const outputFile = join(cwd, defaults.outputFile ?? "output.txt")
  const [sourceExists, filterExists] = await Promise.all([isFile(sourceFile), isFile(filterFile)])
  return {
    sourceFile,
    filterFile,
    outputFile,
    sourceExists,
    filterExists,
    available: sourceExists && filterExists,
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

if (isEntryModule(import.meta.url)) {
  await runProgram()
}
