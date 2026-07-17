import type { ReaderFileMutation } from "../../ports/ReaderFileMutationProvider.js"
import type { ReaderFileOperationService } from "../../application/files/ReaderFileOperationService.js"
import {
  ReaderDirectorySelectionOperationService,
  type ReaderDirectorySelectionOperationKind,
} from "../../application/files/ReaderDirectorySelectionOperationService.js"
import {
  ReaderDirectorySelectionStaleError,
  type ReaderDirectorySelectionBatchSource,
  type ReaderDirectorySelectionDescriptor,
} from "../../application/browser/ReaderDirectorySelection.js"

const OPERATIONS_PATH = "/reader/files/operations"
const UNDO_PATH = "/reader/files/undo"
const DISCARD_UNDO_PATH = "/reader/files/undo/discard"
const SELECTION_OPERATIONS_PATH = "/reader/files/selection-operations"
const SELECTION_OPERATION_PATH = /^\/reader\/files\/selection-operations\/([^/]+)$/
const MAX_BODY_BYTES = 256 * 1024

export class ReaderFileOperationHttpController {
  #service?: Promise<ReaderFileOperationService>
  #selectionOperations?: Promise<ReaderDirectorySelectionOperationService>

  constructor(
    private readonly loadService: () => Promise<ReaderFileOperationService>,
    private readonly resolveSelection?: (
      sessionId: string,
      descriptor: ReaderDirectorySelectionDescriptor,
      signal?: AbortSignal,
    ) => Promise<ReaderDirectorySelectionBatchSource | undefined>,
  ) {}

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    const selectionOperationMatch = SELECTION_OPERATION_PATH.exec(url.pathname)
    if (url.pathname === SELECTION_OPERATIONS_PATH) return this.#startSelectionOperation(request)
    if (selectionOperationMatch) return this.#selectionOperation(selectionOperationMatch[1]!, request)
    if (url.pathname !== OPERATIONS_PATH && url.pathname !== UNDO_PATH && url.pathname !== DISCARD_UNDO_PATH) return undefined
    if (url.pathname === OPERATIONS_PATH && request.method === "GET") {
      const service = await (this.#service ??= this.loadService())
      await service.prepare()
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
    if (url.pathname === DISCARD_UNDO_PATH) {
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, { allow: "POST" })
      const body = await readBody(request)
      if (!body || body.confirmed !== true) return jsonResponse({ error: "Discarding undo state requires confirmed=true" }, 409)
      const service = await (this.#service ??= this.loadService())
      return jsonResponse(await service.discardLatest())
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

  async close(): Promise<void> {
    if (this.#selectionOperations) {
      await (await this.#selectionOperations).close()
    } else if (this.#service) {
      await (await this.#service).close()
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  async #startSelectionOperation(request: Request): Promise<Response> {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, { allow: "POST" })
    if (!this.resolveSelection) return jsonResponse({ error: "Directory selection operations are unavailable" }, 503)
    const body = await readBody(request)
    if (!body || typeof body.sessionId !== "string" || !body.sessionId || body.sessionId.length > 256
      || !body.selection || typeof body.selection !== "object"
      || (body.kind !== "delete" && body.kind !== "trash")) {
      return jsonResponse({ error: "Selection operation requires sessionId, selection and delete/trash kind" }, 400)
    }
    if (body.confirmed !== true) return jsonResponse({ error: "Destructive file operations require confirmed=true" }, 409)
    try {
      const source = await this.resolveSelection(
        body.sessionId,
        body.selection as ReaderDirectorySelectionDescriptor,
        request.signal,
      )
      if (!source) return jsonResponse({ error: "Browser session not found" }, 404)
      const service = await this.#loadSelectionOperations()
      return jsonResponse(service.start(source, body.kind as ReaderDirectorySelectionOperationKind), 202)
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse(
        { error: error instanceof Error ? error.message : String(error) },
        error instanceof ReaderDirectorySelectionStaleError ? 409 : 400,
      )
    }
  }

  async #selectionOperation(encodedId: string, request: Request): Promise<Response> {
    const id = safeDecode(encodedId)
    if (!id) return jsonResponse({ error: "Invalid selection operation id" }, 400)
    if (!this.#selectionOperations) return jsonResponse({ error: "Selection operation not found" }, 404)
    const service = await this.#selectionOperations
    const snapshot = service.get(id)
    if (!snapshot) return jsonResponse({ error: "Selection operation not found" }, 404)
    if (request.method === "GET") return jsonResponse(snapshot)
    if (request.method === "DELETE") {
      return service.cancel(id)
        ? jsonResponse({ ...service.get(id), cancelRequested: true }, 202)
        : jsonResponse({ ...snapshot, cancelRequested: false }, 409)
    }
    return jsonResponse({ error: "Method not allowed" }, 405, { allow: "GET, DELETE" })
  }

  async #loadSelectionOperations(): Promise<ReaderDirectorySelectionOperationService> {
    return this.#selectionOperations ??= (this.#service ??= this.loadService())
      .then((service) => new ReaderDirectorySelectionOperationService(service))
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

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}
