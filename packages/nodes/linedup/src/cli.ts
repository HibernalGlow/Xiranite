#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { canRunInteractiveCli, CliPromptExitError, defineCommand, nodeCliName, promptRich, rich, runMain, selectRich, writeError, writeLine, writeRichPanel } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import { filterLines, splitLines } from "./core.js"
import { readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("linedup")
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

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Filter source lines by removing any line containing a filter token.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
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
          await runFilter(args as FilterOptions, host)
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
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `filter --help` for scripted use.")
    process.exitCode = 2
    return
  }

  try {
    const preset = await detectPresetFiles(host.cwd)
    writeRichPanel(host, "Xiranite Linedup", [
      "移除 source 中包含 filter 任意 token 的行。",
      "默认兼容原版习惯：当前目录 source.txt + filter.txt -> output.txt。",
    ], { color: "blue", minWidth: 72 })
    writeLine(host)

    const mode = await selectRich<GuidedMode>(
      host,
      "选择 linedup 工作流",
      guidedModeOptions(preset),
      { initialValue: preset.available ? "preset-files" : "clipboard-source", maxItems: 5 },
    )

    if (mode === "exit") return

    const result = await runGuidedMode(mode, preset, host)

    writeRichPanel(host, "Summary", [
      `kept: ${result.keptCount}`,
      `removed: ${result.removedCount}`,
      result.outputFile ? `output: ${result.outputFile}` : "output: stdout",
    ], { color: "green", minWidth: 48 })
    if (!result.outputFile) writeLine(host, result.filteredLines.join("\n"))
  } catch (error) {
    if (error instanceof CliPromptExitError) {
      writeLine(host, rich(host, "Prompt cancelled.", "yellow"))
      return
    }
    throw error
  }
}

async function runFilter(options: FilterOptions, host: CliHost): Promise<void> {
  const sourceText = await readInput(options.source, options.sourceFile)
  const filterText = await readInput(options.filter, options.filterFile)

  if (!sourceText.trim()) {
    throw new Error("Missing source content. Use --source or --sourceFile, or run guided mode.")
  }

  const result = filterLines({
    sourceLines: splitLines(sourceText),
    filterLines: splitLines(filterText),
    caseSensitive: !options.caseInsensitive,
    sort: !options.preserveOrder,
  })

  if (options.outputFile) {
    await writeFile(options.outputFile, `${result.filteredLines.join("\n")}\n`, "utf8")
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

async function runGuidedMode(mode: GuidedMode, preset: GuidedPresetFiles, host: CliHost): Promise<Awaited<ReturnType<typeof runGuidedFilter>>> {
  if (mode === "preset-files") {
    return await runGuidedFilter({
      sourceFile: preset.sourceFile,
      filterFile: preset.filterFile,
      outputFile: preset.outputFile,
    })
  }

  if (mode === "custom-files") {
    const sourceFile = await promptRich(host, "Source file path", preset.sourceFile)
    const filterFile = await promptRich(host, "Filter file path", preset.filterFile)
    const outputFile = await promptRich(host, "Output file path", preset.outputFile)
    return await runGuidedFilter({ sourceFile, filterFile, outputFile })
  }

  if (mode === "clipboard-source") {
    const clipboard = await readClipboardText()
    const sourceText = clipboard || await promptRich(host, "Clipboard is empty. Paste source text with \\n for new lines", "")
    const filterText = await promptRich(host, "Filter token(s), use \\n for multiple lines", "")
    const outputFile = await promptRich(host, "Optional output file path", "")
    return await runGuidedText({ sourceText, filterText, outputFile })
  }

  const sourceText = await promptRich(host, "Source text, use \\n for multiple lines", "")
  const filterText = await promptRich(host, "Filter token(s), use \\n for multiple lines", "")
  const outputFile = await promptRich(host, "Optional output file path", "")
  return await runGuidedText({ sourceText, filterText, outputFile })
}

async function runGuidedFilter(options: { sourceFile: string; filterFile: string; outputFile?: string }) {
  const sourceText = await readFile(options.sourceFile, "utf8")
  const filterText = await readFile(options.filterFile, "utf8")
  const result = filterLines({
    sourceLines: splitLines(sourceText),
    filterLines: splitLines(filterText),
  })

  if (options.outputFile) {
    await writeFile(options.outputFile, `${result.filteredLines.join("\n")}\n`, "utf8")
  }

  return { ...result, outputFile: options.outputFile }
}

async function runGuidedText(options: { sourceText: string; filterText: string; outputFile?: string }) {
  const result = filterLines({
    sourceLines: splitLines(options.sourceText.replace(/\\n/g, "\n")),
    filterLines: splitLines(options.filterText.replace(/\\n/g, "\n")),
  })
  const outputFile = options.outputFile?.trim() || undefined
  if (outputFile) {
    await writeFile(outputFile, `${result.filteredLines.join("\n")}\n`, "utf8")
  }
  return { ...result, outputFile }
}

interface GuidedPresetFiles {
  sourceFile: string
  filterFile: string
  outputFile: string
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

async function detectPresetFiles(cwd: string): Promise<GuidedPresetFiles> {
  const preset = {
    sourceFile: join(cwd, "source.txt"),
    filterFile: join(cwd, "filter.txt"),
    outputFile: join(cwd, "output.txt"),
  }
  return {
    ...preset,
    available: await isFile(preset.sourceFile) && await isFile(preset.filterFile),
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
