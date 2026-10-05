/**
 * The `/operations` HTTP client for faces that are not the React GUI.
 *
 * It is the protocol twin of `createXiraniteNodeClient()` in `./client.ts`, kept separate
 * because that one reaches the backend through `@elysiajs/eden` and the legacy Elysia app
 * type, and because ADR-0074 §5 puts the CLI/TUI faces behind the same HTTP surface: the
 * terminal shell never runs node logic itself, it starts an operation on the host and reads
 * the operation record back.
 *
 * The routes and bodies are `crates/xiranite-api/src/lib.rs:121-135` and
 * `crates/xiranite-api/src/routes.rs`, mirrored rather than invented:
 *
 * | call | route | answer |
 * | --- | --- | --- |
 * | `startOperation` | `POST /nodes/{id}/operations` | `{ operation }` in the `queued` phase |
 * | `getOperation` | `GET /node-operations/{operationId}` | `{ operation }` |
 * | `getOperationEvents` | `GET …/events` | the paged window, unwrapped |
 * | `streamOperation` | `GET …/stream` | NDJSON frames, closed after the `result` frame |
 * | `cancel/pause/resumeOperation` | `POST …/{cancel,pause,resume}` | `{ operation }` |
 *
 * Auth is the per-instance bearer token of ADR-0065, sent as `x-xiranite-token`
 * (`crates/xiranite-api/src/lib.rs:44`); the `?token=` form exists only for clients that
 * cannot set headers, and `fetch` can. Every route but `/health` answers `401 Unauthorized`
 * without it.
 *
 * This module must stay loadable by a browser bundle and by a Node/Bun terminal: only
 * `fetch` and `TextDecoder` are used, no runtime builtins and no framework.
 */

export type OperationPhase = "queued" | "running" | "paused" | "completed" | "error" | "cancelled"

/** `nodeRunEventSchema` (`packages/shared/src/index.ts:91-98`). */
export interface OperationEvent {
  type: "progress" | "log"
  progress?: number
  message: string
  data?: unknown
}

/** `nodeRunResultSchema` (`packages/shared/src/index.ts:100-106`). */
export interface OperationResult<TData = unknown> {
  success: boolean
  message: string
  data?: TData
  stats?: Record<string, number>
  outputPath?: string
}

/** `nodeOperationSchema` (`packages/shared/src/index.ts:155-168`). */
export interface OperationRecord<TData = unknown> {
  operationId: string
  nodeId: string
  componentId?: string
  workspaceId?: string
  phase: OperationPhase
  createdAt: number
  updatedAt: number
  startedAt?: number
  cancelledAt?: number
  finishedAt?: number
  eventCount: number
  result?: OperationResult<TData>
}

export interface OperationEventEntry {
  index: number
  event: OperationEvent
}

/** `nodeOperationEventsResponseSchema`: the paged window with absolute indexes. */
export interface OperationEventsPage<TData = unknown> {
  operation: OperationRecord<TData>
  events: OperationEventEntry[]
  from: number
  limit: number
  next?: number
  total: number
}

/** `nodeOperationStreamMessageSchema`: one NDJSON frame. */
export type OperationStreamMessage<TData = unknown> =
  | { type: "operation"; operation: OperationRecord<TData> }
  | { type: "event"; index: number; event: OperationEvent }
  | { type: "result"; operation: OperationRecord<TData>; result: OperationResult<TData> }

export type OperationsClientErrorKind =
  | "unauthorized"
  | "notFound"
  | "conflict"
  | "badRequest"
  | "server"
  | "network"
  | "protocol"

export interface OperationsClientErrorDetails {
  message: string
  kind: OperationsClientErrorKind
  /** The HTTP status that produced this error; absent for a transport or protocol failure. */
  status?: number
  operationId?: string
  nodeId?: string
}

/**
 * Every failure the client reports is data, not a thrown string: `kind` lets a face branch
 * (a missing host is a hint, a rejected token is a hard stop) while `message` stays the line
 * it prints. `PluginError { code, message }` from the plugin contract has no HTTP counterpart
 * yet, so a run that fails inside the node arrives as a `result` with `success: false`.
 */
