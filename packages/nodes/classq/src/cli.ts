#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { hasPipedInput, nodeCliName, readStdinLines, runGuidedInteraction, writeError, writeJson, writeLine, type CliCommand, type CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource, type TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config/node"
// ADR-0074 §5: this face holds no node engine. `core.ts` is evaluated by the host's QuickJS executor,
// so the only thing imported from it here is its types, and every run is an `/operations` call.
import { createOperationsClient, extractHostAttachArgs, sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import type { HostAttachFlag, HostHandle, OperationEvent, OperationsClient } from "@xiranite/cli-runtime/backend"
import type { ClassqAction, ClassqData, ClassqExistingPolicy, ClassqInput, ClassqResult, ClassqTransferMode } from "./core.js"
import { createClassqInteractionSchema, type ClassqInteractionValues } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = nodeCliName("classq")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "classq"

interface ClassqNodeConfig extends CliInteractionPreferencesSource { keyword?: string; wait_keyword?: string; transfer_mode?: ClassqTransferMode; existing_policy?: ClassqExistingPolicy; dry_run?: boolean }
export const cli: CliCommand = { name: CLI_NAME, description: "Keyword-folder wait routing.", run: (args, host) => runProgram(args, host) }

export async function runProgram(args = process.argv.slice(2), host: CliHost = defaultHost()): Promise<void> {
  // The attach flags belong to the face, not to the node: they leave argv before the command router
  // sees them and are folded into the host env, so one object carries the attach for the whole
  // invocation and the flags can never reach a node input document.
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)
  // A host this face started belongs to this invocation, so it stops with it; an attached one is left
  // running (`stop()` is a no-op on it).
  try {
    await runInteractionCli({
      args: attach.remaining, host: attachedHost, cliName: CLI_NAME,
      loadContext: async () => { const { config } = await loadNodeConfigWithHints<ClassqNodeConfig>(NODE_ID, { env: attachedHost.env, cwd: attachedHost.cwd, hintSink: { stderr: attachedHost.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
      createDefinition: (defaults, language) => createClassqHostDefinition(attachedHost, defaults, language),
      runPipe: runPipe,
      // A guided or workbench run that collects every prompt and only then reports a dead host has
      // spent the operator's attention to deliver a message they could have been given first.
      runGuide: async (definition, options) => { if (!await hostReady(attachedHost)) return; await runGuidedInteraction(definition, options) },
      runUi: async (definition, options) => { if (!await hostReady(attachedHost)) return; await runTerminalUi(definition, options) },
      loadScreen: async () => (await import("./Tui.js")).ClassqTui,
      createPreferences: (_defaults, values) => createPreferences(attachedHost, values),
      reexecEntrypoint: process.argv[1], help,
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

/** The host for this face process, resolved once: attach to a running one, or start our own child. */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/**
 * True when a host is reachable. The reason goes to this face's error line (`HostAttachmentError`
 * already names every way to attach and says when no host binary was found), so the caller only has
 * to stop before drawing anything.
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
 * attach or the transport failed — already reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that fallback
 * is the compat path ADR-0074 §5 removes. Failures are caught instead of thrown because citty's
 * `runMain` answers a thrown error with `process.exit(1)` and drops buffered stdout; setting
 * `process.exitCode` keeps the two codes this CLI uses (1 failure, 2 usage). A run that simply did not
 * work is a result with `success: false`, not a throw.
 */
async function runClassqOnHost(host: CliHost, input: ClassqInput, onEvent?: (event: OperationEvent) => void): Promise<ClassqResult | undefined> {
  try {
    const client = await hostOperationsClient(host)
    return await client.runOperation<ClassqData>(NODE_ID, input, onEvent)
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
export function createClassqHostDefinition(host: CliHost, defaults: ClassqNodeConfig, language: TerminalLanguage): TerminalInteractionDefinition<ClassqInput, ClassqResult> {
  const schema = createClassqInteractionSchema({ keyword: defaults.keyword ?? "already", waitKeyword: defaults.wait_keyword ?? "wait", transferMode: defaults.transfer_mode ?? "move", existingPolicy: defaults.existing_policy ?? "merge", dryRun: defaults.dry_run ?? true } satisfies Partial<ClassqInteractionValues>, language)
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      const started = await client.startOperation<ClassqData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<ClassqData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    pause: async () => { if (running) await running.client.pauseOperation(running.operationId) },
    resume: async () => { if (running) await running.client.resumeOperation(running.operationId) },
    cancel: async () => { if (running) await running.client.cancelOperation(running.operationId) },
  }
}

function createPreferences(host: CliHost, current: TerminalPreferenceValues): TerminalPreferenceController {
  const options = { env: host.env, cwd: host.cwd }
  return { nodeId: NODE_ID, current, async save(values) { await updateNodeConfigFile(NODE_ID, { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, options) }, async restore() { const { config } = await loadNodeConfigWithHints<ClassqNodeConfig>(NODE_ID, { ...options, jsonMode: true }); const prefs = resolveInteractionPreferences(config); return { theme: prefs.theme, defaultMode: prefs.mode, language: prefs.language ?? "zh" } } }
}

async function runPipe(args: string[], host: CliHost): Promise<void> {
  if (!args.length || args.includes("--help") || args.includes("-h") || args[0] === "help") { writeUsage(host); return }
  const json = args.includes("--json"), action: ClassqAction = args.includes("classify") || args.includes("run") ? "classify" : "plan"
  const { config } = await loadNodeConfigWithHints<ClassqNodeConfig>(NODE_ID, { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: json })
  let paths = pathArgs(args)
  if (paths.includes("-")) paths = paths.filter((path) => path !== "-").concat(await readStdinLines(host.stdin))
  else if (!paths.length && hasPipedInput(host.stdin)) paths = await readStdinLines(host.stdin)
  const input: ClassqInput = { action, paths, keyword: valueFor(args, "--keyword") ?? config?.keyword, waitKeyword: valueFor(args, "--wait") ?? config?.wait_keyword, transferMode: valueFor(args, "--transfer") as ClassqTransferMode | undefined ?? config?.transfer_mode, existingPolicy: valueFor(args, "--existing") as ClassqExistingPolicy | undefined ?? config?.existing_policy, dryRun: action !== "classify" || args.includes("--dry-run") || !args.includes("--apply") }
  // `undefined` means no host or a broken transport: the reason is already on stderr and the code is
  // already set, so nothing is printed as if it were a classification result.
  const result = await runClassqOnHost(host, input)
  if (!result) return
  if (json) writeJson(host, result)
  else { writeLine(host, result.message); for (const item of result.data?.items.slice(0, 80) ?? []) writeLine(host, `${item.status}\t${item.stage}\t${item.sourceName}\t->\t${item.targetRelative}`) }
  if (!result.success) process.exitCode = 1
}

function writeUsage(host: CliHost) { writeLine(host, `${CLI_NAME} - keyword-folder wait routing`); writeLine(host, `  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]`); writeLine(host, `  ${CLI_NAME} gd`); writeLine(host, `  ${CLI_NAME} plan <roots...> [--keyword already] [--wait wait] [--json]`); writeLine(host, `  ${CLI_NAME} classify <roots...> [--transfer move|copy] [--dry-run|--apply] [--json]`) }
function pathArgs(args: string[]) { const commands = new Set(["plan", "classify", "run"]), flags = new Set(["--keyword", "--wait", "--transfer", "--existing"]); return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !flags.has(args[index - 1] ?? "")) }
function valueFor(args: string[], flag: string) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
function defaultHost(): CliHost { return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr } }
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) { try { await runProgram() } catch (error) { writeError(defaultHost(), error instanceof Error ? error.message : String(error)); process.exitCode = 1 } }
