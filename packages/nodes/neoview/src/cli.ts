#!/usr/bin/env node
import { open, readFile, rm, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { CliUsageError, createCliHost, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type {
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  ReaderHeadlessController,
} from "./core.js"
import { help } from "./help.js"
import { createReaderHeadlessController } from "./platform.js"

const CLI_NAME = "xneoview"
const COMMANDS = new Set(["inspect", "pages", "frame", "extract-page", "settings-inspect", "settings-import"])
const VALUE_FLAGS = new Set([
  "--entry",
  "--index",
  "--cursor",
  "--limit",
  "--output",
  "--password-env",
  "--archive-password-env",
  "--config",
  "--strategy",
  "--modules",
])
const BOOLEAN_FLAGS = new Set(["--json", "--force", "--yes"])
const MAX_SETTINGS_BYTES = 64 * 1024 * 1024

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "High-performance image and comic reader.",
  run: (args, host) => runProgram(args, host),
}

export interface NeoviewCliDependencies {
  createController: () => Promise<ReaderHeadlessController>
}

const DEFAULT_DEPENDENCIES: NeoviewCliDependencies = {
  createController: createReaderHeadlessController,
}

export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createCliHost(),
  dependencies: NeoviewCliDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const command = args[0]
  if (!command) {
    if (host.stdin.isTTY && host.stdout.isTTY) await runReaderUi([], host)
    else writeLine(host, formatCliHelp())
    return
  }
  if (command === "help" || command === "--help" || command === "-h") {
    writeLine(host, formatCliHelp())
    return
  }
  if (command === "ui") {
    await runReaderUi(args.slice(1), host)
    return
  }
  if (!COMMANDS.has(command)) throw usage(`Unknown NeoView command: ${command}`)

  const parsed = parseArguments(args.slice(1))
  validateCommandOptions(command, parsed)
  const path = parsed.positionals[0]
  if (!path || parsed.positionals.length !== 1) {
    const kind = command.startsWith("settings-") ? "settings JSON path" : "book path"
    throw usage(`${command} requires exactly one ${kind}.`)
  }
  if (command.startsWith("settings-")) {
    await runSettingsCommand(command, resolve(host.cwd, path), parsed, host)
    return
  }
  const index = integerOption(parsed, "--index", 0, Number.MAX_SAFE_INTEGER, 0)
  const credentials = credentialsFromEnvironment(parsed, host)
  let controller: ReaderHeadlessController | undefined
  try {
    controller = await dependencies.createController()
    const snapshot = await controller.open({
      path: resolve(host.cwd, path),
      entryPaths: parsed.values.get("--entry"),
      archivePasswords: credentials.inputs,
      initialPage: index,
    })
    if (command === "inspect") return printInspect(snapshot, parsed.booleans.has("--json"), host)
    if (command === "frame") return printFrame(snapshot, parsed.booleans.has("--json"), host)
    if (command === "pages") {
      const cursor = integerOption(parsed, "--cursor", 0, snapshot.book.pageCount, 0)
      const limit = integerOption(parsed, "--limit", 1, 500, 100)
      return printPages(controller.listPages(cursor, limit), cursor, snapshot.book.pageCount, parsed.booleans.has("--json"), host)
    }
    if (parsed.booleans.has("--json")) throw usage("extract-page does not support --json because its output is binary.")
    const output = oneValue(parsed, "--output")
    if (!output) throw usage("extract-page requires --output <path|->.")
    await extractPage(controller, index, output, parsed.booleans.has("--force"), host)
  } finally {
    credentials.clear()
    await controller?.[Symbol.asyncDispose]()
  }
}

function validateCommandOptions(command: string, parsed: ParsedArguments): void {
  if (command === "settings-inspect") {
    rejectOptions(parsed, new Set(["--json", "--modules"]))
    return
  }
  if (command === "settings-import") {
    rejectOptions(parsed, new Set(["--json", "--yes", "--config", "--strategy", "--modules"]))
    return
  }
  for (const option of ["--config", "--strategy", "--yes"]) {
    if (parsed.values.has(option) || parsed.booleans.has(option)) throw usage(`${command} does not accept ${option}.`)
  }
}

function rejectOptions(parsed: ParsedArguments, allowed: ReadonlySet<string>): void {
  for (const option of parsed.values.keys()) {
    if (!allowed.has(option)) throw usage(`Settings command does not accept ${option}.`)
  }
  for (const option of parsed.booleans) {
    if (!allowed.has(option)) throw usage(`Settings command does not accept ${option}.`)
  }
}

