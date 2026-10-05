/**
 * Host attach for the terminal faces (ADR-0074 §5).
 *
 * A CLI/TUI shell holds no business state and never runs a node bundle itself: it finds a
 * running Xiranite host and talks to it over `/operations`. Finding that host is the whole
 * job of this module, and it is deliberately free of prompts, colours and help rendering so
 * that `packages/cli-runtime` stays a library and each face keeps its own composition.
 *
 * Resolution order, first hit wins per field:
 *
 * 1. explicit flags on the face's own command line (`--backend <url> --token <token>`)
 * 2. `XIRANITE_BACKEND_URL` + `XIRANITE_BACKEND_TOKEN` (the same names the task-queue
 *    controller already reads in `./tui/task-queue.ts`)
 * 3. a channel file at `--channel-file <path>` / `$XIRANITE_CHANNEL_FILE`, JSON
 *    `{ baseUrl, token, instanceId }` — ADR-0074 §6's non-child transport, where the path is handed
 *    in by the caller and never guessed
 *
 * If nothing is configured at all, the face starts its own host: §6's child pipe is the default transport
 * ("the shell spawns the host as its own child and reads the channel line off that child's stdout; this case
 * writes nothing to disk"), and §5 names the host lifecycle — spawn-or-attach, TTL, shutdown — as CLI work.
 * Falling back to a local in-process node run stays forbidden: that is the rejected shape, not a fallback.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { Readable } from "node:stream"

import { createOperationsClient, type OperationsClient } from "@xiranite/api/operationsClient"

/**
 * The client surface a face needs, re-exported here so a node package attaches through one
 * module and never depends on `@xiranite/api` directly.
 */
export { createOperationsClient, OperationsClientError } from "@xiranite/api/operationsClient"
export type {
  OperationEvent,
  OperationPhase,
  OperationRecord,
  OperationResult,
  OperationStreamMessage,
  OperationsClient,
  OperationsClientOptions,
  StartOperationContext,
} from "@xiranite/api/operationsClient"

export const HOST_BACKEND_URL_ENV = "XIRANITE_BACKEND_URL"
export const HOST_BACKEND_TOKEN_ENV = "XIRANITE_BACKEND_TOKEN"
export const HOST_CHANNEL_FILE_ENV = "XIRANITE_CHANNEL_FILE"
/** Which host binary §6's child-pipe transport starts. Without it a source checkout is searched. */
export const HOST_BIN_ENV = "XIRANITE_HOST_BIN"
/**
 * The child's own leak guard. Generous because an interactive TUI session holds one host for its whole
 * life and the face stops it anyway; the TTL only catches an orphan after a crash.
 */
export const HOST_TTL_SECONDS = 3_600
/** How long to wait for the spawned host's `XIRANITE_CHANNEL` line. */
export const HOST_START_TIMEOUT_MS = 15_000

export interface HostAttachment {
  baseUrl: string
  token: string
  /**
   * The host process identity used to invalidate cached client state (ADR-0065). Only the
   * channel file publishes it: `crates/xiranite-api/src/routes.rs:30-36` keeps `/health`
   * free of it, and flags/env carry no instance, so a flag attach leaves this undefined.
   */
  instanceId?: string
}

export interface HostAttachSources {
  env: Record<string, string | undefined>
  /** The face's raw argv, before its own command router consumed it. */
  args?: readonly string[]
  /** Used to find a `target/<profile>/xiranite-dev-host` in a source checkout when starting one. */
  cwd?: string
}

interface ChannelFileContents {
  baseUrl?: unknown
  token?: unknown
  instanceId?: unknown
}

export class HostAttachmentError extends Error {
  readonly kind: "missing" | "invalid"

  constructor(message: string, kind: "missing" | "invalid" = "invalid") {
    super(`${message}\n${ATTACH_HINT}`)
    this.name = "HostAttachmentError"
    this.kind = kind
  }
}

