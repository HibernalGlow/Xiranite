import {
  FileOperationService,
  exportFileDeletions,
  type FileDeletionExportFormat,
  type FileDeletionQuery,
  type FileDeletionRecord,
  type FileOperationRequest,
  type FileOperationScope,
  type FileOperationScheduler,
} from "@xiranite/file-operations"
import { PlatformFileMutationProvider } from "@xiranite/file-operations/platform"
import type { FileDeletionRepository } from "@xiranite/repository"

const PAGE_SIZE = 1_000

export class BackendFileOperationManager {
  readonly #scoped = new Map<string, LazyScopedFileOperations>()

  constructor(
    readonly repository: FileDeletionRepository,
    private scheduler?: FileOperationScheduler,
  ) {}

  setScheduler(scheduler: FileOperationScheduler): void {
    this.scheduler = scheduler
  }

  scoped(scope: FileOperationScope): LazyScopedFileOperations {
    const key = JSON.stringify([scope.nodeId, scope.componentId ?? null, scope.workspaceId ?? null])
    let service = this.#scoped.get(key)
    if (!service) {
      service = new LazyScopedFileOperations(this.repository, scope, this.scheduler)
      this.#scoped.set(key, service)
    }
    return service
  }

  list(query: FileDeletionQuery = {}) {
    return this.repository.listFileDeletions(query)
  }

  restore(id: string, signal?: AbortSignal) {
    return this.scoped({ nodeId: "xiranite" }).restoreDeletion(id, signal)
  }

  async export(
    format: FileDeletionExportFormat,
    query: Omit<FileDeletionQuery, "cursor" | "limit"> = {},
  ) {
    const records: FileDeletionRecord[] = []
    let cursor: string | undefined
    do {
      const page = await this.repository.listFileDeletions({ ...query, cursor, limit: PAGE_SIZE })
      records.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return exportFileDeletions(records, format)
  }
}

export class LazyScopedFileOperations {
  #service?: FileOperationService

  constructor(
    private readonly repository: FileDeletionRepository,
    private readonly scope: FileOperationScope,
    private readonly scheduler?: FileOperationScheduler,
  ) {}

  execute(request: FileOperationRequest) {
    return this.service().execute(request)
  }

  undoLatest(signal?: AbortSignal) {
    return this.service().undoLatest(signal)
  }

  undoState() {
    return this.service().undoState()
  }

  discardLatest() {
    return this.service().discardLatest()
  }

  restoreDeletion(id: string, signal?: AbortSignal) {
    return this.service().restoreDeletion(id, signal)
  }

  asService(): FileOperationService {
    return this.service()
  }

  private service(): FileOperationService {
    return this.#service ??= new FileOperationService(
      new PlatformFileMutationProvider({
        scheduler: this.scheduler,
        ownerId: `${this.scope.nodeId}:file-operations`,
      }),
      this.scope,
      { journal: this.repository, deletions: this.repository },
    )
  }
}

export async function handleFileOperationRequest(
  request: Request,
  url: URL,
  manager: BackendFileOperationManager,
): Promise<Response | undefined> {
  if (url.pathname === "/file-operations" && request.method === "POST") {
    const body = await request.json().catch(() => undefined) as {
      scope?: FileOperationScope
      operations?: FileOperationRequest["operations"]
      concurrency?: number
    } | undefined
    if (!body?.scope || typeof body.scope.nodeId !== "string" || !body.scope.nodeId.trim() || !Array.isArray(body.operations)) {
      return json({ error: "scope.nodeId and operations are required" }, 400)
    }
    return json(await manager.scoped(body.scope).execute({
      operations: body.operations,
      concurrency: body.concurrency,
      signal: request.signal,
    }))
  }

  if (url.pathname === "/file-deletions/export" && request.method === "GET") {
    const format = url.searchParams.get("format") ?? "jsonl"
    if (format !== "jsonl" && format !== "csv" && format !== "markdown") {
      return json({ error: "format must be jsonl, csv or markdown" }, 400)
    }
    const exported = await manager.export(format, parseDeletionQuery(url, false))
    const date = new Date().toISOString().slice(0, 10)
    return new Response(exported.content, {
      headers: {
        "content-type": exported.contentType,
        "content-disposition": `attachment; filename="xiranite-file-deletions-${date}.${exported.extension}"`,
        "cache-control": "no-store",
        "x-xiranite-record-count": String(exported.recordCount),
      },
    })
  }

  if (url.pathname === "/file-deletions" && request.method === "GET") {
    return json(await manager.list(parseDeletionQuery(url, true)))
  }

  const restoreMatch = /^\/file-deletions\/([^/]+)\/restore$/.exec(url.pathname)
  if (restoreMatch && request.method === "POST") {
    return json(await manager.restore(decodeURIComponent(restoreMatch[1]!), request.signal))
  }
  return undefined
}

function parseDeletionQuery(url: URL, includePagination: true): FileDeletionQuery
function parseDeletionQuery(url: URL, includePagination: false): Omit<FileDeletionQuery, "cursor" | "limit">
function parseDeletionQuery(url: URL, includePagination: boolean): FileDeletionQuery {
  const state = url.searchParams.get("state")
  if (state && !["pending", "trashed", "restored", "restore-failed", "permanent", "delete-failed"].includes(state)) {
    throw Object.assign(new Error("Invalid file deletion state."), { status: 400 })
  }
  const deletionKind = url.searchParams.get("deletionKind")
  if (deletionKind && deletionKind !== "trash" && deletionKind !== "delete") {
    throw Object.assign(new Error("Invalid file deletion kind."), { status: 400 })
  }
  const query: FileDeletionQuery = {
    nodeId: optionalParam(url, "nodeId"),
    componentId: optionalParam(url, "componentId"),
    workspaceId: optionalParam(url, "workspaceId"),
    state: state as FileDeletionQuery["state"],
    deletionKind: deletionKind as FileDeletionQuery["deletionKind"],
    from: optionalNumber(url, "from"),
    to: optionalNumber(url, "to"),
  }
  if (includePagination) {
    query.cursor = optionalParam(url, "cursor")
    query.limit = optionalNumber(url, "limit")
  }
  return query
}

function optionalParam(url: URL, name: string): string | undefined {
  return url.searchParams.get(name)?.trim() || undefined
}

function optionalNumber(url: URL, name: string): number | undefined {
  const raw = optionalParam(url, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) throw Object.assign(new Error(`${name} must be a non-negative integer.`), { status: 400 })
  return value
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } })
}
