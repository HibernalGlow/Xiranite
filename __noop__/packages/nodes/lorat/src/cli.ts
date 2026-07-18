#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import {
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
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
  runGuidedInteraction,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, loadXiraniteConfig, saveXiraniteConfig, updateNodeConfig } from "@xiranite/config"
import type { LoratAction, LoratInput, LoratResult, LoratRow, LoratStatusFilter } from "./core.js"
import { DEFAULT_LORA_FOLDER, collectTriggerDb, filterLoratRows, parseTriggerDb, runLorat, summarizeLoratRows } from "./core.js"
import { createNodeLoratRuntime, readClipboardText, readTextFile, writeTextFile } from "./platform.js"
import { createLoratInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("lorat")

interface LoratCliOptions {
  folder?: string
  db?: string
  dbFile?: string
  rows?: string
  rowsFile?: string
  keys?: string
  status?: LoratStatusFilter
  search?: string
  output?: string
  json?: boolean
}

interface LoratNodeConfig extends CliInteractionPreferencesSource {
  lora_folder?: string
  status_filter?: string
  search?: string
}

interface LoratDefaults {
  loraFolder?: string
  statusFilter?: LoratStatusFilter
  search?: string
}

/**
 * Resolve lorat defaults from xiranite.config.toml [nodes.lorat].
 */
async function resolveLoratDefaults(host: CliHost, json = false): Promise<LoratDefaults> {
  try {
    const { config } = await loadNodeConfigWithHints<LoratNodeConfig>("lorat", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    return {
      loraFolder: config?.lora_folder,
      statusFilter: normalizeStatus(config?.status_filter),
      search: config?.search,
    }
  } catch {
    return {}
  }
}

type GuidedSelection = "scan" | "write-missing" | "export-db" | "exit"

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "LoRA trigger sidecar and TriggerDB manager.",
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
  await runInteractionCli({
    args,
    host,
    cliName: CLI_NAME,
    loadContext: async () => {
      const { config } = await loadNodeConfigWithHints<LoratNodeConfig>("lorat", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true })
      return { preferences: resolveInteractionPreferences(config), value: config ?? {} }
    },
    createDefinition: (defaults, language) => ({
      schema: createLoratInteractionSchema({
        folderPath: defaults.lora_folder,
        search: defaults.search,
        statusFilter: normalizeStatus(defaults.status_filter),
      }, language),
      run: (input, event) => runLorat(input, createNodeLoratRuntime(), event),
    }),
    runPipe: legacyRunProgram,
    runGuide: runGuidedInteraction,
    runUi: runTerminalUi,
    loadScreen: async () => (await import("./Tui.js")).LoratTui,
    createPreferences: (_defaults, current) => loratPreferences(host, current),
    reexecEntrypoint: process.argv[1],
    help,
  })
}

function loratPreferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return {
    nodeId: "lorat",
    current,
    async save(values) {
      const { config, path } = await loadXiraniteConfig(options)
      await saveXiraniteConfig(updateNodeConfig(config, "lorat", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }), { ...options, configPath: path })
    },
    async restore() {
      const { config } = await loadNodeConfigWithHints<LoratNodeConfig>("lorat", { ...options, jsonMode: true })
      const preferences = resolveInteractionPreferences(config)
      return { theme: preferences.theme, defaultMode: preferences.mode, language: preferences.language ?? "zh" }
    },
  }
}

