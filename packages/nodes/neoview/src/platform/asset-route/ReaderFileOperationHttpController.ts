import type { ReaderFileMutation } from "../../ports/ReaderFileMutationProvider.js"
import type { ReaderFileOperationService } from "../../application/files/ReaderFileOperationService.js"

const OPERATIONS_PATH = "/reader/files/operations"
const UNDO_PATH = "/reader/files/undo"
const MAX_BODY_BYTES = 256 * 1024

export class ReaderFileOperationHttpController {
  #service?: Promise<ReaderFileOperationService>

  constructor(private readonly loadService: () => Promise<ReaderFileOperationService>) {}

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (url.pathname !== OPERATIONS_PATH && url.pathname !== UNDO_PATH) return undefined
    if (url.pathname === OPERATIONS_PATH && request.method === "GET") {
      const service = await (this.#service ??= this.loadService())
      return jsonResponse(service.undoState())
    }
    if (url.pathname === UNDO_PATH) {
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, { allow: "POST" })
      const body = await readBody(request)
      if (!body || body.confirmed !== true) return jsonResponse({ error: "Undo requires confirmed=true" }, 409)
      try {
        const service = await (this.#service ??= this.loadService())
        return jsonResponse(await service.undoLatest(request.signal))
      } catch (error) {
        if (request.signal.aborted) throw error
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409)
      }
    }
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, { allow: "POST" })
    const body = await readBody(request)
    if (!body || !Array.isArray(body.operations)) return jsonResponse({ error: "operations must be an array" }, 400)
    if (body.operations.some(isDestructive) && body.confirmed !== true) {
      return jsonResponse({ error: "Destructive file operations require confirmed=true" }, 409)
    }
    try {
      const service = await (this.#service ??= this.loadService())
      return jsonResponse(await service.execute({
        operations: body.operations as ReaderFileMutation[],
        concurrency: body.concurrency as number | undefined,
        signal: request.signal,
      }))
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  }
}

function isDestructive(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "kind" in value && (value.kind === "delete" || value.kind === "trash"))
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}

function jsonResponse(data: unknown, status = 200, headers?: Readonly<Record<string, string>>): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  })
}