const ATTACH_HINT = [
  "Attach a running Xiranite host in one of these ways:",
  `  1. flags:      --backend <url> --token <token>`,
  `  2. environment: ${HOST_BACKEND_URL_ENV}=<url> and ${HOST_BACKEND_TOKEN_ENV}=<token>`,
  `  3. channel file: --channel-file <path> or ${HOST_CHANNEL_FILE_ENV}=<path> holding {"baseUrl":...,"token":...,"instanceId":...}`,
  `  4. nothing: this face starts a host of its own and stops it again (pick the binary with ${HOST_BIN_ENV}).`,
].join("\n")

/** The attach flags a face strips from its own argv. */
export type HostAttachFlag = "backend" | "token" | "channelFile"

/**
 * Splits the attach flags out of a face's argv. The face then routes the remainder itself, so
 * the flags never show up as node parameters and never reach a node input document.
 */
export function extractHostAttachArgs(args: readonly string[]): { flags: Partial<Record<HostAttachFlag, string>>; remaining: string[] } {
  const flags: Partial<Record<HostAttachFlag, string>> = {}
  const remaining: string[] = []
  // `--backend`/`--token`/`--channel-file` also accept the `--flag=value` spelling.
  const longFlags: Record<string, HostAttachFlag> = { "--backend": "backend", "--token": "token", "--channel-file": "channelFile" }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    const separator = arg.indexOf("=")
    const inlineName = separator > 0 ? longFlags[arg.slice(0, separator)] : undefined
    if (inlineName) {
      flags[inlineName] = arg.slice(separator + 1)
      continue
    }
    const name = longFlags[arg]
    if (name && index + 1 < args.length) {
      flags[name] = args[index + 1]
      index += 1
      continue
    }
    remaining.push(arg)
  }
  return { flags, remaining }
}

export async function resolveHostAttachment(sources: HostAttachSources): Promise<HostAttachment> {
  const flags = sources.args ? extractHostAttachArgs(sources.args).flags : {}
  const channel = await readChannelFile(pick(flags.channelFile, sources.env[HOST_CHANNEL_FILE_ENV]))

  const baseUrl = pick(flags.backend, sources.env[HOST_BACKEND_URL_ENV], text(channel?.baseUrl))
  const token = pick(flags.token, sources.env[HOST_BACKEND_TOKEN_ENV], text(channel?.token))
  if (baseUrl === undefined || token === undefined) {
    const missing = baseUrl === undefined ? "no host url" : "no bearer token"
    throw new HostAttachmentError(`Cannot attach to a Xiranite host: ${missing}.`, "missing")
  }

  return { baseUrl: normalizeBaseUrl(baseUrl), token, instanceId: text(channel?.instanceId) }
}

/** Resolves the attach and hands back a client bound to it. */
export async function createHostOperationsClient(sources: HostAttachSources): Promise<OperationsClient> {
  const attachment = await resolveHostAttachment(sources)
  return createOperationsClient({ baseUrl: attachment.baseUrl, token: attachment.token })
}

/**
 * Resolves the attach *and* proves something answers, before a face has asked the operator anything.
 *
 * A guided run that collects seven prompts and only then reports that no host is reachable spends the
 * operator's attention to deliver a message they could have been given first. `/health` is the probe
 * because it is the one route `crates/xiranite-api` serves without the bearer token, so this checks
 * liveness without also asserting the token is right — a live host with a bad token still fails later,
 * in the place where the face can say which of the two is wrong.
 */
