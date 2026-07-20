import { ReaderOpdsClient, ReaderOpdsHttpError, ReaderOpdsParseError } from "../opds/ReaderOpdsClient.js"

export interface ReaderOpdsCatalogReader {
  read(url: string, signal?: AbortSignal): ReturnType<ReaderOpdsClient["read"]>
}

export class ReaderOpdsHttpController {
  constructor(private readonly client: ReaderOpdsCatalogReader = new ReaderOpdsClient()) {}

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/reader/opds/")) return undefined
    if (url.pathname !== "/reader/opds/catalog") return jsonResponse({ error: "Reader OPDS route not found" }, 404)
    if (request.method !== "GET") return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET", "cache-control": "no-store" },
    })
    const catalogUrl = url.searchParams.get("url")
    if (!catalogUrl) return jsonResponse({ error: "url is required" }, 400)
    try {
      return jsonResponse(await this.client.read(catalogUrl, request.signal))
    } catch (error) {
      if (request.signal.aborted) throw error
      if (error instanceof ReaderOpdsHttpError) {
        return jsonResponse({
          error: error.message,
          upstreamStatus: error.status,
          ...(error.authenticate ? { authenticate: error.authenticate } : {}),
        }, 502)
      }
      if (error instanceof ReaderOpdsParseError) return jsonResponse({ error: error.message }, 422)
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  })
}
