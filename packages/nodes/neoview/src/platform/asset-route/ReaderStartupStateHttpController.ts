import type { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import type { ReaderStartupStateStore } from "../../ports/ReaderStartupStateStore.js"
import { jsonResponse, readControlJson } from "./ReaderHttpControllerHelpers.js"

export interface ReaderStartupStateHttpControllerOptions {
  library?: Pick<ReaderLibraryService, "listRecent">
  store?: ReaderStartupStateStore
}

export class ReaderStartupStateHttpController {
  constructor(private readonly options: ReaderStartupStateHttpControllerOptions) {}

  async handle(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const [lastFolder, lastBook] = await Promise.all([
        this.options.store?.getLastFolder(),
        this.options.library?.listRecent({ limit: 1, offset: 0 }),
      ])
      return jsonResponse({ lastFolder: lastFolder ?? null, lastBook: lastBook?.[0] ?? null })
    }
    if (request.method !== "PATCH") return new Response(null, { status: 405, headers: { allow: "GET, PATCH" } })
    if (!this.options.store) return jsonResponse({ error: "Reader startup folder state is unavailable." }, 501)
    const body = await readControlJson(request)
    if (!body || Object.keys(body).length !== 1 || !("lastFolder" in body) || (body.lastFolder !== null && typeof body.lastFolder !== "string")) {
      return jsonResponse({ error: "Reader startup state patch requires lastFolder as a string or null." }, 400)
    }
    try {
      if (body.lastFolder === null) {
        await this.options.store.clearLastFolder()
        return jsonResponse({ lastFolder: null })
      }
      return jsonResponse({ lastFolder: await this.options.store.saveLastFolder(body.lastFolder) })
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  }
}