export async function assertHostReachable(sources: HostAttachSources, timeoutMs = 2_000): Promise<HostAttachment> {
  const attachment = await resolveHostAttachment(sources)
  let response: Response
  try {
    // Concatenated rather than `new URL("/health", base)`, which would drop a base path: the legacy
    // backend is served under `/_xiranite/backend`, the Rust host at the origin root.
    response = await fetch(`${attachment.baseUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (cause) {
    throw new HostAttachmentError(
      `The Xiranite host at ${attachment.baseUrl} does not answer /health: ${cause instanceof Error ? cause.message : String(cause)}`,
      "missing",
    )
  }
  if (!response.ok) {
    throw new HostAttachmentError(
      `The Xiranite host at ${attachment.baseUrl} answered /health with ${response.status}; that port is not a Xiranite backend.`,
      "invalid",
    )
  }
  return attachment
}

/**
 * A host the face can talk to, plus the way to let go of it.
 *
 * `spawned` is the difference that matters to the operator: an attached host keeps running when this
 * face leaves, a started one belongs to this process and must not outlive it.
 */
export interface HostHandle {
  attachment: HostAttachment
  spawned: boolean
  /** Stops a host this face started; a no-op on an attached one. */
  stop(): Promise<void>
}

/**
 * The transport ADR-0074 §6 calls the default: attach to a host that is already configured and
 * answering, otherwise start one as a child of this process and read its channel off the pipe.
 *
 * Attach wins even when it is wrong. A half-configured attach (a url with no token, a channel file
 * that cannot be read) is reported instead of quietly starting a second host the operator did not ask
 * for, because two hosts on one filesystem means two owners of the same operation history.
 */
export async function attachOrStartHost(sources: HostAttachSources, startTimeoutMs = HOST_START_TIMEOUT_MS): Promise<HostHandle> {
  if (isHostAttachConfigured(sources)) {
    return { attachment: await assertHostReachable(sources), spawned: false, stop: async () => {} }
  }
  return startHostChild(sources, startTimeoutMs)
}

/** True when the operator named a host at all; anything else means this face owns the host lifecycle. */
export function isHostAttachConfigured(sources: HostAttachSources): boolean {
  const flags = sources.args ? extractHostAttachArgs(sources.args).flags : {}
  return Boolean(
    pick(flags.channelFile, sources.env[HOST_CHANNEL_FILE_ENV]) ??
      pick(flags.backend, sources.env[HOST_BACKEND_URL_ENV]) ??
      pick(flags.token, sources.env[HOST_BACKEND_TOKEN_ENV]),
  )
}

const CHANNEL_LINE_PREFIX = "XIRANITE_CHANNEL "
/** How much of the child's stderr is quoted back when it fails to publish a channel. */
const STDERR_TAIL_LIMIT = 2_000

async function startHostChild(sources: HostAttachSources, startTimeoutMs: number): Promise<HostHandle> {
  const binary = findHostBinary(sources)
  const child = spawn(binary, ["--ttl-seconds", String(HOST_TTL_SECONDS)], {
    cwd: sources.cwd ?? process.cwd(),
    env: childEnvironment(sources),
    stdio: ["ignore", "pipe", "pipe"],
  })
  const attachment = await readChannelLine(child, binary, startTimeoutMs)

  // The channel has arrived, so the pipes are no longer read for their contents. Draining keeps the host
  // from blocking on a full pipe for the rest of a long session.
  child.stdout?.resume()
  child.stderr?.resume()
  // `child.unref()` does not reach the stdio handles, so a flowing pipe keeps the *parent* alive: measured
  // here, `dissolvef plan` started its own host, printed its JSON, and then never exited. Unref-ing the
  // socket itself keeps the drain running while letting a face that forgot to call `stop()` still exit —
  // its orphaned host then dies on its own TTL instead of hanging a terminal.
  unrefPipe(child.stdout)
  unrefPipe(child.stderr)
  child.unref()
  // Covers the paths that do not run async cleanup: a normal exit, and any face that never calls stop().
  // A signal-killed parent runs neither, which is what the child's own TTL is for.
  process.once("exit", () => {
    child.kill("SIGTERM")
  })
  return { attachment, spawned: true, stop: () => stopChild(child) }
}

/** `Readable` has no `unref`; a child stdio pipe is a `Socket` at runtime and does. */
function unrefPipe(stream: Readable | null | undefined): void {
  const maybeSocket = stream as unknown as { unref?: () => void } | null | undefined
  maybeSocket?.unref?.()
}

function childEnvironment(sources: HostAttachSources): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(sources.env)) {
    if (value !== undefined) env[key] = value
  }
  // The channel goes to this pipe, not to disk: `xiranite-dev-host` publishes a file for processes that
  // are not its children, so inheriting one would drop a bearer token at a path nobody asked for.
  delete env[HOST_CHANNEL_FILE_ENV]
  return env
}

/**
 * The host binary, in the order an operator can actually influence it: `$XIRANITE_HOST_BIN`, then a
 * `target/<profile>/xiranite-dev-host` in this checkout. `debug` is searched first because
 * `crates/xiranite-loopback-host/src/bin/dev_host.rs:36-42` refuses to print a channel from a release
 * build; a checkout with only a release host is tried anyway, and the child's own refusal becomes the error.
 */
function findHostBinary(sources: HostAttachSources): string {
  const configured = sources.env[HOST_BIN_ENV]?.trim()
  if (configured) {
    const path = resolve(sources.cwd ?? process.cwd(), configured)
    if (!existsSync(path)) throw new HostAttachmentError(`${HOST_BIN_ENV} points at ${path}, which does not exist.`, "missing")
    return path
  }
  const name = process.platform === "win32" ? "xiranite-dev-host.exe" : "xiranite-dev-host"
  let directory = resolve(sources.cwd ?? process.cwd())
  for (let depth = 0; depth < 6; depth += 1) {
    for (const profile of ["debug", "release"]) {
      const candidate = join(directory, "target", profile, name)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new HostAttachmentError(
    `No host was configured and no ${name} was found from ${resolve(sources.cwd ?? process.cwd())}. ` +
      `Set ${HOST_BIN_ENV}, or build the headless host with \`cargo build -p xiranite-loopback-host --bin xiranite-dev-host\`.`,
  )
}

/** Resolves when the child prints its `XIRANITE_CHANNEL` line; rejects on exit, on a bad line, or on timeout. */
function readChannelLine(child: ChildProcessByStdio<null, Readable, Readable>, binary: string, timeoutMs: number): Promise<HostAttachment> {
  return new Promise<HostAttachment>((resolvePromise, reject) => {
    let stdoutTail = ""
    let stderrTail = ""
    let settled: ChannelOutcome | undefined

    const push = (buffer: string, chunk: string): string => {
      const next = buffer + chunk
      return next.length > STDERR_TAIL_LIMIT ? next.slice(next.length - STDERR_TAIL_LIMIT) : next
    }
    const finish = (): void => {
      if (!settled) return
      const outcome = settled
      clearTimeout(timer)
      child.stdout?.off("data", onStdout)
      child.stderr?.off("data", onStderr)
      child.off("exit", onExit)
      if (outcome.ok) {
        resolvePromise(outcome.attachment)
        return
      }
      void stopChild(child).finally(() => reject(outcome.error))
    }
    const onStdout = (chunk: string): void => {
      stdoutTail = push(stdoutTail, String(chunk))
      let newline = stdoutTail.indexOf("\n")
      while (newline >= 0) {
        const line = stdoutTail.slice(0, newline)
        stdoutTail = stdoutTail.slice(newline + 1)
        if (line.startsWith(CHANNEL_LINE_PREFIX)) {
          const parsed = parseChannelDocument(line.slice(CHANNEL_LINE_PREFIX.length))
          settled = parsed
            ? { ok: true, attachment: parsed }
            : { ok: false, error: new HostAttachmentError(`The host at ${binary} published an unusable channel line: ${line}`, "invalid") }
          finish()
          return
        }
        newline = stdoutTail.indexOf("\n")
      }
    }
    const onStderr = (chunk: string): void => {
      stderrTail = push(stderrTail, String(chunk))
    }
    const onExit = (code: number | null, signal: string | null): void => {
      if (settled) return
      const reason = stderrTail.trim() ? ` It said:\n${stderrTail.trim()}` : ""
      settled = {
        ok: false,
        error: new HostAttachmentError(
          `The host at ${binary} exited (${code ?? signal}) before publishing a channel.${reason}`,
          "missing",
        ),
      }
      finish()
    }
    const timer = setTimeout(() => {
      if (settled) return
      const reason = stderrTail.trim() ? ` It said:\n${stderrTail.trim()}` : ""
      settled = {
        ok: false,
        error: new HostAttachmentError(`The host at ${binary} did not publish a channel within ${timeoutMs}ms.${reason}`, "missing"),
      }
      finish()
    }, timeoutMs)

    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", onStdout)
    child.stderr?.on("data", onStderr)
    child.once("exit", onExit)
    child.once("error", (error: Error) => {
      if (settled) return
      settled = { ok: false, error: new HostAttachmentError(`The host at ${binary} could not be started: ${error.message}`, "missing") }
      finish()
    })
  })
}

type ChannelOutcome = { ok: true; attachment: HostAttachment } | { ok: false; error: HostAttachmentError }

/** The one JSON document `channel_document` prints; `undefined` when it is not a usable channel. */
function parseChannelDocument(value: string): HostAttachment | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
  const contents = parsed as ChannelFileContents
  const baseUrl = text(contents.baseUrl)
  const token = text(contents.token)
  if (!baseUrl || !token) return undefined
  try {
    return { baseUrl: normalizeBaseUrl(baseUrl), token, instanceId: text(contents.instanceId) }
  } catch {
    return undefined
  }
}