export class OperationsClientError extends Error {
  readonly kind: OperationsClientErrorKind
  readonly status?: number
  readonly operationId?: string
  readonly nodeId?: string

  constructor(details: OperationsClientErrorDetails) {
    super(details.message)
    this.name = "OperationsClientError"
    this.kind = details.kind
    this.status = details.status
    this.operationId = details.operationId
    this.nodeId = details.nodeId
  }
}

export interface OperationsClientOptions {
  /** Host origin, optionally with a base path (`http://127.0.0.1:4319/_xiranite/backend`). */
  baseUrl: string
  /** Per-instance bearer token. `/health` is the only route that works without it. */
  token?: string
  /** Gap between `/events` polls when the NDJSON stream is unavailable. */
  pollIntervalMs?: number
  /** Events read per poll; the same page size `packages/api/src/index.ts` defaults to. */
  eventPageLimit?: number
}

export interface StartOperationContext {
  componentId?: string
  workspaceId?: string
}

export interface OperationsClient {
  readonly baseUrl: string
  /** `POST /nodes/{id}/operations`: registers the operation and hands it to the launcher. */
  startOperation<TData = unknown>(
    nodeId: string,
    input?: unknown,
    context?: StartOperationContext,
  ): Promise<OperationRecord<TData>>
  getOperation<TData = unknown>(operationId: string): Promise<OperationRecord<TData>>
  getOperationEvents<TData = unknown>(
    operationId: string,
    options?: { fromEventIndex?: number; limit?: number },
  ): Promise<OperationEventsPage<TData>>
  /** Reads `GET …/stream` to EOF, which the host reaches right after the `result` frame. */
  streamOperation<TData = unknown>(
    operationId: string,
    onMessage: (message: OperationStreamMessage<TData>) => void,
    options?: { fromEventIndex?: number },
  ): Promise<void>
  cancelOperation<TData = unknown>(operationId: string): Promise<OperationRecord<TData>>
  pauseOperation<TData = unknown>(operationId: string): Promise<OperationRecord<TData>>
  resumeOperation<TData = unknown>(operationId: string): Promise<OperationRecord<TData>>
  /**
   * Waits for an operation the caller already started, forwarding events as they arrive: the
   * stream first, `/events` polling when the stream cannot be held open. Split out from
   * `runOperation` because a face that offers cancel or pause needs the record it started
   * before the wait begins, and must not reimplement the wait.
   */
  awaitOperation<TData = unknown>(
    operation: OperationRecord<TData>,
    onEvent?: (event: OperationEvent) => void,
  ): Promise<OperationResult<TData>>
  /**
   * The one call a face usually needs: start, forward events, and wait for the terminal phase.
   * Returns the node's result document — the same `{ success, message, data }` the in-process
   * runner returned.
   */
  runOperation<TData = unknown>(
    nodeId: string,
    input?: unknown,
    onEvent?: (event: OperationEvent) => void,
    context?: StartOperationContext,
  ): Promise<OperationResult<TData>>
}

const TERMINAL_PHASES: readonly OperationPhase[] = ["completed", "error", "cancelled"]

export function isTerminalPhase(phase: OperationPhase): boolean {
  return TERMINAL_PHASES.includes(phase)
}

