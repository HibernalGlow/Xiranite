import type { ReaderFolderRatingService } from "../../application/metadata/ReaderFolderRatingService.js"

const ROOT = "/reader/folder-ratings"

export class ReaderFolderRatingHttpController {
  constructor(private readonly service: ReaderFolderRatingService, private readonly runMutation: <T>(operation: () => Promise<T>) => Promise<T>) {}

  async handle(request: Request): Promise<Response | undefined> {
    const path = new URL(request.url).pathname
    if (!path.startsWith(ROOT)) return undefined
    if (path === ROOT && request.method === "GET") return json(await this.service.load())
    if (path === `${ROOT}/rebuild` && request.method === "POST") return json(await this.runMutation(() => this.service.rebuild(request.signal)))
    if (path === `${ROOT}/supplement` && request.method === "POST") {
      const body = await request.json().catch(() => undefined) as { path?: unknown } | undefined
      if (!body || typeof body.path !== "string") return json({ error: "path must be a string" }, 400)
      const folderPath = body.path
      return json(await this.runMutation(() => this.service.supplement(folderPath)))
    }
    if (path === ROOT && request.method === "DELETE") {
      await this.runMutation(() => this.service.clear())
      return new Response(null, { status: 204 })
    }
    return json({ error: "Method not allowed" }, 405)
  }
}

function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }) }
