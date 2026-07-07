#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  nodeCliName,
  promptRich,
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
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { LoratAction, LoratInput, LoratResult, LoratRow, LoratStatusFilter } from "./core.js"
import { DEFAULT_LORA_FOLDER, collectTriggerDb, filterLoratRows, parseTriggerDb, runLorat, summarizeLoratRows } from "./core.js"
import { createNodeLoratRuntime, readClipboardText, readTextFile, writeTextFile } from "./platform.js"

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

type GuidedSelection = "scan" | "write-missing" | "export-db" | "exit"

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "LoRA trigger sidecar and TriggerDB manager.",
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
          await runAction(await inputFromArgs("scan", args as LoratCliOptions), Boolean(args.json), host)
        },
      }),
      "apply-db": defineCommand({
        meta: { name: "apply-db", description: "Apply TriggerDB JSON to existing rows JSON." },
        args: commonArgs(),
        async run({ args }) {
          await runAction(await inputFromArgs("apply_db", args as LoratCliOptions), Boolean(args.json), host)
        },
      }),
      write: defineCommand({
        meta: { name: "write", description: "Write selected rows as .trigger.txt sidecars." },
        args: commonArgs(),
        async run({ args }) {
          await runAction(await inputFromArgs("write_triggers", args as LoratCliOptions), Boolean(args.json), host)
        },
      }),
      "no-trigger": defineCommand({
        meta: { name: "no-trigger", description: "Write selected rows as .notrigger.txt sidecars." },
        args: commonArgs(),
        async run({ args }) {
          await runAction(await inputFromArgs("mark_no_trigger", args as LoratCliOptions), Boolean(args.json), host)
        },
      }),
      "export-db": defineCommand({
        meta: { name: "export-db", description: "Export rows to TriggerDB JSON." },
        args: commonArgs(),
        async run({ args }) {
          const result = await runAction(await inputFromArgs("export_db", args as LoratCliOptions), Boolean(args.json), host)
          const output = (args as LoratCliOptions).output
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

async function inputFromArgs(action: LoratAction, args: LoratCliOptions): Promise<LoratInput> {
  const triggerDbJson = args.db ?? await readTextFile(args.dbFile)
  const rows = parseRows(args.rows ?? await readTextFile(args.rowsFile))
  return {
    action,
    folderPath: args.folder,
    triggerDbJson,
    rows,
    selectedKeys: splitKeys(args.keys),
    statusFilter: normalizeStatus(args.status),
    search: args.search,
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
    const clipboard = cleanPath(await readClipboardText())
    const folder = await promptRich(host, "LoRA folder", clipboard || DEFAULT_LORA_FOLDER)
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

    const scan = await runAction({ action: "scan", folderPath: folder }, false, host)
    if (!scan.success || !scan.data) return
    if (choice === "scan") return

    if (choice === "write-missing") {
      const rows = scan.data.rows.filter((row) => row.status === "missing").map((row) => ({ ...row, selected: true }))
      if (!rows.length) {
        writeLine(host, rich(host, "No missing rows to write.", "yellow"))
        return
      }
      const ok = await confirmRich(host, `Write inferred triggers for ${rows.length} missing row(s)?`, false)
      if (ok) await runAction({ action: "write_triggers", folderPath: folder, rows }, false, host)
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