export function createOperationsClient(options: OperationsClientOptions): OperationsClient {
  const pollIntervalMs = options.pollIntervalMs ?? 200
  const eventPageLimit = options.eventPageLimit ?? 100
  const headers = tokenHeaders(options.token)

  async function send(url: URL, init: { method?: string; body?: string; accept?: string } = {}): Promise<Response> {
    try {
      const response = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          ...headers,
          ...(init.accept ? { accept: init.accept } : {}),
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
      })
      if (response.ok) return response
      throw await httpError(response, url)
    } catch (cause) {
      if (cause instanceof OperationsClientError) throw cause
      throw new OperationsClientError({
        message: `Cannot reach the Xiranite host at ${url.origin}: ${cause instanceof Error ? cause.message : String(cause)}`,
        kind: "network",
      })
    }
  }

  async function requestJson<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
    const response = await send(apiUrl(options.baseUrl, path), init)
    return (await response.json()) as T
  }

  async function operationAt(path: string, init?: { method?: string; body?: string }): Promise<OperationRecord> {
    const payload = await requestJson<{ operation?: OperationRecord }>(path, init)
    if (!payload.operation) {
      throw new OperationsClientError({ message: `Host answer for ${path} carries no operation record.`, kind: "protocol" })
    }
    return payload.operation
  }

  const client: OperationsClient = {
    baseUrl: options.baseUrl,

    async startOperation<TData>(nodeId: string, input?: unknown, context?: StartOperationContext) {
      const body = JSON.stringify(context ? { input, context } : { input })
      const operation = await operationAt(`/nodes/${encodeURIComponent(nodeId)}/operations`, {
        method: "POST",
        body,
      })
      return operation as OperationRecord<TData>
    },

    async getOperation<TData>(operationId: string) {
      return (await operationAt(`/node-operations/${encodeURIComponent(operationId)}`)) as OperationRecord<TData>
    },

    async getOperationEvents<TData>(operationId: string, eventOptions?: { fromEventIndex?: number; limit?: number }) {
      const url = apiUrl(options.baseUrl, `/node-operations/${encodeURIComponent(operationId)}/events`)
      if (eventOptions?.fromEventIndex !== undefined) url.searchParams.set("from", String(eventOptions.fromEventIndex))
      if (eventOptions?.limit !== undefined) url.searchParams.set("limit", String(eventOptions.limit))
      const response = await send(url)
      return (await response.json()) as OperationEventsPage<TData>
    },

    async streamOperation<TData>(
      operationId: string,
      onMessage: (message: OperationStreamMessage<TData>) => void,
      streamOptions?: { fromEventIndex?: number },
    ) {
      const url = apiUrl(options.baseUrl, `/node-operations/${encodeURIComponent(operationId)}/stream`)
      if (streamOptions?.fromEventIndex !== undefined) url.searchParams.set("from", String(streamOptions.fromEventIndex))
      const response = await send(url, { accept: "application/x-ndjson" })
      if (!response.body) {
        throw new OperationsClientError({
          message: `The host closed the operation stream without a body: ${operationId}`,
          kind: "protocol",
          operationId,
        })
      }
      await readNdjson(response.body, (line) => {
        onMessage(JSON.parse(line) as OperationStreamMessage<TData>)
      })
    },

    async cancelOperation<TData>(operationId: string) {
      return (await operationAt(`/node-operations/${encodeURIComponent(operationId)}/cancel`, { method: "POST" })) as OperationRecord<TData>
    },

    async pauseOperation<TData>(operationId: string) {
      return (await operationAt(`/node-operations/${encodeURIComponent(operationId)}/pause`, { method: "POST" })) as OperationRecord<TData>
    },

    async resumeOperation<TData>(operationId: string) {
      return (await operationAt(`/node-operations/${encodeURIComponent(operationId)}/resume`, { method: "POST" })) as OperationRecord<TData>
    },

    async awaitOperation<TData>(started: OperationRecord<TData>, onEvent?: (event: OperationEvent) => void) {
      let result = isTerminalPhase(started.phase) ? started.result : undefined
      let deliveredThrough = 0

      if (!result) {
        let streamError: unknown
        try {
          await client.streamOperation<TData>(started.operationId, (message) => {
            if (message.type === "event") {
              deliveredThrough = Math.max(deliveredThrough, message.index + 1)
              onEvent?.(message.event)
              return
            }
            if (message.type === "result") result = message.result
          })
        } catch (error) {
          // A rejected token or a vanished operation is a real failure; a stream the host
          // could not keep open (a proxy that buffers, a closed connection) is not, so only
          // those two kinds stop the run here.
          if (error instanceof OperationsClientError && (error.kind === "unauthorized" || error.kind === "notFound")) {
            throw error
          }
          streamError = error
        }

        if (!result) {
          result = await pollToResult<TData>(started.operationId, deliveredThrough, onEvent, streamError)
        }
      }

      if (!result) {
        throw new OperationsClientError({
          message: `Node operation ended without a result: ${started.operationId}`,
          kind: "protocol",
          operationId: started.operationId,
          nodeId: started.nodeId,
        })
      }
      return result
    },

    async runOperation<TData>(nodeId: string, input?: unknown, onEvent?: (event: OperationEvent) => void, context?: StartOperationContext) {
      const started = await client.startOperation<TData>(nodeId, input, context)
      return await client.awaitOperation<TData>(started, onEvent)
    },
  }

  return client

  async function pollToResult<TData>(
    operationId: string,
    fromEventIndex: number,
    onEvent: ((event: OperationEvent) => void) | undefined,
    streamError: unknown,
  ): Promise<OperationResult<TData> | undefined> {
    let cursor = fromEventIndex
    for (;;) {
      let page: OperationEventsPage<TData>
      try {
        page = await client.getOperationEvents<TData>(operationId, { fromEventIndex: cursor, limit: eventPageLimit })
      } catch (error) {
        // Without the stream the poll is the only way to learn anything, so the stream error
        // is the one the caller actually hit.
        if (streamError) throw streamError
        throw error
      }
      for (const entry of page.events) {
        cursor = Math.max(cursor, entry.index + 1)
        onEvent?.(entry.event)
      }
      // `next` is the absolute index to resume from; a page that is simply at the end omits it
      // and `total` is that index (`packages/api/src/index.ts`, mirrored by task-queue.ts).
      cursor = Math.max(cursor, page.next ?? page.total)
      if (isTerminalPhase(page.operation.phase)) return page.operation.result
      await sleep(pollIntervalMs)
    }
  }
}