function stopChild(child: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  return new Promise((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveStop()
      return
    }
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveStop()
    }
    // Both events, because the window where the child is reaped but `exit` has not reached a listener
    // registered after the fact is real: `exit` after `stop()` was awaited forever in a probe here, and
    // an unref'd fallback timer cannot fire once the pipes have closed, so the promise stayed pending.
    // Measured: `stop()` resolving is what lets the face exit.
    child.once("exit", settle)
    child.once("close", settle)
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      settle()
    }, 2_000)
    child.kill("SIGTERM")
  })
}

/**
 * The attach-or-start result for a whole face process, memoized by the inputs that decide it.
 *
 * One invocation must drive one host: without this, a run that starts its own child would start another
 * for every operation and control call, and each of those would hold its own view of the same files.
 * A half-configured attach is remembered as a failure too, so the operator sees one message per run.
 */
let sharedHandle: { key: string; promise: Promise<HostHandle> } | undefined

export function sharedHostHandle(sources: HostAttachSources, startTimeoutMs = HOST_START_TIMEOUT_MS): Promise<HostHandle> {
  const key = hostCacheKey(sources)
  if (sharedHandle?.key !== key) sharedHandle = { key, promise: attachOrStartHost(sources, startTimeoutMs) }
  return sharedHandle.promise
}

