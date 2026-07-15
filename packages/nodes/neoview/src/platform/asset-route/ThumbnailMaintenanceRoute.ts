import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"

const MAINTENANCE_PATH = "/reader/thumbnails/maintenance"
const CLEANUP_PATH = "/reader/thumbnails/maintenance/cleanup"
const CLEAR_FAILURES_PATH = "/reader/thumbnails/maintenance/failures/clear"
const MAX_BODY_BYTES = 32 * 1024

export interface ThumbnailMaintenanceRouteOptions {
  token: string
  thumbnailStore?: ReaderThumbnailStore
  now?: () => number
}

export class ThumbnailMaintenanceRoute {
  readonly #token: string
  readonly #thumbnailStore?: ReaderThumbnailStore
  readonly #now: () => number

  constructor(options: ThumbnailMaintenanceRouteOptions) {
    this.#token = options.token
    this.#thumbnailStore = options.thumbnailStore
    this.#now = options.now ?? Date.now
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (url.pathname !== MAINTENANCE_PATH && url.pathname !== CLEANUP_PATH && url.pathname !== CLEAR_FAILURES_PATH) return undefined
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)
    if (url.pathname === MAINTENANCE_PATH && request.method === "GET") return this.#stats()
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: url.pathname === MAINTENANCE_PATH ? "GET" : "POST" } })
    if (request.headers.get("x-xiranite-token") !== this.#token) {
      return jsonResponse({ error: "Maintenance mutations require the authorization header" }, 401)
    }
    if (url.pathname === CLEANUP_PATH) return this.#cleanup(request)
    if (url.pathname === CLEAR_FAILURES_PATH) return this.#clearFailures(request)
    return undefined
  }

  async #stats(): Promise<Response> {
    const snapshot = this.#thumbnailStore?.maintenanceSnapshot
    if (!snapshot) return jsonResponse({ error: "Thumbnail maintenance is unavailable" }, 501)
    try {
      return jsonResponse({ snapshot: await snapshot.call(this.#thumbnailStore) })
    } catch {
      return jsonResponse({ error: "Thumbnail maintenance statistics are temporarily unavailable" }, 503)
    }
  }

  async #cleanup(request: Request): Promise<Response> {
    const cleanup = this.#thumbnailStore?.cleanup
    const body = await readBody(request)
    const limit = maintenanceLimit(body?.limit)
    if (!body || !limit || (body.kind !== "empty" && body.kind !== "expired" && body.kind !== "invalid")) {
      return jsonResponse({ error: "kind must be empty, expired or invalid and limit must be 1..1000" }, 400)
    }
    try {
      if (body.kind === "invalid") {
        const cleanupInvalid = this.#thumbnailStore?.cleanupInvalid
        const scanLimit = boundedInteger(body.scanLimit, 1, 2000) ?? 500
        if (!cleanupInvalid) return jsonResponse({ error: "Invalid-path thumbnail cleanup is unavailable" }, 501)
        return jsonResponse({ result: await cleanupInvalid.call(this.#thumbnailStore, { scanLimit, deleteLimit: limit }) })
      }
      if (!cleanup) return jsonResponse({ error: "Thumbnail cleanup is unavailable" }, 501)
      if (body.kind === "empty") {
        return jsonResponse({ deleted: await cleanup.call(this.#thumbnailStore, { kind: "empty", limit }) })
      }
      const days = boundedInteger(body.days, 1, 3650)
      if (!days || (body.preserveFolders !== undefined && body.preserveFolders !== true)) {
        return jsonResponse({ error: "expired cleanup requires days 1..3650 and must preserve folders" }, 400)
      }
      const cutoff = sqliteTimestamp(new Date(this.#now() - days * 86_400_000))
      return jsonResponse({
        deleted: await cleanup.call(this.#thumbnailStore, { kind: "expired", cutoff, limit, preserveFolders: true }),
        cutoff,
      })
    } catch {
      return jsonResponse({ error: "Thumbnail cleanup could not acquire the database writer" }, 503)
    }
  }

  async #clearFailures(request: Request): Promise<Response> {
    const clearFailures = this.#thumbnailStore?.clearFailures
    if (!clearFailures) return jsonResponse({ error: "Thumbnail failure maintenance is unavailable" }, 501)
    const body = await readBody(request)
    const limit = maintenanceLimit(body?.limit)
    const reason = body?.reason
    if (!body || !limit || (reason !== undefined && (typeof reason !== "string" || !reason || reason.length > 128))) {
      return jsonResponse({ error: "limit must be 1..1000 and reason must be a non-empty string when provided" }, 400)
    }
    try {
      return jsonResponse({
        deleted: await clearFailures.call(this.#thumbnailStore, {
          reason: typeof reason === "string" ? reason : undefined,
          limit,
        }),
      })
    } catch {
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
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}

function maintenanceLimit(value: unknown): number | undefined {
  return value === undefined ? 500 : boundedInteger(value, 1, 1000)
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined
}

function sqliteTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").slice(0, 19)
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } })
}