interface ParsedArguments {
  positionals: string[]
  values: Map<string, string[]>
  booleans: Set<string>
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = { positionals: [], values: new Map(), booleans: new Set() }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (!arg.startsWith("-")) {
      parsed.positionals.push(arg)
      continue
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      if (parsed.booleans.has(arg)) throw usage(`Duplicate flag: ${arg}`)
      parsed.booleans.add(arg)
      continue
    }
    if (!VALUE_FLAGS.has(arg)) throw usage(`Unknown NeoView option: ${arg}`)
    const value = args[index + 1]
    if (!value || value.startsWith("--")) throw usage(`${arg} requires a value.`)
    const list = parsed.values.get(arg) ?? []
    list.push(value)
    parsed.values.set(arg, list)
    index += 1
  }
  return parsed
}

function credentialsFromEnvironment(parsed: ParsedArguments, host: CliHost): {
  inputs: { entryPaths?: readonly string[]; rawPassword: Uint8Array }[] | undefined
  clear: () => void
} {
  const inputs: { entryPaths?: readonly string[]; rawPassword: Uint8Array }[] = []
  const clear = () => {
    for (const input of inputs) input.rawPassword.fill(0)
  }
  try {
    const rootVariables = parsed.values.get("--password-env") ?? []
    if (rootVariables.length > 1) throw usage("--password-env can only be specified once.")
    if (rootVariables[0]) inputs.push({ rawPassword: passwordBytes(rootVariables[0], host) })
    for (const value of parsed.values.get("--archive-password-env") ?? []) {
      const separator = value.lastIndexOf("=")
      if (separator <= 0 || separator === value.length - 1) {
        throw usage("--archive-password-env requires entry.cbz::nested.cbz=ENV_NAME.")
      }
      const entryPaths = value.slice(0, separator).split("::")
      if (entryPaths.some((entry) => !entry.trim())) throw usage("Archive password scopes cannot contain empty entry paths.")
      inputs.push({ entryPaths, rawPassword: passwordBytes(value.slice(separator + 1), host) })
    }
  } catch (error) {
    clear()
    throw error
  }
  return {
    inputs: inputs.length ? inputs : undefined,
    clear,
  }
}

function passwordBytes(variable: string, host: CliHost): Uint8Array {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw usage(`Invalid password environment variable name: ${variable}`)
  const value = host.env[variable]
  if (!value) throw usage(`Password environment variable is missing or empty: ${variable}`)
  return new TextEncoder().encode(value)
}

function printInspect(snapshot: HeadlessReaderSnapshot, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, snapshot)
  writeLine(host, `${snapshot.book.displayName}: ${snapshot.book.pageCount} page(s)`)
  writeLine(host, frameLine(snapshot))
  for (const page of snapshot.visiblePages) writeLine(host, pageLine(page))
}

function printFrame(snapshot: HeadlessReaderSnapshot, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, { frame: snapshot.frame, visiblePages: snapshot.visiblePages })
  writeLine(host, frameLine(snapshot))
  for (const page of snapshot.visiblePages) writeLine(host, pageLine(page))
}

function printPages(pages: readonly HeadlessReaderPageSnapshot[], cursor: number, total: number, json: boolean, host: CliHost): void {
  if (json) return writeJson(host, { pages, cursor, nextCursor: cursor + pages.length < total ? cursor + pages.length : undefined, total })
  for (const page of pages) writeLine(host, pageLine(page))
  writeLine(host, `${pages.length} of ${total} page(s)`)
}

function frameLine(snapshot: HeadlessReaderSnapshot): string {
  const indices = snapshot.visiblePages.map((page) => page.index + 1).join(", ") || "empty"
  return `Frame ${indices} / ${snapshot.book.pageCount}`
}

function pageLine(page: HeadlessReaderPageSnapshot): string {
  const size = page.dimensions ? ` ${page.dimensions.width}x${page.dimensions.height}` : ""
  const bytes = page.byteLength === undefined ? "" : ` ${page.byteLength} bytes`
  return `${String(page.index + 1).padStart(5)}  ${page.name}  ${page.mediaKind}${size}${bytes}`
}

