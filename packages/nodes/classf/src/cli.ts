#!/usr/bin/env node
import { isEntryModule, hasPipedInput, readStdinLines, nodeCliName, renderProgressBar, rich, writeError, writeJson, writeLine, runGuidedInteraction } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"

import type { ClassfAction, ClassfClassifyMode, ClassfData, ClassfExistingPolicy, ClassfInput, ClassfPlacementMode, ClassfResult, ClassfTransferMode, ClassfWorkItemMode } from "./core.js"
import { createClassfInteractionSchema, type ClassfInteractionValues } from "./interaction.js"
import { help } from "./help.js"

/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "classf"
const PIPE_ITEM_LIMIT = 80

interface ClassfNodeConfig {
  crashu_source_paths?: string[]
  crashu_similarity_threshold?: number
  samea_min_occurrences?: number
  samea_centralize?: boolean
  samea_ignore_path_blacklist?: boolean
  samea_group_enabled?: boolean
  samea_group_already_enabled?: boolean
  samea_group_wait_enabled?: boolean
  samea_group_del_enabled?: boolean
  samea_group_min_occurrences?: number
  samea_group_centralize?: boolean
  target_dir?: string
  transfer_mode?: ClassfTransferMode
  classify_mode?: ClassfClassifyMode
  already_enabled?: boolean
  wait_enabled?: boolean
  del_enabled?: boolean
  placement_mode?: ClassfPlacementMode
  existing_policy?: ClassfExistingPolicy
  work_item_mode?: ClassfWorkItemMode
  dry_run?: boolean
  blacklist_keywords?: string[]
  /** GUI node configuration is stored verbatim in the shared TOML section. */
  blacklistKeywords?: string[]
  sameaGroupEnabled?: boolean
  alreadyEnabled?: boolean
  waitEnabled?: boolean
  delEnabled?: boolean
  sameaGroupAlreadyEnabled?: boolean
  sameaGroupWaitEnabled?: boolean
  sameaGroupDelEnabled?: boolean
}

interface ClassfCliConfig extends CliInteractionPreferencesSource, ClassfNodeConfig {}
const CLI_NAME = nodeCliName("classf")

export const cli: CliCommand = { name: CLI_NAME, description: "Plan and apply classified file transfers.", run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  // The attach flags belong to the face, not to the node: they leave argv before the command router
  // sees them and are folded into the host env, so one object carries the attach for the whole
  // invocation and the flags can never reach a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)

  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this invocation,
  // so it stops with it. An attached host is left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({
      args: attach.remaining,
      host: attachedHost,
      cliName: CLI_NAME,
      loadContext: async () => {
        const { config } = await loadNodeConfigWithHints<ClassfCliConfig>(NODE_ID, { env: attachedHost.env, cwd: attachedHost.cwd, hintSink: { stderr: attachedHost.stderr }, jsonMode: true })
        return { preferences: resolveInteractionPreferences(config), value: config ?? {} }
      },
      createDefinition: (defaults, language) => createClassfHostDefinition(attachedHost, defaults, language),
      runPipe: runPipe,
      // The guide and the workbench are the product, but opening either without a host would let the
      // operator fill in the whole form before the first dead end, so the host is resolved first.
      runGuide: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runGuidedInteraction(definition, options)
      },
      runUi: async (definition, options) => {
        if (!await hostReady(attachedHost)) return
        await runTerminalUi(definition, options)
      },
      loadScreen: async () => (await import("./Tui.js")).ClassfTui,
      createPreferences: (_defaults, values) => createPreferenceController(host, values),
      reexecEntrypoint: process.argv[1],
      help,
    })
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
 * The host for this face process, resolved once (ADR-0074 §6): attach to a host that is already running,
 * or start one as our own child when the operator configured nothing. The memo itself lives in
 * `@xiranite/cli-runtime`, because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is ready. The reason is written to this face's error line (it already names every
 * way to attach and says when no host binary was found), so interactive callers only have to stop
 * before drawing anything.
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
 * Attaches to the host, runs the operation and returns its result document, or `undefined` when the
 * attach or the transport failed — reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that fallback
 * is the compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to get a host.
 * Failures are caught here instead of thrown because citty's `runMain` answers a thrown error with
 * `process.exit(1)` and drops buffered stdout; setting `process.exitCode` keeps the two codes this
 * CLI uses (1 failure, 2 usage) and leaves `--json` output clean. A run that simply did not work is
 * a result with `success: false`, not a throw.
 */
