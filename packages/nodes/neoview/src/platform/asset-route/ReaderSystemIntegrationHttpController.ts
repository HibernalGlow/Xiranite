import type { ReaderSystemIntegrationService } from "../../application/files/ReaderSystemIntegrationService.js"

const MAX_BODY_BYTES = 64 * 1024

export class ReaderSystemIntegrationHttpController {
  #service?: Promise<ReaderSystemIntegrationService>

  constructor(private readonly loadService: () => Promise<ReaderSystemIntegrationService>) {}

  async handle(request: Request): Promise<Response | undefined> {
    const path = new URL(request.url).pathname
    if (path !== "/reader/files/open" && path !== "/reader/files/reveal") return undefined
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "POST" } })
    const body = await readBody(request)
    if (!body || typeof body.path !== "string") return Response.json({ error: "path must be a string" }, { status: 400 })
    try {
      const service = await (this.#service ??= this.loadService())
      if (path.endsWith("/open")) await service.open(body.path, request.signal)
      else await service.reveal(body.path, request.signal)
      return new Response(null, { status: 204 })
    } catch (error) {
      if (request.signal.aborted) throw error
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}