async function extractPage(
  controller: ReaderHeadlessController,
  pageIndex: number,
  output: string,
  force: boolean,
  host: CliHost,
): Promise<void> {
  const page = await controller.openPageStream(pageIndex)
  try {
    if (output === "-") {
      await writeBinaryStdout(page.stream, host)
      return
    }
    const outputPath = resolve(host.cwd, output)
    const handle = await open(outputPath, force ? "w" : "wx")
    let complete = false
    try {
      const writable = handle.createWriteStream()
      for await (const chunk of page.stream) {
        if (!writable.write(chunk)) await new Promise<void>((resolveDrain) => writable.once("drain", resolveDrain))
      }
      await new Promise<void>((resolveEnd, rejectEnd) => writable.end((error?: Error | null) => error ? rejectEnd(error) : resolveEnd()))
      complete = true
    } finally {
      await handle.close().catch(() => undefined)
      if (!complete) await rm(outputPath, { force: true }).catch(() => undefined)
    }
  } finally {
    await page.close()
  }
}

async function writeBinaryStdout(stream: ReadableStream<Uint8Array>, host: CliHost): Promise<void> {
  const output = host.stdout as CliHost["stdout"] & { once?: (event: "drain", listener: () => void) => unknown }
  for await (const chunk of stream) {
    const ready = output.write(chunk as unknown as string)
    if (ready === false && output.once) await new Promise<void>((resolveDrain) => output.once!("drain", resolveDrain))
  }
}

async function runSettingsCommand(
  command: string,
  inputPath: string,
  parsed: ParsedArguments,
  host: CliHost,
): Promise<void> {
  const inputStat = await stat(inputPath)
  if (!inputStat.isFile()) throw usage(`Settings input is not a file: ${inputPath}`)
  if (inputStat.size > MAX_SETTINGS_BYTES) throw usage(`Settings input exceeds ${MAX_SETTINGS_BYTES} bytes.`)
  const content = await readFile(inputPath, "utf8")
  const { LegacySettingsCodec, LEGACY_SETTINGS_MODULES } = await import("./migration/LegacySettingsCodec.js")
  const moduleOption = oneValue(parsed, "--modules")
  const modules = moduleOption?.split(",").map((value) => value.trim()).filter(Boolean)
  if (modules?.length === 0) throw usage("--modules requires at least one module name.")
  const knownModules = new Set<string>(LEGACY_SETTINGS_MODULES)
  const invalidModules = modules?.filter((module) => !knownModules.has(module)) ?? []
  if (invalidModules.length) throw usage(`Unknown settings module(s): ${invalidModules.join(", ")}.`)
  const decoded = new LegacySettingsCodec().decode(content, {
    modules: modules as import("./migration/LegacySettingsCodec.js").LegacySettingsModule[] | undefined,
  })

  if (command === "settings-inspect") {
    printSettingsPreview(decoded, parsed.booleans.has("--json"), host)
    return
  }

  if (!parsed.booleans.has("--yes")) {
    throw usage("settings-import requires --yes after reviewing settings-inspect output.")
  }
  const strategy = oneValue(parsed, "--strategy") ?? "merge"
  if (strategy !== "merge" && strategy !== "overwrite") throw usage("--strategy must be merge or overwrite.")
  const configPath = oneValue(parsed, "--config")
  const { commitNeoviewConfig } = await import("./platform/config/NeoviewConfigStore.js")
  const committed = await commitNeoviewConfig(decoded.configPatch, {
    configPath,
    cwd: host.cwd,
    env: host.env,
    strategy,
  })
  const output = {
    ...decoded.report,
    configPath: committed.configPath,
    backupPath: committed.backupPath,
    changed: committed.changed,
    strategy,
  }
  if (parsed.booleans.has("--json")) writeJson(host, output)
  else {
    writeLine(host, `NeoView settings ${committed.changed ? "imported" : "already up to date"}: ${committed.configPath}`)
    if (committed.backupPath) writeLine(host, `Backup: ${committed.backupPath}`)
    printSettingsSummary(decoded.report.summary, decoded.report.fullyRecognized, host)
  }
}