async function runClassfOnHost(
  host: CliHost,
  input: ClassfInput & { action: ClassfAction },
  onEvent?: (event: OperationEvent) => void,
): Promise<ClassfResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<ClassfData>(NODE_ID, input, onEvent)
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
export function createClassfHostDefinition(
  host: CliHost,
  defaults: ClassfNodeConfig,
  _language: TerminalLanguage,
): TerminalInteractionDefinition<ClassfInput, ClassfResult> {
  const queues = configuredQueueSettings(defaults)
  const grouping = configuredGroupingSettings(defaults)
  // The configured blacklist only overrides the schema's own default when the operator wrote one;
  // `createClassfInteractionSchema` seeds `blacklistKeywordsText` from the node's built-in keywords, and
  // an empty override here would reach the host as `[]` — which means "no blacklist", not "use default".
  const blacklistKeywords = configuredBlacklistKeywords(defaults)
  const schema = createClassfInteractionSchema({
    crashuSourcesText: defaults.crashu_source_paths?.join("\n") ?? "",
    targetDir: defaults.target_dir ?? "",
    transferMode: defaults.transfer_mode ?? "move",
    classifyMode: defaults.classify_mode ?? "auto",
    alreadyEnabled: queues.already,
    waitEnabled: queues.wait,
    delEnabled: queues.del,
    placementMode: defaults.placement_mode ?? "local",
    existingPolicy: defaults.existing_policy ?? "merge",
    workItemMode: defaults.work_item_mode ?? "files",
    dryRun: defaults.dry_run ?? true,
    ...(blacklistKeywords ? { blacklistKeywordsText: blacklistKeywords.join("\n") } : {}),
    sameaGroupEnabled: defaults.sameaGroupEnabled ?? defaults.samea_group_enabled ?? false,
    sameaGroupAlreadyEnabled: grouping.already,
    sameaGroupWaitEnabled: grouping.wait,
    sameaGroupDelEnabled: grouping.del,
    sameaGroupMinOccurrences: defaults.samea_group_min_occurrences ?? 1,
  } satisfies Partial<ClassfInteractionValues>, _language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<ClassfData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<ClassfData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function createDefaultHost(): CliHost { return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr } }

function createPreferenceController(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: "classf", current, async save(values) { await updateNodeConfigFile("classf", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<ClassfCliConfig>("classf", { ...options, jsonMode: true }); const prefs = resolveInteractionPreferences(config); return { theme: prefs.theme, defaultMode: prefs.mode, language: prefs.language ?? resolveTerminalLanguage(undefined, host.env) } } }
}

async function runPipe(args: string[], host: CliHost): Promise<void> {
  const json = args.includes("--json")
  const action: ClassfAction = args.includes("classify") || args.includes("run") ? "classify" : "plan"
  const { config } = await loadNodeConfigWithHints<ClassfNodeConfig>("classf", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
  const queues = configuredQueueSettings(config)
  const grouping = configuredGroupingSettings(config)
  let paths = pathArgs(args)
  if (paths.includes("-")) {
    paths = paths.filter((p) => p !== "-").concat(await readStdinLines(host.stdin))
  } else if (paths.length === 0 && hasPipedInput(host.stdin) && Symbol.asyncIterator in (host.stdin as object)) {
    paths = await readStdinLines(host.stdin)
  }
  const input: ClassfInput & { action: ClassfAction } = {
    action,
    paths,
    crashuSourcePaths: valueFor(args, "--crashu-source")?.split(/[,\r\n]+/).map((path) => path.trim()).filter(Boolean) ?? config?.crashu_source_paths,
    crashuSimilarityThreshold: numberFor(args, "--similarity") ?? config?.crashu_similarity_threshold,
    sameaMinOccurrences: numberFor(args, "--samea-min") ?? config?.samea_min_occurrences,
    sameaCentralize: args.includes("--samea-centralize") || config?.samea_centralize,
    sameaIgnorePathBlacklist: args.includes("--samea-ignore-path-blacklist") || config?.samea_ignore_path_blacklist,
    sameaGroupEnabled: args.includes("--samea-group") || config?.sameaGroupEnabled || config?.samea_group_enabled,
    sameaGroupAlreadyEnabled: booleanFlag(args, "samea-group-already", grouping.already),
    sameaGroupWaitEnabled: booleanFlag(args, "samea-group-wait", grouping.wait),
    sameaGroupDelEnabled: booleanFlag(args, "samea-group-del", grouping.del),
    sameaGroupMinOccurrences: numberFor(args, "--samea-group-min") ?? config?.samea_group_min_occurrences,
    sameaGroupCentralize: args.includes("--samea-group-centralize") || config?.samea_group_centralize,
    targetDir: valueFor(args, "--target") ?? config?.target_dir,
    transferMode: valueFor(args, "--transfer") as ClassfTransferMode | undefined ?? config?.transfer_mode,
    classifyMode: valueFor(args, "--classify") as ClassfClassifyMode | undefined ?? config?.classify_mode,
    alreadyEnabled: booleanFlag(args, "already", queues.already),
    waitEnabled: booleanFlag(args, "wait", queues.wait),
    delEnabled: booleanFlag(args, "del", queues.del),
    placementMode: valueFor(args, "--placement") as ClassfPlacementMode | undefined ?? config?.placement_mode,
    existingPolicy: valueFor(args, "--existing") as ClassfExistingPolicy | undefined ?? config?.existing_policy,
    workItemMode: valueFor(args, "--items") as ClassfWorkItemMode | undefined ?? config?.work_item_mode,
    blacklistKeywords: valuesFor(args, "--blacklist-keyword") ?? configuredBlacklistKeywords(config),
    dryRun: action !== "classify" || args.includes("--dry-run") || config?.dry_run === true,
  }
  let progressActive = false
  // No host, no run: `runClassfOnHost` has already reported the reason and set exit code 1.
  const result = await runClassfOnHost(host, input, json ? undefined : (event) => {
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
  if (!result) return
  if (json) writeJson(host, result)
  else {
    writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
    for (const item of result.data?.items.slice(0, PIPE_ITEM_LIMIT) ?? []) writeLine(host, `${item.status}\t${item.stage}\t${item.sourceName}\t->\t${item.targetRelative}`)
  }
  if (!result.success) process.exitCode = 1
}

if (isEntryModule(import.meta.url)) await runProgram().catch((error) => { writeError(createDefaultHost(), error instanceof Error ? error.message : String(error)); process.exitCode = 1 })

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

function pathArgs(args: string[]): string[] {
  const commands = new Set(["plan", "classify", "run"])
  const valueOptions = new Set(["--target", "--transfer", "--classify", "--placement", "--existing", "--items", "--crashu-source", "--similarity", "--samea-min", "--samea-group-min", "--blacklist-keyword"])
  return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !valueOptions.has(args[index - 1] ?? ""))
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function valuesFor(args: string[], flag: string): string[] | undefined {
  const values = args.flatMap((value, index) => value === flag ? [args[index + 1] ?? ""] : []).flatMap((value) => value.split(/[\r\n,]+/)).map((value) => value.trim()).filter(Boolean)
  return values.length ? values : undefined
}

/**
 * The operator's own blacklist, if they wrote one. The node's built-in keyword list is not this face's to
 * carry: `core.ts` applies it whenever the input omits the field, and `createClassfInteractionSchema` seeds
 * the form default from that same constant — one vocabulary, read from one side of the protocol.
 */
function configuredBlacklistKeywords(config: ClassfNodeConfig | undefined): string[] | undefined {
  return config?.blacklist_keywords ?? config?.blacklistKeywords
}

type QueueSettings = Record<"already" | "wait" | "del", boolean>

function configuredQueueSettings(config: ClassfNodeConfig | undefined): QueueSettings {
  const legacy = legacyQueueSettings(config?.classify_mode)
  return {
    already: config?.alreadyEnabled ?? config?.already_enabled ?? legacy.already,
    wait: config?.waitEnabled ?? config?.wait_enabled ?? legacy.wait,
    del: config?.delEnabled ?? config?.del_enabled ?? legacy.del,
  }
}

function configuredGroupingSettings(config: ClassfNodeConfig | undefined): QueueSettings {
  const legacy = config?.sameaGroupEnabled ?? config?.samea_group_enabled ?? false
  return {
    already: config?.sameaGroupAlreadyEnabled ?? config?.samea_group_already_enabled ?? legacy,
    wait: config?.sameaGroupWaitEnabled ?? config?.samea_group_wait_enabled ?? legacy,
    del: config?.sameaGroupDelEnabled ?? config?.samea_group_del_enabled ?? false,
  }
}

function legacyQueueSettings(classifyMode: ClassfClassifyMode | undefined): QueueSettings {
  if (classifyMode === "only") return { already: true, wait: false, del: true }
  if (classifyMode === "del") return { already: false, wait: false, del: true }
  return { already: true, wait: true, del: true }
}

function booleanFlag(args: string[], name: string, fallback: boolean): boolean {
  if (args.includes(`--no-${name}`)) return false
  if (args.includes(`--${name}`)) return true
  return fallback
}

function numberFor(args: string[], flag: string): number | undefined {
  const value = valueFor(args, flag)
  return value === undefined ? undefined : Number(value)
}
