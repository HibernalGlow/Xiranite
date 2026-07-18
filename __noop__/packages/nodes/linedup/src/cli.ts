#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  defineCommand,
  hasPipedInput as runtimeHasPipedInput,
  nodeCliName,
  promptRich,
  readStdinText,
  rich,
  runMain,
  selectRich,
  terminalColumns,
  truncateVisible,
  writeError,
  writeLine,
  writeRichPanel,
  runGuidedInteraction,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, loadXiraniteConfig, saveXiraniteConfig, updateNodeConfig } from "@xiranite/config"

import {
  analyzeReadLines,
  explainRemovals,
  filterLines,
  splitLines,
  type LinedupReadStats,
} from "./core.js"
import { readClipboardText } from "./platform.js"
import { createLinedupInteractionSchema, runLinedupInteraction } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("linedup")
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

export async function runProgram(args=process.argv.slice(2),host:CliHost=createDefaultHost()):Promise<void>{await runInteractionCli({args,host,cliName:CLI_NAME,loadContext:async()=>{const{config}=await loadNodeConfigWithHints<LinedupNodeConfig>("linedup",{env:host.env,cwd:host.cwd,hintSink:{stderr:host.stderr},jsonMode:true});return{preferences:resolveInteractionPreferences(config),value:config??{}}},createDefinition:(d,l)=>({schema:createLinedupInteractionSchema({caseSensitive:d.case_insensitive!==true,sort:d.preserve_order!==true},l),run:i=>runLinedupInteraction(i)}),runPipe:legacyRunProgram,runGuide:runGuidedInteraction,runUi:runTerminalUi,loadScreen:async()=>(await import("./Tui.js")).LinedupTui,createPreferences:(_d,c)=>prefs(host,c),reexecEntrypoint:process.argv[1],help})}
function prefs(h:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:h.env,cwd:h.cwd};return{nodeId:"linedup",current,async save(v){const{config,path}=await loadXiraniteConfig(o);await saveXiraniteConfig(updateNodeConfig(config,"linedup",{cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}),{...o,configPath:path})},async restore(){const{config}=await loadNodeConfigWithHints<LinedupNodeConfig>("linedup",{...o,jsonMode:true}),p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

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
      writeLine(host, rich(host, `已从剪贴板读取 ${splitLines(clipboard).filter(Boolean).length} 行源文本。`, "yellow"))
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
  const sourceTextLines = splitLines(input.sourceText.replace(/\\n/g, "\n"))
  const filterTextLines = splitLines(input.filterText.replace(/\\n/g, "\n"))

  const sourceStats = analyzeReadLines(sourceTextLines)
  if (!sourceStats.totalLines) {
    writeRichPanel(input.host, "错误", "源文本为空，无法过滤。", { color: "red", minWidth: 48 })
    process.exitCode = 1
    return
  }
  reportReadStats(input.host, input.sourceLabel ?? "source", sourceStats)

  const filterStats = analyzeReadLines(filterTextLines)
  if (!filterStats.totalLines) {
    writeRichPanel(input.host, "错误", "过滤 token 为空，无法过滤。", { color: "red", minWidth: 48 })
    process.exitCode = 1
    return
  }
  reportReadStats(input.host, input.filterLabel ?? "filter", filterStats)

  writeLine(input.host, rich(input.host, "▸ 开始过滤...", "cyan"))

  const result = filterLines({
    sourceLines: sourceTextLines,
    filterLines: filterTextLines,
    caseSensitive: !input.caseInsensitive,
    sort: !input.preserveOrder,
  })
  const details = explainRemovals(sourceTextLines, filterTextLines)
  reportFilterStats(input.host, sourceStats, filterStats, details)

  const outputFile = input.outputFile?.trim() || undefined
  if (outputFile) {
    writeLine(input.host, rich(input.host, `▸ 正在写入输出文件: ${outputFile}...`, "green"))
    await writeFile(outputFile, `${result.filteredLines.join("\n")}\n`, "utf8")
  }

  writeRichPanel(input.host, "Summary", [
    `kept: ${result.keptCount}`,
    `removed: ${result.removedCount}`,
    outputFile ? `output: ${outputFile}` : "output: stdout",
  ], { color: "green", minWidth: 48 })

  writeLine(input.host, rich(input.host, `处理完成！共过滤出 ${result.keptCount} 个唯一行`, "green", "bold"))
  if (outputFile) {
    writeLine(input.host, rich(input.host, `结果已保存到: ${outputFile}`, "green"))
  } else {
    writeLine(input.host)
    writeLine(input.host, result.filteredLines.join("\n"))
  }
}

function reportReadStats(host: CliHost, label: string, stats: LinedupReadStats): void {
  writeLine(host, rich(host, `▸ 正在读取: ${label}...`, "cyan"))
  writeRichPanel(host, "读取统计", [
    `从 ${label} 读取到 ${stats.totalLines} 行 (去重后 ${stats.uniqueLines} 行)`,
  ], { color: "blue", minWidth: 56 })

  if (stats.duplicates.size) {
    const lines: string[] = []
    let index = 0
    for (const [line, count] of stats.duplicates) {
      if (index >= REMOVAL_DETAIL_LIMIT) {
        lines.push(`... 以及 ${stats.duplicates.size - index} 个其他重复行`)
        break
      }
      lines.push(`${truncateVisible(line, 60)}  出现 ${count} 次`)
      index += 1
    }
    writeRichPanel(host, "发现重复行", lines, { color: "red", minWidth: 56 })
  }
}

function reportFilterStats(
  host: CliHost,
  sourceStats: LinedupReadStats,
  filterStats: LinedupReadStats,
  details: ReturnType<typeof explainRemovals>,
): void {
  writeRichPanel(host, "过滤统计", [
    `源文件中共有 ${sourceStats.uniqueLines} 个唯一行`,
    `过滤文件中共有 ${filterStats.uniqueLines} 个唯一行`,
  ], { color: "cyan", minWidth: 56 })

  if (details.length) {
    for (let index = 0; index < Math.min(details.length, REMOVAL_DETAIL_LIMIT); index += 1) {
      const detail = details[index]!
      writeLine(host, `${rich(host, "移除行: ", "red")}${truncateVisible(detail.line, terminalColumns(host) - 24)}`)
      writeLine(host, `${rich(host, "  因为包含: ", "yellow")}${truncateVisible(detail.matchedFilter, terminalColumns(host) - 28)}`)
    }
    if (details.length > REMOVAL_DETAIL_LIMIT) {
      writeLine(host, rich(host, `... 以及 ${details.length - REMOVAL_DETAIL_LIMIT} 个其他被移除行`, "grey"))
    }
  }

  writeLine(host, rich(host, `被移除的行数: ${details.length}`, "red"))
  writeLine(host, rich(host, `保留的行数: ${sourceStats.uniqueLines - details.length}`, "green"))
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

  const result = filterLines({
    sourceLines: splitLines(sourceText),
    filterLines: splitLines(filterText),
    caseSensitive: !caseInsensitive,
    sort: !preserveOrder,
  })

  const outputFile = options.outputFile ?? defaults.outputFile
  if (outputFile) {
    await writeFile(outputFile, `${result.filteredLines.join("\n")}\n`, "utf8")
  }

  if (options.json) {
    writeLine(host, JSON.stringify(result, null, 2))
    return
  }

  writeLine(host, result.filteredLines.join("\n"))
  writeLine(host, `kept=${result.keptCount} removed=${result.removedCount}`)
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

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