function printSettingsPreview(
  decoded: import("./migration/LegacySettingsCodec.js").DecodedLegacySettings,
  json: boolean,
  host: CliHost,
): void {
  if (json) {
    writeJson(host, { report: decoded.report, configPatch: decoded.configPatch })
    return
  }
  writeLine(host, `NeoView settings source: ${decoded.report.sourceKind}${decoded.report.sourceVersion ? ` ${decoded.report.sourceVersion}` : ""}`)
  for (const entry of decoded.report.entries) {
    writeLine(host, `${entry.disposition.padEnd(18)} ${entry.sourcePath}${entry.targetPath ? ` -> ${entry.targetPath}` : ""}`)
  }
  printSettingsSummary(decoded.report.summary, decoded.report.fullyRecognized, host)
}

function printSettingsSummary(
  summary: import("./migration/LegacySettingsCodec.js").LegacySettingsMigrationReport["summary"],
  fullyRecognized: boolean,
  host: CliHost,
): void {
  writeLine(host, Object.entries(summary).map(([key, count]) => `${key}=${count}`).join(" "))
  writeLine(host, fullyRecognized ? "All supplied settings were recognized." : "Review unresolved settings before final migration acceptance.")
}

function integerOption(parsed: ParsedArguments, flag: string, minimum: number, maximum: number, fallback: number): number {
  const value = oneValue(parsed, flag)
  if (value === undefined) return fallback
  const parsedValue = Number(value)
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    throw usage(`${flag} must be an integer from ${minimum} to ${maximum}.`)
  }
  return parsedValue
}

function oneValue(parsed: ParsedArguments, flag: string): string | undefined {
  const values = parsed.values.get(flag)
  if (!values?.length) return undefined
  if (values.length > 1) throw usage(`${flag} can only be specified once.`)
  return values[0]
}

async function runReaderUi(args: readonly string[], host: CliHost): Promise<void> {
  if (!host.stdin.isTTY || !host.stdout.isTTY) throw usage("NeoView ui requires an interactive terminal.")
  const { resolveTerminalUiFlags } = await import("@xiranite/cli-runtime/interaction")
  const flags = resolveTerminalUiFlags(args, { language: "zh", renderer: "opentui", theme: "nord" })
  if (flags.error || flags.args.length || !flags.language || !flags.renderer) {
    throw usage(flags.error ?? `Unknown ui argument: ${flags.args[0]}`)
  }
  const { listTerminalThemes, runTerminalUi } = await import("@xiranite/cli-runtime/terminal")
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    throw usage(`Unknown terminal theme: ${flags.theme}.`)
  }
  const { createNeoviewTuiDefinition } = await import("./interaction.js")
  await runTerminalUi(createNeoviewTuiDefinition(flags.language), {
    host,
    language: flags.language,
    renderer: flags.renderer,
    theme: flags.theme,
    loadScreen: async () => (await import("./Tui.js")).NeoviewTui,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args: ["ui", ...args] } : undefined,
  })
}

function usage(message: string): CliUsageError {
  return new CliUsageError(`${message}\n\n${formatCliHelp()}`)
}

function formatCliHelp(): string {
  return [
    "xneoview <command> <path> [options]",
    "",
    "Commands:",
    "  inspect <path>       Show book and current-frame metadata",
    "  pages <path>         List a bounded page window",
    "  frame <path>         Show the frame at --index",
    "  extract-page <path>  Stream the original page to --output <path|->",
    "  settings-inspect <json>  Preview a legacy settings migration",
    "  settings-import <json>   Import legacy settings into [nodes.neoview] TOML",
    "  ui                   Open the persistent terminal reader",
    "",
    "Options:",
    "  --index N            Zero-based page index",
    "  --cursor N           Page-list cursor",
    "  --limit N            Page-list limit (1..500)",
    "  --entry PATH         Repeat for each nested archive entry",
    "  --password-env VAR   Read the root archive password from VAR",
    "  --archive-password-env SCOPE=VAR  Scoped nested password; join scope with ::",
    "  --json               Structured metadata output",
    "  --force              Replace an existing extract output",
    "  --config PATH        Xiranite TOML path for settings-import",
    "  --strategy MODE      Settings import mode: merge or overwrite",
    "  --modules LIST       Comma-separated settings modules:",
    "                       native-settings,keybindings,emm,file-browser,ui,panels,bookmarks,history,",
    "                       search-history,upscale,performance,folder-ratings,voice-control",
    "  --yes                Confirm settings-import after preview",
  ].join("\n")
}

if (process.argv[1] && /\bcli\.[cm]?[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const host = createCliHost()
  try {
    await runProgram(process.argv.slice(2), host)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = error instanceof CliUsageError ? error.exitCode : 1
  }
}

export { help }
