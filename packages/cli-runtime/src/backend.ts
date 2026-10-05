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
 * If nothing resolves, resolution fails with a message naming all three. Falling back to a
 * local in-process node run is the compat path the rewrite removes, so it is not an option
 * here — a face that cannot attach must say so. The other §6 transport (spawn the host and read
 * its `XIRANITE_CHANNEL` stdout line) belongs to the host lane, not to this resolver.
 */
import { readFile } from "node:fs/promises"

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