function createDefaultHost(): CliHost {
  return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "LoRA trigger sidecar and TriggerDB manager." },
    subCommands: {
      scan: defineCommand({
        meta: { name: "scan", description: "Scan a LoRA folder and infer trigger rows." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLoratArgs(args as LoratCliOptions, host)
          const defaults = await resolveLoratDefaults(host, Boolean(opts.json))
          await runAction(await inputFromArgs("scan", opts, defaults), Boolean(opts.json), host)
        },
      }),
      "apply-db": defineCommand({
        meta: { name: "apply-db", description: "Apply TriggerDB JSON to existing rows JSON." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLoratArgs(args as LoratCliOptions, host)
          const defaults = await resolveLoratDefaults(host, Boolean(opts.json))
          await runAction(await inputFromArgs("apply_db", opts, defaults), Boolean(opts.json), host)
        },
      }),
      write: defineCommand({
        meta: { name: "write", description: "Write selected rows as .trigger.txt sidecars." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLoratArgs(args as LoratCliOptions, host)
          const defaults = await resolveLoratDefaults(host, Boolean(opts.json))
          await runAction(await inputFromArgs("write_triggers", opts, defaults), Boolean(opts.json), host)
        },
      }),
      "no-trigger": defineCommand({
        meta: { name: "no-trigger", description: "Write selected rows as .notrigger.txt sidecars." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLoratArgs(args as LoratCliOptions, host)
          const defaults = await resolveLoratDefaults(host, Boolean(opts.json))
          await runAction(await inputFromArgs("mark_no_trigger", opts, defaults), Boolean(opts.json), host)
        },
      }),
      "export-db": defineCommand({
        meta: { name: "export-db", description: "Export rows to TriggerDB JSON." },
        args: commonArgs(),
        async run({ args }) {
          const opts = await resolveLoratArgs(args as LoratCliOptions, host)
          const defaults = await resolveLoratDefaults(host, Boolean(opts.json))
          const result = await runAction(await inputFromArgs("export_db", opts, defaults), Boolean(opts.json), host)
          const output = opts.output
          if (output && result.success) await writeTextFile(output, result.data?.triggerDbJson ?? "{}\n")
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Open the guided terminal workflow." },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

function commonArgs() {
  return {
    folder: { type: "string", description: "LoRA folder path." },
    db: { type: "string", description: "Inline TriggerDB JSON." },
    dbFile: { type: "string", description: "TriggerDB JSON file." },
    rows: { type: "string", description: "Inline rows JSON." },
    rowsFile: { type: "string", description: "Rows JSON file from a previous scan." },
    keys: { type: "string", description: "Comma-separated row keys to write." },
    status: { type: "string", description: "Filter rows by status: all, missing, trigger, notrigger." },
    search: { type: "string", description: "Filter rows by name, path, or trigger text." },
    output: { type: "string", description: "Output file for export-db." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

async function resolveLoratArgs(args: LoratCliOptions, host: CliHost): Promise<LoratCliOptions> {
  if (!(args.folder === "-" || (!args.folder && hasPipedInput(host.stdin) && Symbol.asyncIterator in Object(host.stdin)))) return args
  const stdinLine = (await readStdinLines(host.stdin))[0] ?? ""
  return { ...args, folder: stdinLine }
}

async function inputFromArgs(action: LoratAction, args: LoratCliOptions, defaults: LoratDefaults = {}): Promise<LoratInput> {
  const triggerDbJson = args.db ?? await readTextFile(args.dbFile)
  const rows = parseRows(args.rows ?? await readTextFile(args.rowsFile))
  return {
    action,
    folderPath: args.folder ?? defaults.loraFolder,
    triggerDbJson,
    rows,
    selectedKeys: splitKeys(args.keys),
    statusFilter: normalizeStatus(args.status) ?? defaults.statusFilter,
    search: args.search ?? defaults.search,
  }
}

async function runAction(input: LoratInput, json: boolean, host: CliHost): Promise<LoratResult> {
  let progressActive = false
  const result = await runLorat(input, createNodeLoratRuntime(), (event) => {
    if (json) return
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

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return result
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeLoratSummary(host, result, input)
  if (!result.success) process.exitCode = 1
  return result
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} scan --folder <path> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  try {
    const defaults = await resolveLoratDefaults(host)
    const clipboard = cleanPath(await readClipboardText())
    const folder = await promptRich(host, "LoRA folder", clipboard || defaults.loraFolder || DEFAULT_LORA_FOLDER)
    const choice = await selectRich<GuidedSelection>(
      host,
      "Lorat action",
      [
        { value: "scan", label: "scan", hint: "scan and preview inferred triggers" },
        { value: "write-missing", label: "write missing", hint: "scan, then write inferred triggers for missing rows" },
        { value: "export-db", label: "export db", hint: "scan, then export TriggerDB JSON" },
        { value: "exit", label: "exit", hint: "leave guided mode" },
      ],
      { initialValue: "scan", maxItems: 4 },
    )
    if (choice === "exit") return

    const scan = await runAction({ action: "scan", folderPath: folder, search: defaults.search, statusFilter: defaults.statusFilter }, false, host)
    if (!scan.success || !scan.data) return
    if (choice === "scan") return

    if (choice === "write-missing") {
      const rows = scan.data.rows.filter((row) => row.status === "missing").map((row) => ({ ...row, selected: true }))
      if (!rows.length) {
        writeLine(host, rich(host, "No missing rows to write.", "yellow"))
        return
      }
      const ok = await confirmRich(host, `Write inferred triggers for ${rows.length} missing row(s)?`, false)
      if (ok) await runAction({ action: "write_triggers", folderPath: folder, rows, search: defaults.search, statusFilter: defaults.statusFilter }, false, host)
      return
    }

    const db = collectTriggerDb(scan.data.rows)
    const output = await promptRich(host, "Output TriggerDB JSON path", "lora-triggers.generated.json")
    await writeTextFile(output, `${JSON.stringify(db, null, 2)}\n`)
    writeLine(host, rich(host, `Saved ${output}`, "green"))
  } catch (error) {
    if (error instanceof CliPromptExitError) return
    throw error
  }
}

function writeLoratSummary(host: CliHost, result: LoratResult, input: LoratInput): void {
  const data = result.data
  if (!data) return
  const stats = data.stats
  writeRichPanel(host, "Lorat", [
    `folder: ${truncateVisible(data.folderPath || input.folderPath || DEFAULT_LORA_FOLDER, Math.max(20, terminalColumns(host) - 12))}`,
    `total ${stats.total} / missing ${stats.missing} / trigger ${stats.trigger} / notrigger ${stats.notrigger}`,
    `changed ${stats.changed} / selected ${stats.selected} / db ${stats.dbMatched}`,
    data.writtenCount ? `written: ${data.writtenCount}` : "",
    data.errors.length ? `errors: ${data.errors.length}` : "",
  ].filter(Boolean), { color: result.success ? "green" : "yellow", minWidth: Math.min(72, terminalColumns(host) - 6) })

  const rows = filterLoratRows(data.rows, {
    search: input.search,
    statusFilter: input.statusFilter,
    scopeFilter: input.scopeFilter,
  }).slice(0, 30)
  for (const row of rows) {
    writeLine(host, `${row.status.padEnd(9)} ${truncateVisible(row.relativePath, 44)}  ${truncateVisible(row.trigger, 36)}`)
  }
}

function parseRows(value: string): LoratRow[] | undefined {
  const text = value.trim()
  if (!text) return undefined
  const parsed = JSON.parse(text) as unknown
  if (Array.isArray(parsed)) return parsed as LoratRow[]
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)) {
    return (parsed as { rows: LoratRow[] }).rows
  }
  return undefined
}

function splitKeys(value?: string): string[] | undefined {
  return value?.split(",").map((item) => item.trim()).filter(Boolean)
}

function normalizeStatus(value?: string): LoratStatusFilter | undefined {
  if (value === "missing" || value === "trigger" || value === "notrigger" || value === "all") return value
  return undefined
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

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
