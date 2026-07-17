import type {
  ReaderSettingsImportResult,
  ReaderSettingsMigrationService,
} from "../../application/migration/ReaderSettingsMigrationService.js"

const INSPECT_PATH = "/reader/settings/migration/inspect"
const IMPORT_PATH = "/reader/settings/migration/import"
const MAX_BODY_BYTES = 64 * 1024 * 1024 + 64 * 1024

export class ReaderSettingsMigrationHttpController {
  #service?: Promise<ReaderSettingsMigrationService>

  constructor(
    private readonly loadService: () => Promise<ReaderSettingsMigrationService>,
    private readonly runMutation: <T>(operation: () => Promise<T>) => Promise<T>,
  ) {}

  async handle(request: Request): Promise<Response | undefined> {
    const path = new URL(request.url).pathname
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