/** Stops the host this process started, if any. Called from the face's own teardown, not from a signal. */
export async function stopSharedHost(): Promise<void> {
  const pending = sharedHandle
  sharedHandle = undefined
  if (!pending) return
  await pending.promise.then((handle) => handle.stop(), () => {})
}

/** Every input `attachOrStartHost` reads, so two different attach targets can never share one host. */
function hostCacheKey(sources: HostAttachSources): string {
  return [
    sources.args?.join("\u0001"),
    sources.env[HOST_BACKEND_URL_ENV],
    sources.env[HOST_BACKEND_TOKEN_ENV],
    sources.env[HOST_CHANNEL_FILE_ENV],
    sources.env[HOST_BIN_ENV],
    sources.cwd,
  ].join("\u0000")
}

function pick(...candidates: (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : ""
    if (value) return value
  }
  return undefined
}

/** The channel file is JSON with `unknown` values, so every field is read as optional text. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

async function readChannelFile(path: string | undefined): Promise<ChannelFileContents | undefined> {
  const file = path?.trim()
  if (!file) return undefined
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (cause) {
    throw new HostAttachmentError(`Channel file ${file} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`, "missing")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new HostAttachmentError(`Channel file ${file} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`, "invalid")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HostAttachmentError(`Channel file ${file} must hold a JSON object.`, "invalid")
  }
  return parsed as ChannelFileContents
}

/**
 * The host binds `127.0.0.1` with an OS-assigned port, so a bare `host:port` is a common way
 * to paste an attach target; accept it and default to http rather than failing on a typo.
 */
function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new HostAttachmentError(`Host url ${value} is not a URL.`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HostAttachmentError(`Host url ${value} must be http or https.`)
  }
  return withScheme
}
