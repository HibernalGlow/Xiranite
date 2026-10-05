#!/usr/bin/env node
import {
  isEntryModule,
  nodeCliName,
  writeError,
  writeJson,
  writeLine,
  type CliHost,
} from "@xiranite/cli-runtime"
import {
  createOperationsClient,
  extractHostAttachArgs,
  sharedHostHandle,
  stopSharedHost,
} from "@xiranite/cli-runtime/backend"
import type {
  HostAttachFlag,
  HostHandle,
  OperationEvent,
  OperationsClient,
} from "@xiranite/cli-runtime/backend"

// Types only, on purpose (ADR-0074 §5): the action vocabulary and the result document are shared, the
// engine is not. Findz's core answers nothing without the host's `findz` service arm (ADR-0077), so a
// value import of `runFindz` here would put a second, deaf executor inside this face's process.
import type { FindzAction, FindzData, FindzInput, FindzResult } from "./core.js"
import { FINDZ_GUI_ONLY_HELP } from "./help.js"

export const CLI_NAME = nodeCliName("findz")
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "findz"

/**
 * The actions that hold a durable engine task, and therefore the operation the host keeps running.
 *
 * `core.ts` waits these out through the engine's own held `task.wait` frame (ADR-0077 decision 6), so the
 * face must hold the operation too: that is what makes an interrupt mean something on the host side
 * instead of leaving a sidecar scanning after the terminal has gone.
 */
const DURABLE_ACTIONS: readonly FindzAction[] = ["scan", "analyze"]

/**
 * Every action the node publishes, read from `core.ts`'s `FindzAction` union.
 *
 * `watch` is deliberately absent, and the face refuses it rather than inventing one: the host owns the
 * filesystem watch, `protocol.ts` keeps `watcher.apply_changes`/`watcher.set_health` out of the node's
 * method set because `crates/xiranite-quickjs-executor/src/findz_operations.rs` rejects them (ADR-0077
 * decision 5), and `docs/migration/face-execution-ledger.md` still lists that grant as undecided for this
 * node. A face that started its own watcher would be the second implementation of a rule the host has not
 * agreed to own yet.
 */
const FINDZ_ACTIONS: readonly FindzAction[] = [
  "api_info",
  "open_library",
  "close_library",
  "scan",
  "analyze",
  "query_archives",
  "query_members",
  "export_rows",
  "treemap",
  "task",
  "pause",
  "resume",
  "cancel",
]

/**
 * `findz [action [library-root [detail]]]`, plus the host attach flags `@xiranite/cli-runtime` owns.
 *
 * No flags of its own: `packages/nodes/findz/src/help.ts` publishes this node as GUI-only, so the terminal
 * entry stays the pointer it documents and only grows the programmatic door that same dictionary names —
 * "Drive the same actions over the host's `/operations` protocol if you need them programmatically". The
 * result document therefore always goes to stdout as one JSON document, and progress lines go to stderr,
 * so a scripted caller can pipe stdout straight into `jq`.
 */
export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createHost(),
): Promise<void> {
  const attach = extractHostAttachArgs(args)
  const attachedHost = withAttachFlags(host, attach.flags)
  try {
    await runFindzProgram(attach.remaining, attachedHost)
  } finally {
    await stopSharedHost()
  }
}

async function runFindzProgram(args: string[], host: CliHost): Promise<void> {
  const first = args[0] ?? ""
  if (args.length === 0 || first === "help" || first.startsWith("-")) {
    // The documented answer, and the one answer that needs no host: this is a pointer to the workspace
    // surface, not a node run, so it must not spend an attach round trip or fail when nothing is listening.
    writeLine(host, FINDZ_GUI_ONLY_HELP)
    return
  }

  const action = FINDZ_ACTIONS.find((candidate) => candidate === first)
  if (!action) {
    writeError(host, `Unknown Findz action: ${first}. Available actions: ${FINDZ_ACTIONS.join(", ")}. Watching a library is the host's job, not this command's.`)
    process.exitCode = 2
    return
  }

  const result = await runFindzOnHost(host, inputForAction(action, args.slice(1)), (event) => {
    if (event.message) writeProgress(host, event)
  })
  if (!result) return
  writeJson(host, result)
  if (!result.success) process.exitCode = 1
}

/**
 * One host event, on stderr.
 *
 * Stdout is reserved for the single JSON result document this face promises, because a scripted caller is
 * the only reason a GUI-only node has a command line at all; a progress line in the middle of it would
 * break `… | jq`. Progress is not an error either, so it does not go through `writeError`.
 */
