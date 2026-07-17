import type { ReaderBookSettingsMigrationService } from "../../application/migration/ReaderBookSettingsMigrationService.js"

const INSPECT_PATH = "/reader/book-settings/migration/inspect"
const IMPORT_PATH = "/reader/book-settings/migration/import"
const MAX_BODY_BYTES = 64 * 1024 * 1024 + 64 * 1024
const MAX_CONTENT_BYTES = 64 * 1024 * 1024

export class ReaderBookSettingsMigrationHttpController {
  #service?: Promise<ReaderBookSettingsMigrationService>

  constructor(private readonly loadService: () => Promise<ReaderBookSettingsMigrationService>) {}

  async handle(request: Request): Promise<Response | undefined> {
    const path = new URL(request.url).pathname
    if (path !== INSPECT_PATH && path !== IMPORT_PATH) return undefined
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, { allow: "POST" })
    const body = await readBody(request)
    const allowed = path === INSPECT_PATH ? new Set(["content"]) : new Set(["content", "strategy", "confirmed"])
    if (!body || typeof body.content !== "string" || !body.content.trim()
      || Buffer.byteLength(body.content, "utf8") > MAX_CONTENT_BYTES
      || Object.keys(body).some((key) => !allowed.has(key))) {
      return jsonResponse({ error: "Legacy book settings request is invalid" }, 400)
    }
    const service = await this.#load()
    let inspection
    try {
      inspection = service.inspect(body.content)
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
    if (path === INSPECT_PATH) return jsonResponse(inspection)
    const strategy = body.strategy ?? "merge"
    if ((strategy !== "merge" && strategy !== "overwrite") || body.confirmed !== true) {
      return jsonResponse({ error: "Import requires strategy merge|overwrite and confirmed=true" }, 400)
    }
    try {
      const result = await service.import(body.content, strategy, true, request.signal)
      return jsonResponse({ report: inspection.report, result })
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 500)
    }
  }

  #load(): Promise<ReaderBookSettingsMigrationService> {
    return this.#service ??= this.loadService()
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}

function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
