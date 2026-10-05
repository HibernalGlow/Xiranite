#!/usr/bin/env node
import { hasPipedInput, nodeCliName, readStdinLines, runGuidedInteraction, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"
import type { KisakiData, KisakiInput, KisakiResult, KisakiTerminalTool, KisakiTool } from "./core.js"
import { openKisakiPath } from "./platform.js"
import { createKisakiInteractionSchema, kisakiTerminalTools } from "./interaction.js"
import { help } from "./help.js"
import { createKisakiOperationInput, KISAKI_CLI_VALUE_FLAGS, parseKisakiCliOptions } from "./tool-options.js"
import { buildKisakiAnalysis } from "./analysis.js"
import { formatKisakiActivityMessage } from "./activity-log.js"
import { kisakiScanPresetToValues, type KisakiScanPreset } from "./scan-presets.js"
import type { KisakiInteractionValues } from "./interaction.js"
import { parseKisakiExtensionTokens, parseKisakiList, serializeKisakiExtensionTokens } from "./source-inputs.js"

const CLI_NAME = nodeCliName("kisaki")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "kisaki"
/** Kisaki's scanner vocabulary, read through the node's interaction contract rather than `core.js`. */
const TERMINAL_TOOLS = kisakiTerminalTools

interface KisakiConfig extends CliInteractionPreferencesSource { tool?: KisakiTool; recursive?: boolean; use_cache?: boolean; save_also_as_json?: boolean; delete_outdated_cache?: boolean; cache_folder_path?: string; config_folder_path?: string; duplicate_minimal_hash_cache_size_kib?: number; duplicate_minimal_prehash_cache_size_kib?: number; hash_type?: "crc32" | "xxh3" | "blake3"; check_method?: "name" | "size" | "size-and-name" | "hash"; similarity?: number; scan_presets?: KisakiScanPreset[]; active_scan_preset_id?: string }

export const cli: CliCommand = { name: CLI_NAME, description: help.short, run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  // The attach flags belong to the face, not to the node: they leave argv before the pipe parser sees them
  // and are folded into the host env, so one object carries the attach for the whole invocation and a
  // `--backend` can never be read as a scan root or a node parameter.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5: a host this face started belongs to this invocation and stops with it; an attached host is
  // left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({
      args: attach.remaining,
      host: attachedHost,
      cliName: CLI_NAME,
      loadContext: async () => { const { config } = await loadNodeConfigWithHints<KisakiConfig>("kisaki", { env: attachedHost.env, cwd: attachedHost.cwd, hintSink: { stderr: attachedHost.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
      createDefinition: (defaults, language) => createKisakiHostDefinition(attachedHost, defaults, language),
      runPipe,
      runGuide: async (definition, options) => { if (!await hostReady(attachedHost)) return; await runGuidedInteraction(definition, options) },
      // The TUI form is the product, but opening it without a host would let the operator fill in the whole
      // workbench before the first dead end, so the host is resolved before the renderer starts.
      runUi: async (definition, options) => { if (!await hostReady(attachedHost)) return; await runTerminalUi(definition, options) },
      loadScreen: async () => (await import("./Tui.js")).KisakiTui,
      createPreferences: (_defaults, current) => preferences(host, current),
      reexecEntrypoint: process.argv[1],
      help,
    })
  } finally {
    await stopSharedHost()
  }
}

async function runPipe(args: string[], host: CliHost): Promise<void> {
  if (!args.length) { writeLine(host, `${CLI_NAME} ui | gd | scan <tool> <directories...> | delete <paths...> | move <destination> <paths...> | rename <extension> <paths...> | save <output> <paths...>`); return }
  const command = args[0] ?? "scan", json = args.includes("--json"), language = resolveTerminalLanguage(valueFor(args, "--lang"), host.env)
  const { config } = await loadNodeConfigWithHints<KisakiConfig>("kisaki", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
  let input: KisakiInput
  if (command === "scan" || isTerminalTool(command)) {
    const explicitTool = command === "scan" ? args[1] : command
    if (command === "scan" && explicitTool && !explicitTool.startsWith("--") && !isTerminalTool(explicitTool)) {
      throw new Error(`Unsupported Kisaki tool: ${explicitTool}`)
    }
    const configuredTool = isTerminalTool(config?.tool) ? config!.tool! : "duplicate-files"
    const tool = isTerminalTool(explicitTool) ? explicitTool as KisakiTool : configuredTool
    const offset = command === "scan" ? 2 : 1
    let roots = positional(args.slice(offset), SCAN_VALUE_FLAGS)
    if (roots.includes("-")) roots = roots.filter((path) => path !== "-").concat(await readStdinLines(host.stdin))
    else if (!roots.length && hasPipedInput(host.stdin) && Symbol.asyncIterator in Object(host.stdin)) roots = await readStdinLines(host.stdin)
    input = { action: "scan", tool, includedDirectories: roots, includedDirectoriesReferenced: listFor(args, "--reference"), excludedDirectories: listFor(args, "--exclude-dir"), excludedItems: listFor(args, "--exclude-item"), recursive: !args.includes("--no-recursive") && config?.recursive !== false, useCache: !args.includes("--no-cache") && config?.use_cache !== false, saveAlsoAsJson: args.includes("--save-cache-json") || config?.save_also_as_json === true, deleteOutdatedCache: !args.includes("--keep-outdated-cache") && config?.delete_outdated_cache !== false, cacheFolderPath: valueFor(args, "--cache-folder") ?? config?.cache_folder_path, configFolderPath: valueFor(args, "--config-folder") ?? config?.config_folder_path, duplicateMinimalHashCacheSizeKiB: numberFor(args, "--min-hash-cache-kib") ?? config?.duplicate_minimal_hash_cache_size_kib, duplicateMinimalPrehashCacheSizeKiB: numberFor(args, "--min-prehash-cache-kib") ?? config?.duplicate_minimal_prehash_cache_size_kib, threadCount: numberFor(args, "--threads"), checkMethod: config?.check_method, hashType: config?.hash_type, similarity: config?.similarity, allowedExtensions: extensionsFor(args, "--allow"), excludedExtensions: extensionsFor(args, "--exclude-ext"), minimumFileSize: numberFor(args, "--min-size"), maximumFileSize: numberFor(args, "--max-size"), filterText: valueFor(args, "--filter"), ...parseKisakiCliOptions(args) }
  } else if (command === "delete") input = createKisakiOperationInput("delete", { tool: operationToolFor(args), selectedPaths: positional(args.slice(1), OPERATION_VALUE_FLAGS), deleteMode: args.includes("--permanent") ? "permanent" : "trash", dryRun: !args.includes("--live") })
  else if (command === "move") input = createKisakiOperationInput("move", { tool: operationToolFor(args), destinationDirectory: args[1], selectedPaths: positional(args.slice(2), OPERATION_VALUE_FLAGS), copyMode: args.includes("--copy"), preserveStructure: args.includes("--preserve-structure"), conflictPolicy: valueFor(args, "--conflict"), dryRun: !args.includes("--live") })
  else if (command === "rename") input = createKisakiOperationInput("rename", { tool: operationToolFor(args), renameItems: positional(args.slice(2), OPERATION_VALUE_FLAGS).map((path) => ({ path, properExtension: args[1] ?? "" })), conflictPolicy: valueFor(args, "--conflict"), dryRun: !args.includes("--live") })
  else if (command === "save") input = createKisakiOperationInput("save", { tool: operationToolFor(args), outputPath: args[1], selectedPaths: positional(args.slice(2), OPERATION_VALUE_FLAGS), outputFormat: args.includes("--csv") ? "csv" : "json", exportScope: valueFor(args, "--scope"), dryRun: false })
  else { writeLine(host, `Unknown command: ${command}`); process.exitCode = 2; return }
  const result = await runKisakiOnHost(host, input, json ? undefined : (event) => { writeLine(host, formatKisakiActivityMessage("info", event.message, event.progress)) })
  if (!result) return
  if (json) writeJson(host, result)
  else { for (const line of formatKisakiPipeResult(result, language)) writeLine(host, line); for (const entry of result.data?.entries.slice(0, 200) ?? []) writeLine(host, entry.status ? `${entry.status}\t${entry.path}${entry.secondaryPath ? `\t→ ${entry.secondaryPath}` : ""}${entry.error ? `\t${entry.error}` : ""}` : `${entry.groupId + 1}\t${entry.size}\t${entry.path}${entry.detail ? `\t${entry.detail}` : ""}`) }
  if (!result.success) process.exitCode = 1
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
 * The host for this face process, resolved once (ADR-0074 §6): attach to a host that is already running, or
 * start one as our own child when the operator configured nothing. The memo lives in `@xiranite/cli-runtime`,
 * because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is written to this face's error line (it names every way to attach
 * and says when no host binary was found), so the interactive faces only have to stop before drawing
 * anything — a guide that spends a dozen prompts and then reports a dead host burns the operator's
 * attention to deliver a message they could have been given first.
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
 * Runs one kisaki input document on the host and returns its result document, or `undefined` when the attach
 * or the transport failed — reported on this face's error line with exit code 1. A terminal face that cannot
 * reach a host stops rather than running `core.ts` locally: that fallback is the compat path ADR-0074 §5
 * removes, and `HostAttachmentError` names every way to get a host. Failures are caught here instead of
 * thrown because a thrown error would drop buffered stdout; setting `process.exitCode` keeps the two codes
 * this CLI uses (1 failure, 2 usage) and leaves `--json` output clean. A run that simply did not work is a
 * result with `success: false`, not a throw.
 *
 * The operation is started before it is awaited so Ctrl-C can cancel the run the host is holding, which is
 * what the in-process `isCancelled` flag did before: `cancel` is the host's own cancellation, not a face
 * promise the engine ignores.
 */
async function runKisakiOnHost(host: CliHost, input: KisakiInput, onEvent?: (event: OperationEvent) => void): Promise<KisakiResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    const started = await client.startOperation<KisakiData>(NODE_ID, input)
    const requestCancel = () => { void client.cancelOperation(started.operationId).catch(() => undefined) }
    process.once("SIGINT", requestCancel); process.once("SIGTERM", requestCancel)
    try {
      return await client.awaitOperation<KisakiData>(started, onEvent)
    } finally {
      process.off("SIGINT", requestCancel); process.off("SIGTERM", requestCancel)
    }
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema; the run and the
 * control calls go to the host, and the started record is kept so cancel, pause and resume address the
 * operation this face actually started. `openPath` stays face-side: revealing a path in the desktop shell is
 * a terminal convenience, not part of the node's run contract.
 */
export function createKisakiHostDefinition(host: CliHost, defaults: KisakiConfig, language: TerminalLanguage): KisakiHostDefinition {
  const tool = isTerminalTool(defaults.tool) ? defaults.tool : "duplicate-files"
  const activePreset = defaults.scan_presets?.find((preset) => preset.id === defaults.active_scan_preset_id)
  const presetValues = activePreset ? kisakiScanPresetToValues(activePreset) as Partial<KisakiInteractionValues> : {}
  const schema = createKisakiInteractionSchema({ tool, recursive: defaults.recursive, useCache: defaults.use_cache, hashType: defaults.hash_type, checkMethod: defaults.check_method, similarity: defaults.similarity, ...presetValues }, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<KisakiData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<KisakiData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
    openPath: openKisakiPath,
  }
}

/** The face's own addition to the shared definition: the reveal-in-shell helper the TUI's `o` key calls. */
export interface KisakiHostDefinition extends TerminalInteractionDefinition<KisakiInput, KisakiResult> {
  openPath: (path: string) => Promise<void>
}

function preferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: "kisaki", current, async save(value) { await updateNodeConfigFile("kisaki", { cli: { theme: value.theme, default_mode: value.defaultMode, language: value.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<KisakiConfig>("kisaki", { ...options, jsonMode: true }); const value = resolveInteractionPreferences(config); return { theme: value.theme, defaultMode: value.mode, language: value.language ?? "zh" } } }
}

export function formatKisakiPipeResult(result: KisakiResult, language: TerminalLanguage): string[] {
  const data = result.data
  if (!data) return [result.message]
  const zh = language === "zh", none = zh ? "无" : "none"
  if (data.action !== "scan") return [zh ? `${operationLabel(data.action, true)}：影响 ${data.affectedCount} 项，错误 ${data.errorCount} 项。` : `${operationLabel(data.action, false)}: ${data.affectedCount} affected, ${data.errorCount} errors.`]
  const analysis = buildKisakiAnalysis(data.groups, [], data.tool)
  const lines = [
    data.stopped ? zh ? `扫描已停止；保留 ${data.fileCount} 个部分结果。` : `Scan stopped; retained ${data.fileCount} partial item(s).` : zh ? `找到 ${data.fileCount} 项，共 ${data.groupCount} 组。` : `Found ${data.fileCount} item(s) in ${data.groupCount} group(s).`,
    `${zh ? "格式" : "Formats"}: ${analysis.formats.slice(0, 8).map((item) => `${item.format}=${item.count}/${item.bytes}B`).join(", ") || none}`,
  ]
  if (analysis.similarities.length) lines.push(`${zh ? "相似度" : "Similarity"}: ${analysis.similarities.map((item) => `${similarityLabel(item.level, language)}=${item.count}`).join(", ")}`)
  if (data.tool === "similar-images") lines.push(`${zh ? "相似文件夹" : "Similar folders"}: ${data.similarFolders?.map((item) => `${item.path}=${item.count}`).join(", ") || none}`)
  return lines
}

const SIMILARITY_LABELS_EN = { original: "Original / identical", "very-high": "Very high", high: "High", medium: "Medium", small: "Small", "very-small": "Very small", minimal: "Minimal" } as const
function similarityLabel(level: keyof typeof SIMILARITY_LABELS_EN, language: TerminalLanguage): string { return language === "zh" ? ({ original: "原始/相同", "very-high": "极高", high: "高", medium: "中等", small: "较小", "very-small": "很小", minimal: "最低" } as const)[level] : SIMILARITY_LABELS_EN[level] }
function operationLabel(action: NonNullable<KisakiResult["data"]>["action"], zh: boolean): string { if (action === "delete") return zh ? "删除" : "Delete"; if (action === "move") return zh ? "移动/复制" : "Move/copy"; if (action === "rename") return zh ? "修正扩展名" : "Fix extension"; return zh ? "导出" : "Export" }

const SCAN_VALUE_FLAGS = new Set([...KISAKI_CLI_VALUE_FLAGS, "--reference", "--exclude-dir", "--exclude-item", "--allow", "--exclude-ext", "--min-size", "--max-size", "--threads", "--filter", "--cache-folder", "--config-folder", "--min-hash-cache-kib", "--min-prehash-cache-kib", "--lang"])
const OPERATION_VALUE_FLAGS = new Set(["--conflict", "--scope", "--tool", "--lang"])
function positional(args: string[], valueFlags: Set<string>): string[] { return args.filter((arg, index) => !arg.startsWith("--") && !valueFlags.has(args[index - 1] ?? "")) }
function valueFor(args: string[], flag: string): string | undefined { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
function valuesFor(args: string[], flag: string): string[] { return args.flatMap((value, index) => value === flag && args[index + 1] !== undefined ? [args[index + 1]!] : []) }
function listFor(args: string[], flag: string): string[] { return valuesFor(args, flag).flatMap((value) => parseKisakiList(value)).filter((value, index, all) => all.indexOf(value) === index) }
function extensionsFor(args: string[], flag: string): string | undefined { const values = valuesFor(args, flag).flatMap((value) => parseKisakiExtensionTokens(value)); return values.length ? serializeKisakiExtensionTokens(values) : undefined }
function numberFor(args: string[], flag: string): number | undefined { const value = valueFor(args, flag); if (value === undefined) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined }
/** True for a scanner the terminal contract allows; GUI-only tools stay refused instead of falling back. */
function isTerminalTool(value: string | undefined): boolean { return value !== undefined && TERMINAL_TOOLS.includes(value as KisakiTerminalTool) }
function operationToolFor(args: string[]): KisakiTool | undefined { const value = valueFor(args, "--tool"); if (value === undefined) return undefined; if (!isTerminalTool(value)) throw new Error(`Unsupported Kisaki tool: ${value}`); return value as KisakiTool }
const defaultHost = (): CliHost => ({ cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) await runProgram()