function tokenHeaders(token: string | undefined): Record<string, string> {
  return token ? { "x-xiranite-token": token } : {}
}

async function httpError(response: Response, url: URL): Promise<OperationsClientError> {
  // The `{ error }` body is the shape both the legacy Elysia routes and `routes.rs` write
  // (`crates/xiranite-api/src/lib.rs:199`); `/health`'s 401 is the plain `Unauthorized` text.
  const detail = (await response.json().catch(() => undefined)) as { error?: string } | undefined
  const serverMessage = detail?.error?.trim() || (await response.text().catch(() => "")).trim()
  const message = `${url.pathname}: ${response.status}${serverMessage ? ` ${serverMessage}` : ""}`
  return new OperationsClientError({
    message,
    kind: errorKindForStatus(response.status),
    status: response.status,
  })
}

function errorKindForStatus(status: number): OperationsClientErrorKind {
  if (status === 401) return "unauthorized"
  if (status === 404) return "notFound"
  // `crates/xiranite-api` answers 400/401/404 today; 409 is mapped so that a host which
  // starts rejecting a control call on a finished operation surfaces as a state conflict
  // instead of a generic server error.
  if (status === 409) return "conflict"
  if (status === 400) return "badRequest"
  if (status >= 500) return "server"
  return "protocol"
}

/**
 * `URL` cannot join a base that carries a path prefix (the desktop host serves under
 * `/_xiranite/backend`), which is why `@xiranite/shared` has `appendUrlPath()`; it is inlined
 * here so the terminal does not pull zod into its graph.
 */
function apiUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl)
  const base = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname
  const suffix = path.startsWith("/") ? path : `/${path}`
  url.pathname = `${base === "/" ? "" : base}${suffix}`
  return url
}

async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    buffer = consumeLines(buffer, onLine)
  }
  buffer += decoder.decode()
  consumeLines(`${buffer}\n`, onLine)
}

function consumeLines(buffer: string, onLine: (line: string) => void): string {
  const lines = buffer.split(/\r?\n/)
  const rest = lines.pop() ?? ""
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) onLine(trimmed)
  }
  return rest
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
