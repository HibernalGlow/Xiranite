#!/usr/bin/env node
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  defineCommand,
  nodeCliName,
  renderProgressBar,
  rich,
  runMain,
  terminalColumns,
  truncateVisible,
  visibleWidth,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { runLataTaskSelector } from "@xiranite/node-lata/cli"
import type { RepackuAction, RepackuInput, RepackuOperation, RepackuResult } from "./core.js"
import { runRepacku } from "./core.js"
import { createNodeRepackuRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("repacku")


interface RepackuCliOptions {
  path?: string
  paths?: string
  config?: string
  configPath?: string
  types?: string
  output?: string
  outputPath?: string
  clipboard?: boolean
  deleteAfter?: boolean
  dryRun?: boolean
  gallery?: boolean
  json?: boolean
  minCount?: string | number
  galleryMarker?: string
  single?: boolean
}


function createRepackuTaskfile(): string {
  return `# Taskfile for repacku
version: '3'

vars:
  PYTHON_CMD: ${CLI_NAME}

tasks:
  default:
    desc: 显示所有任务
    cmds:
      - task --list
    silent: true

  image-only:
    desc: "仅针对图片类型(默认示例) 从剪贴板读取路径"
    cmds:
      - "{{.PYTHON_CMD}} compress --clipboard --types image --delete-after {{.CLI_ARGS}}"

  gallery-pack:
    desc: "画集模式 (.画集 目录批量处理)"
    cmds:
      - "{{.PYTHON_CMD}} compress --clipboard --gallery --delete-after {{.CLI_ARGS}}"

  gallery-and-single:
    desc: "先画集再单层 (可并用)"
    cmds:
      - "{{.PYTHON_CMD}} compress --clipboard --gallery --single --delete-after {{.CLI_ARGS}}"

  single-pack:
    desc: "单层打包 (子目录+散图)"
    cmds:
      - "{{.PYTHON_CMD}} compress --clipboard --single --delete-after {{.CLI_ARGS}}"
`
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Analyze folder trees and repack folders into zip archives.",
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
    meta: { name: CLI_NAME, description: "Folder repacking workflow with rich guided Taskfile mode." },
    subCommands: {
      analyze: defineCommand({
        meta: { name: "analyze", description: "Analyze a folder and write a repacku config JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("analyze", args as RepackuCliOptions, host)
        },
      }),
      compress: defineCommand({
        meta: { name: "compress", description: "Compress from an existing config, or run gallery/single pack modes." },
        args: commonArgs(),
        async run({ args }) {
          await runCompressCommand(args as RepackuCliOptions, host)
        },
      }),
      full: defineCommand({
        meta: { name: "full", description: "Analyze and then compress in one flow." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("full", args as RepackuCliOptions, host)
        },
      }),
      "single-pack": defineCommand({
        meta: { name: "single-pack", description: "Pack first-level child folders and loose image files." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("single-pack", args as RepackuCliOptions, host)
        },
      }),
      "gallery-pack": defineCommand({
        meta: { name: "gallery-pack", description: "Find gallery folders and run single-pack in each one." },
        args: commonArgs(),
        async run({ args }) {
          await runSingleAction("gallery-pack", args as RepackuCliOptions, host)
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Open the rich Taskfile selector." },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

function commonArgs() {
  return {
    path: { type: "string", description: "Folder path." },
    paths: { type: "string", description: "Comma, semicolon, or newline separated folder paths." },
    config: { type: "string", description: "Config JSON path." },
    configPath: { type: "string", description: "Config JSON path." },
    types: { type: "string", description: "Target file types, comma separated, for example image,document." },
    output: { type: "string", description: "Config output path." },
    outputPath: { type: "string", description: "Config output path." },
    clipboard: { type: "boolean", description: "Read folder path from clipboard when --path is omitted." },
    deleteAfter: { type: "boolean", description: "Delete source files after successful compression." },
    dryRun: { type: "boolean", description: "Plan operations without writing archives." },
    gallery: { type: "boolean", description: "Compatibility alias for gallery-pack under compress." },
    single: { type: "boolean", description: "Compatibility alias for single-pack under compress." },
    minCount: { type: "string", description: "Minimum matching direct files before compression." },
    galleryMarker: { type: "string", description: "Folder name marker used by gallery-pack." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function runGuided(host: CliHost): Promise<void> {
  const packageDir = dirname(fileURLToPath(import.meta.url))
  await runLataTaskSelector(host, {
    cwd: packageDir,
    taskfilePath: join(packageDir, "Taskfile.yml"),
    taskfileContent: createRepackuTaskfile(),
    title: "Xiranite Repacku",
  })
}

async function runSingleAction(action: RepackuAction, args: RepackuCliOptions, host: CliHost): Promise<boolean> {
  const input = await inputFromArgs(args)
  return await runActions([{ action, ...input }], Boolean(args.json), host)
}

async function runCompressCommand(args: RepackuCliOptions, host: CliHost): Promise<boolean> {
  const input = await inputFromArgs(args)
  const actions: RepackuAction[] = []
  if (args.gallery) actions.push("gallery-pack")
  if (args.single) actions.push("single-pack")
  if (!actions.length) actions.push("compress")
  return await runActions(actions.map((action) => ({ action, ...input })), Boolean(args.json), host)
}

async function inputFromArgs(args: RepackuCliOptions): Promise<Omit<RepackuInput, "action">> {
  let paths = splitPaths(args.paths, args.path ? [args.path] : [])
  if (args.clipboard && !paths.length) {
    paths = await pathsFromClipboard()
  }

  return {
    paths,
    configPath: args.configPath || args.config,
    types: args.types,
    outputPath: args.outputPath || args.output,
    deleteAfter: args.deleteAfter,
    dryRun: args.dryRun,
    minCount: numberArg(args.minCount),
    galleryMarker: args.galleryMarker,
  }
}

async function runActions(inputs: RepackuInput[], json: boolean, host: CliHost): Promise<boolean> {
  if (json && inputs.length > 1) {
    const results = await Promise.all(inputs.map((input) => runRepacku(input, createNodeRepackuRuntime())))
    writeJson(host, results)
    if (results.some((result) => !result.success)) process.exitCode = 1
    return results.every((result) => result.success)
  }

  let ok = true
  for (const input of inputs) {
    const result = await runAction(input, json, host)
    ok = ok && result.success
    if (!result.success) break
  }
  return ok
}

async function runAction(input: RepackuInput, json: boolean, host: CliHost): Promise<RepackuResult> {
  let progressActive = false
  const result = await runRepacku(input, createNodeRepackuRuntime(), (event) => {
    if (json) return
    if (event.type === "progress") {
      writeProgress(host, renderProgressBar(host, event.progress ?? 0, event.message, { label: "repacku" }))
      progressActive = true
      return
    }
    endProgress(host, progressActive)
    progressActive = false
    if (event.message.trim()) writeLine(host, rich(host, event.message, "grey"))
  })
  endProgress(host, progressActive)

  if (json) {
    writeJson(host, result)
    return result
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  const data = result.data
  if (data) {
    writeRichPanel(host, "Summary", [
      data.configPath ? `config: ${data.configPath}` : "",
      `folders: ${data.totalFolders}  entire: ${data.entireCount}  selective: ${data.selectiveCount}  skip: ${data.skipCount}`,
      `operations: ${data.totalOperations}  planned: ${data.plannedCount}  compressed: ${data.compressedCount}  failed: ${data.failedCount}  skipped: ${data.skippedCount}`,
    ].filter(Boolean), { color: result.success ? "green" : "yellow", minWidth: 76 })
    for (const operation of data.operations.slice(0, 80)) writeLine(host, formatOperation(operation, host))
    if (data.operations.length > 80) writeLine(host, rich(host, `... ${data.operations.length - 80} more operation(s)`, "grey"))
    if (data.errors.length) writeRichPanel(host, "Error", data.errors.join("\n"), { color: "red", minWidth: 76 })
  }
  if (!result.success) process.exitCode = 1
  return result
}

async function pathsFromClipboard(): Promise<string[]> {
  const text = await readClipboardText()
  if (!text) return []
  const runtime = createNodeRepackuRuntime()
  const paths: string[] = []
  for (const candidate of splitPaths(text)) {
    const info = await runtime.pathInfo(candidate)
    if (info.exists) paths.push(info.path)
  }
  return paths
}

function splitPaths(value?: string, seed: string[] = []): string[] {
  return [...seed, ...(value ?? "").split(/[,;\r\n]/)]
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
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

function formatOperation(operation: RepackuOperation, host: CliHost): string {
  const extensions = operation.extensions.length ? ` [${operation.extensions.join(",")}]` : ""
  const status = operation.status === "success"
    ? rich(host, "success", "green")
    : operation.status === "error"
      ? rich(host, "error", "red")
      : operation.status === "skipped"
        ? rich(host, "skipped", "yellow")
        : rich(host, "planned", "cyan")
  const mode = rich(host, operation.mode, operation.mode === "entire" ? "blue" : "magenta")
  if (!host.stdout.isTTY) return `${status} ${mode}${extensions} ${operation.sourcePath} ${rich(host, "->", "grey")} ${operation.targetPath}`

  const prefix = `${status} ${mode}${extensions} `
  const arrow = ` ${rich(host, "->", "grey")} `
  const pathBudget = Math.max(0, terminalColumns(host) - visibleWidth(prefix) - visibleWidth(arrow))
  if (pathBudget < 20) return `${prefix}${truncateVisible(operation.sourcePath, pathBudget)}`

  const sourceWidth = Math.max(8, Math.floor(pathBudget * 0.48))
  const targetWidth = Math.max(0, pathBudget - sourceWidth)
  return `${prefix}${truncateVisible(operation.sourcePath, sourceWidth)}${arrow}${truncateVisible(operation.targetPath, targetWidth)}`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
