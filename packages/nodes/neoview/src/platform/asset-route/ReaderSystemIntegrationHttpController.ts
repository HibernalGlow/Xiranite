import type { ReaderSystemIntegrationService } from "../../application/files/ReaderSystemIntegrationService.js"

const MAX_BODY_BYTES = 64 * 1024
const EXPLORER_PREVIEW_PATH = "/reader/system/explorer-context-menu/preview"
const EXPLORER_STATUS_PATH = "/reader/system/explorer-context-menu/status"
const EXPLORER_SET_ENABLED_PATH = "/reader/system/explorer-context-menu"

export class ReaderSystemIntegrationHttpController {
  #service?: Promise<ReaderSystemIntegrationService>

  constructor(private readonly loadService: () => Promise<ReaderSystemIntegrationService>) {}

  async run(action: "open" | "reveal", path: string, signal?: AbortSignal): Promise<void> {
    const service = await (this.#service ??= this.loadService())
    if (action === "open") await service.open(path, signal)
    else await service.reveal(path, signal)
  }

  async explorerContextMenuPreview(signal?: AbortSignal) {
    const service = await (this.#service ??= this.loadService())
    return service.explorerContextMenuPreview(signal)
  }

  async explorerContextMenuStatus(signal?: AbortSignal) {
    const service = await (this.#service ??= this.loadService())
    return service.explorerContextMenuStatus(signal)
  }

  async setExplorerContextMenuEnabled(enabled: boolean, signal?: AbortSignal) {
    const service = await (this.#service ??= this.loadService())
    return service.explorerContextMenuSetEnabled(enabled, signal)
  }

  async handle(request: Request): Promise<Response | undefined> {
    const path = new URL(request.url).pathname
    if (path === EXPLORER_PREVIEW_PATH) {
      if (request.method !== "GET") return methodNotAllowed("GET")
      try {
        return jsonResponse(await this.explorerContextMenuPreview(request.signal))
      } catch (error) {
        if (request.signal.aborted) throw error
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    }
    if (path === EXPLORER_STATUS_PATH) {
      if (request.method !== "GET") return methodNotAllowed("GET")
      try {
        return jsonResponse(await this.explorerContextMenuStatus(request.signal))
      } catch (error) {
        if (request.signal.aborted) throw error
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    }
    if (path === EXPLORER_SET_ENABLED_PATH) {
      if (request.method !== "POST") return methodNotAllowed("POST")
      const body = await readBody(request)
      if (!body || typeof body.enabled !== "boolean") return jsonResponse({ error: "enabled must be a boolean" }, 400)
      if (body.confirmed !== true) return jsonResponse({ error: "Explorer context-menu changes require confirmed=true" }, 409)
      try {
        return jsonResponse(await this.setExplorerContextMenuEnabled(body.enabled, request.signal))
      } catch (error) {
        if (request.signal.aborted) throw error
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    }
    if (path !== "/reader/files/open" && path !== "/reader/files/reveal") return undefined
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "POST" } })
    const body = await readBody(request)
    if (!body || typeof body.path !== "string") return Response.json({ error: "path must be a string" }, { status: 400 })
    try {
      await this.run(path.endsWith("/open") ? "open" : "reveal", body.path, request.signal)
      return new Response(null, { status: 204 })
    } catch (error) {
      if (request.signal.aborted) throw error
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  }
}

function methodNotAllowed(method: string): Response {
  return jsonResponse({ error: "Method not allowed" }, 405, { allow: method })
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