function writeProgress(host: CliHost, event: OperationEvent): void {
  host.stderr.write(`findz ${event.type}: ${event.message}\n`)
}

/**
 * Positional arguments into the node's own input document, with no interpretation beyond placement.
 *
 * The core decides what is missing — `ensureLibrary()` refuses an id-only call and `requiredNumber` refuses
 * an absent archive id — so the face builds the shape and lets the host answer the rest. Re-validating it
 * here would be a second copy of the node's rules.
 */
function inputForAction(action: FindzAction, rest: string[]): FindzInput & { action: FindzAction } {
  const root = rest[0]
  const detail = rest[1]
  const input: FindzInput & { action: FindzAction } = { action }
  if (action === "api_info") return input
  if (root) input.library = { root }
  switch (action) {
    case "query_members":
      // `archiveId` is a number in the node's contract; the host refuses it when the face cannot read one.
      if (detail) input.archiveId = Number(detail)
      break
    case "task":
    case "pause":
    case "resume":
    case "cancel":
      if (detail) input.taskId = detail
      break
    case "query_archives":
    case "export_rows":
    case "treemap":
      if (detail) input.text = detail
      break
    default:
      break
  }
  return input
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
 * The host for this face process, resolved once. The memo lives in `@xiranite/cli-runtime`, because host
 * lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd })
}

/** A client bound to the resolved host, or a rejection naming what is missing. */
async function hostOperationsClient(host: CliHost): Promise<OperationsClient> {
  const handle = await resolveHostHandle(host)
  return createOperationsClient({ baseUrl: handle.attachment.baseUrl, token: handle.attachment.token })
}

/**
 * Attaches to the host, runs the operation and returns its result document, or `undefined` when the attach
 * or the transport failed — reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that fallback is
 * the compat path ADR-0074 §5 removes, and here it would additionally be a lie, because the core refuses
 * to answer at all without the host's `findz` gateway. Failures are caught here instead of thrown so
 * `process.exitCode` keeps 1 (failure) and 2 (usage) apart and stdout stays one clean document. A run that
 * simply did not work is a result with `success: false`, not a throw.
 *
 * A durable scan/analysis additionally answers Ctrl-C: the operation keeps living on the host, so leaving
 * the terminal must cancel it rather than orphan a sidecar that is still walking the library.
 */
async function runFindzOnHost(
  host: CliHost,
  input: FindzInput & { action: FindzAction },
  onEvent?: (event: OperationEvent) => void,
): Promise<FindzResult | undefined> {
  const runner = createFindzHostRunner(host)
  const durable = DURABLE_ACTIONS.includes(input.action)
  const interrupt = durable ? () => { void runner.cancel() } : undefined
  if (interrupt) process.on("SIGINT", interrupt)
  try {
    return await runner.run(input, onEvent)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return undefined
  } finally {
    if (interrupt) process.off("SIGINT", interrupt)
  }
}

/**
 * The host run for this face: one started operation, addressable until it settles.
 *
 * Exported because the control call has to be observable by a test and by an interrupt alike, and because
 * the alternative — the face keeping its own copy of the wait — is the second implementation ADR-0074 §5
 * forbids. `cancel()` is a no-op while nothing is running, so an interrupt that arrives before the start
 * answer lands cannot address somebody else's operation.
 */
export function createFindzHostRunner(host: CliHost): {
  run: (input: FindzInput & { action: FindzAction }, onEvent?: (event: OperationEvent) => void) => Promise<FindzResult>
  cancel: () => Promise<void>
} {
  let running: { client: OperationsClient; operationId: string } | undefined
  return {
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host)
      if (!DURABLE_ACTIONS.includes(input.action)) {
        // One-shot reads and the node's own task controls (`pause`, `resume`, `cancel` on an engine task)
        // answer on their own; `runOperation` is the protocol twin of that shape.
        return await client.runOperation<FindzData>(NODE_ID, input, onEvent)
      }
      const started = await client.startOperation<FindzData>(NODE_ID, input)
      running = { client, operationId: started.operationId }
      try {
        return await client.awaitOperation<FindzData>(started, onEvent)
      } finally {
        running = undefined
      }
    },
    cancel: async () => {
      if (running) await running.client.cancelOperation(running.operationId)
    },
  }
}

function createHost(): CliHost {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

if (isEntryModule(import.meta.url)) {
  await runProgram().catch((error) => {
    writeError(createHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
