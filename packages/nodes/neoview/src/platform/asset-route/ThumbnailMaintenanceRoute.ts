import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import { ReaderThumbnailMaintenanceService } from "../../application/thumbnails/ReaderThumbnailMaintenanceService.js"

const MAINTENANCE_PATH = "/reader/thumbnails/maintenance"
const CLEANUP_PATH = "/reader/thumbnails/maintenance/cleanup"
const CLEAR_FAILURES_PATH = "/reader/thumbnails/maintenance/failures/clear"
const MAX_BODY_BYTES = 32 * 1024

export interface ThumbnailMaintenanceRouteOptions {
  token: string
  thumbnailStore?: ReaderThumbnailStore
  maintenanceService?: ReaderThumbnailMaintenanceService
  now?: () => number
}

export class ThumbnailMaintenanceRoute {
  readonly #token: string
  readonly #service: ReaderThumbnailMaintenanceService

  constructor(options: ThumbnailMaintenanceRouteOptions) {
    this.#token = options.token
    this.#service = options.maintenanceService
      ?? new ReaderThumbnailMaintenanceService(options.thumbnailStore, { now: options.now })
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (url.pathname !== MAINTENANCE_PATH && url.pathname !== CLEANUP_PATH && url.pathname !== CLEAR_FAILURES_PATH) return undefined
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)
    if (url.pathname === MAINTENANCE_PATH && request.method === "GET") return this.#stats(request.signal)
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: url.pathname === MAINTENANCE_PATH ? "GET" : "POST" } })
    if (request.headers.get("x-xiranite-token") !== this.#token) {
      return jsonResponse({ error: "Maintenance mutations require the authorization header" }, 401)
    }
    if (url.pathname === CLEANUP_PATH) return this.#cleanup(request)
    if (url.pathname === CLEAR_FAILURES_PATH) return this.#clearFailures(request)
    return undefined
  }

  async #stats(signal: AbortSignal): Promise<Response> {
    try {
      const status = await this.#service.status(signal)
      return status.enabled
        ? jsonResponse({ snapshot: status.snapshot })
        : jsonResponse({ error: "Thumbnail maintenance is unavailable" }, 501)
    } catch {
      signal.throwIfAborted()
      return jsonResponse({ error: "Thumbnail maintenance statistics are temporarily unavailable" }, 503)
    }
  }

  async #cleanup(request: Request): Promise<Response> {
    const body = await readBody(request)
    if (!body || (body.kind !== "empty" && body.kind !== "expired" && body.kind !== "invalid" && body.kind !== "path-prefix")) {
      return jsonResponse({ error: "kind must be empty, expired, invalid or path-prefix and limit must be 1..1000" }, 400)
    }
    try {
      if (body.kind === "path-prefix") {
        const prefix = boundedPathPrefix(body.prefix)
        const limit = maintenanceLimit(body.limit)
        if (!prefix || !limit) return jsonResponse({ error: "path-prefix cleanup requires a non-empty prefix and limit 1..1000" }, 400)
        const result = await this.#service.cleanup({ kind: body.kind, prefix, limit }, request.signal)
        return result.enabled && result.kind === "path-prefix"
          ? jsonResponse({ deleted: result.deleted, prefix: result.prefix })
          : jsonResponse({ error: "Path-prefix thumbnail cleanup is unavailable" }, 501)
      }
      if (body.kind === "invalid") {
        const deleteLimit = boundedInteger(body.limit, 1, 500) ?? (body.limit === undefined ? 500 : undefined)
        const scanLimit = boundedInteger(body.scanLimit, 1, 2000) ?? (body.scanLimit === undefined ? 500 : undefined)
        if (!deleteLimit || !scanLimit) {
          return jsonResponse({ error: "invalid cleanup limit must be 1..500 and scanLimit must be 1..2000" }, 400)
        }
        const result = await this.#service.cleanup({ kind: body.kind, scanLimit, deleteLimit }, request.signal)
        return result.enabled && result.kind === "invalid"
          ? jsonResponse({ result: result.result })
          : jsonResponse({ error: "Invalid-path thumbnail cleanup is unavailable" }, 501)
      }
      const limit = maintenanceLimit(body.limit)
      if (!limit) return jsonResponse({ error: "cleanup limit must be 1..1000" }, 400)
      if (body.kind === "empty") {
        const result = await this.#service.cleanup({ kind: body.kind, limit }, request.signal)
        return result.enabled && result.kind === "empty"
          ? jsonResponse({ deleted: result.deleted })
          : jsonResponse({ error: "Thumbnail cleanup is unavailable" }, 501)
      }
      const days = boundedInteger(body.days, 1, 3650)
      if (!days || (body.preserveFolders !== undefined && body.preserveFolders !== true)) {
        return jsonResponse({ error: "expired cleanup requires days 1..3650 and must preserve folders" }, 400)
      }
      const result = await this.#service.cleanup({ kind: body.kind, days, limit }, request.signal)
      return result.enabled && result.kind === "expired"
        ? jsonResponse({ deleted: result.deleted, cutoff: result.cutoff })
        : jsonResponse({ error: "Thumbnail cleanup is unavailable" }, 501)
    } catch {
      request.signal.throwIfAborted()
      return jsonResponse({ error: "Thumbnail cleanup could not acquire the database writer" }, 503)
    }
  }

  async #clearFailures(request: Request): Promise<Response> {
    const body = await readBody(request)
    const limit = maintenanceLimit(body?.limit)
    const reason = body?.reason
    if (!body || !limit || (reason !== undefined && (typeof reason !== "string" || !reason || reason.length > 128))) {
      return jsonResponse({ error: "limit must be 1..1000 and reason must be a non-empty string when provided" }, 400)
    }
    try {
      const result = await this.#service.clearFailures({
        reason: typeof reason === "string" ? reason : undefined,
        limit,
      }, request.signal)
      return result.enabled
        ? jsonResponse({ deleted: result.deleted })
        : jsonResponse({ error: "Thumbnail failure maintenance is unavailable" }, 501)
    } catch {
      request.signal.throwIfAborted()
      return jsonResponse({ error: "Thumbnail failures could not be cleared" }, 503)
    }
  }

  #isAuthorized(request: Request, url: URL): boolean {
    return request.headers.get("x-xiranite-token") === this.#token || url.searchParams.get("token") === this.#token
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return undefined
  request.signal.throwIfAborted()
  if (!request.body) return undefined

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const cancelOnAbort = () => {
    void reader.cancel(request.signal.reason).catch(() => undefined)
  }
  request.signal.addEventListener("abort", cancelOnAbort, { once: true })
  try {
    while (true) {
      request.signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      totalBytes += chunk.value.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        request.signal.throwIfAborted()
        return undefined
      }
      chunks.push(chunk.value)
    }
    request.signal.throwIfAborted()
  } finally {
    request.signal.removeEventListener("abort", cancelOnAbort)
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function maintenanceLimit(value: unknown): number | undefined {
  return value === undefined ? 500 : boundedInteger(value, 1, 1000)
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined
}

function boundedPathPrefix(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const prefix = value.trim()
  return prefix && prefix.length <= 4_096 && !prefix.includes("\0") ? prefix : undefined
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } })
}
