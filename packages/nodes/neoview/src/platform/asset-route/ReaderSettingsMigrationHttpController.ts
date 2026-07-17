import type {
  ReaderSettingsImportResult,
  ReaderSettingsMigrationService,
} from "../../application/migration/ReaderSettingsMigrationService.js"
import type { ReaderSettingsPortableService } from "../../application/migration/ReaderSettingsPortableService.js"

const INSPECT_PATH = "/reader/settings/migration/inspect"
const IMPORT_PATH = "/reader/settings/migration/import"
const PORTABLE_PATH = "/reader/settings/portable"
const MAX_BODY_BYTES = 64 * 1024 * 1024 + 64 * 1024

export class ReaderSettingsMigrationHttpController {
  #service?: Promise<ReaderSettingsMigrationService>

  constructor(
    private readonly loadService: () => Promise<ReaderSettingsMigrationService>,
    private readonly runMutation: <T>(operation: () => Promise<T>) => Promise<T>,
    private readonly loadPortableService?: () => Promise<ReaderSettingsPortableService>,
  ) {}

  async handle(request: Request): Promise<Response | undefined> {
    const path = new URL(request.url).pathname
    if (path === PORTABLE_PATH) return this.#portable(request)
    if (path !== INSPECT_PATH && path !== IMPORT_PATH) return undefined
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "POST" } })
    }
    const body = await readBody(request)
    if (!body || typeof body.content !== "string") {
      return Response.json({ error: "content must be a legacy settings JSON string" }, { status: 400 })
    }
    const modules = parseModules(body.modules)
    if (modules === "invalid") return Response.json({ error: "modules must be an array of strings" }, { status: 400 })

    try {
      const service = await (this.#service ??= this.loadService())
      if (path === INSPECT_PATH) {
        if (Object.keys(body).some((key) => key !== "content" && key !== "modules")) {
          return Response.json({ error: "Settings inspection contains unsupported fields" }, { status: 400 })
        }
        const decoded = service.inspect({ content: body.content, modules })
        return Response.json({ report: decoded.report, configPatch: decoded.configPatch })
      }
      if (Object.keys(body).some((key) => !["content", "modules", "strategy", "confirmed"].includes(key))) {
        return Response.json({ error: "Settings import contains unsupported fields" }, { status: 400 })
      }
      if (body.confirmed !== true) return Response.json({ error: "Settings import requires confirmed=true" }, { status: 400 })
      const strategy = body.strategy ?? "merge"
      if (strategy !== "merge" && strategy !== "overwrite") {
        return Response.json({ error: "strategy must be merge or overwrite" }, { status: 400 })
      }
      const result = await this.runMutation(() => service.import({
        content: body.content as string,
        modules,
        strategy,
        confirmed: true,
      }))
      return Response.json(publicImportResult(result))
    } catch (error) {
      if (request.signal.aborted) throw error
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  }

  async #portable(request: Request): Promise<Response> {
    if (!this.loadPortableService) return Response.json({ error: "Portable settings are not available" }, { status: 405 })
    try {
      const service = await this.loadPortableService()
      if (request.method === "GET") {
        const content = `${JSON.stringify(await service.export(), null, 2)}\n`
        return new Response(content, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="xiranite-neoview-settings-${Date.now()}.json"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        })
      }
      if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "GET, POST" } })
      }
      const body = await readBody(request)
      if (!body || typeof body.content !== "string") {
        return Response.json({ error: "content must be a portable settings JSON string" }, { status: 400 })
      }
      if (Object.keys(body).some((key) => !["content", "strategy", "confirmed", "inspectOnly"].includes(key))) {
        return Response.json({ error: "Portable settings request contains unsupported fields" }, { status: 400 })
      }
      const payload = service.inspect(body.content)
      if (body.inspectOnly === true) return Response.json(payload)
      if (body.confirmed !== true) return Response.json({ error: "Portable settings import requires confirmed=true" }, { status: 400 })
      const strategy = body.strategy ?? "merge"
      if (strategy !== "merge" && strategy !== "overwrite") {
        return Response.json({ error: "strategy must be merge or overwrite" }, { status: 400 })
      }
      const result = await this.runMutation(() => service.import(body.content as string, strategy, true))
      return Response.json({
        format: result.payload.format,
        version: result.payload.version,
        strategy: result.strategy,
        changed: result.changed,
        backupCreated: result.backupCreated,
      })
    } catch (error) {
      if (request.signal.aborted) throw error
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  }
}

function publicImportResult(result: ReaderSettingsImportResult): Record<string, unknown> {
  return {
    report: result.decoded.report,
    configPatch: result.decoded.configPatch,
    strategy: result.strategy,
    changed: result.changed,
    backupCreated: Boolean(result.backupPath),
  }
}

function parseModules(value: unknown): string[] | undefined | "invalid" {
  if (value === undefined) return undefined
  return Array.isArray(value) && value.every((module) => typeof module === "string") ? value : "invalid"
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}
