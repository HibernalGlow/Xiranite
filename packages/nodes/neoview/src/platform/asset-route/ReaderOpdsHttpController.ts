import { buildReaderOpdsSearchUrl, ReaderOpdsClient, ReaderOpdsHttpError, ReaderOpdsParseError } from "../opds/ReaderOpdsClient.js"

export interface ReaderOpdsCatalogReader {
  read(url: string, signal?: AbortSignal): ReturnType<ReaderOpdsClient["read"]>
}

export class ReaderOpdsHttpController {
  constructor(private readonly client: ReaderOpdsCatalogReader = new ReaderOpdsClient()) {}

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/reader/opds/")) return undefined
    if (url.pathname !== "/reader/opds/catalog" && url.pathname !== "/reader/opds/search") return jsonResponse({ error: "Reader OPDS route not found" }, 404)
    if (request.method !== "GET") return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET", "cache-control": "no-store" },
    })
    let catalogUrl: string | undefined
    try {
      catalogUrl = this.#catalogUrl(url)
    } catch (error) {
      if (error instanceof ReaderOpdsParseError) return jsonResponse({ error: error.message }, 422)
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
    if (!catalogUrl) return jsonResponse({ error: url.pathname === "/reader/opds/search" ? "template and query are required" : "url is required" }, 400)
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

  #catalogUrl(url: URL): string | undefined {
    if (url.pathname === "/reader/opds/catalog") return url.searchParams.get("url")?.trim() || undefined
    const template = url.searchParams.get("template")?.trim()
    const query = url.searchParams.get("query") ?? ""
    if (!template || !query.trim()) return undefined
    return buildReaderOpdsSearchUrl(template, {
      query,
      count: optionalInteger(url.searchParams.get("count")),
      startPage: optionalInteger(url.searchParams.get("startPage")),
      startIndex: optionalInteger(url.searchParams.get("startIndex")),
      language: url.searchParams.get("language") ?? undefined,
    })
  }
}

function optionalInteger(value: string | null): number | undefined {
  return value === null || value === "" ? undefined : Number(value)
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  })
}
