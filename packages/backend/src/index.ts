import { createXiraniteApp } from "@xiranite/api"
import { LogEnvelopeSchema, createLogEnvelope, createLogSession, type LogEnvelope } from "@xiranite/logging"
import { resolveLogDirectory, RotatingJsonlLogWriter, type LogWriterOptions } from "@xiranite/logging/node"
import {
  createMemoryMelodeckRepository,
  type FileDeletionRepository,
  type MelodeckRepository,
  type NodeRunHistoryRepository,
  type WorkspaceRepository,
} from "@xiranite/repository"
import {
  createLibsqlMelodeckRepository,
  createLibsqlWorkspaceRepository,
  type LibsqlMelodeckRepository,
  type LibsqlWorkspaceRepository,
} from "@xiranite/repository/libsql"
import {
  createXiraniteServices,
  ResourceSchedulerService,
  type NodeRunner,
  type NodeMemoryProtectionOptions,
  type ResourceScheduler,
  type XiraniteSystemService,
} from "@xiranite/services"
import { NODE_MEMORY_PROTECTION_APP_SECTION } from "@xiranite/shared"
import { randomBytes } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { parseArgs } from "node:util"
import {
  createBackendOperationalPersistence,
  resolveBackendDatabaseConfig,
  resolveBackendDataDir,
  type BackendDatabaseConfig,
} from "./backendPersistence.js"
import { createBackendNodeMemoryProtectionController, createBackendNodeRunner } from "./nodeRunner.js"
import { createBackendResourceScheduler } from "./resourceScheduler.js"
import { BackendFileOperationManager, handleFileOperationRequest } from "./fileOperations.js"
import { pickLocalPaths } from "./localFilePicker.js"
import { clearFileClipboard, NativeFileClipboardUnavailableError, readFilesFromClipboard, writeFilesToClipboard } from "./fileClipboard.js"
import { getDevelopmentSourceHotReloadEnabled, loadNodePlatformModule, setDevelopmentSourceHotReloadEnabled } from "@xiranite/runtime/node-runner"
import { parseNodeAppDataContractVersion, recordNodeAppDataContract } from "./nodeAppDataContract.js"
import { handleMelodeckRequest } from "./melodeck.js"

export interface CreateDefaultBackendOptions {
  now?: number
  repository?: WorkspaceRepository
  historyRepository?: NodeRunHistoryRepository
  fileDeletionRepository?: FileDeletionRepository
  melodeckRepository?: MelodeckRepository
  configPath?: string
  databaseUrl?: string
  databasePath?: string
  databaseAuthToken?: string
  dataDir?: string
  legacyThumbnailDatabasePath?: string | false
  legacyEmmDatabasePaths?: readonly string[] | false
  nodeRunner?: NodeRunner
  nodeMemoryProtection?: NodeMemoryProtectionOptions
  resourceScheduler?: ResourceSchedulerService
  system?: XiraniteSystemService
  onHistoryRecordError?: (error: unknown) => void
}

export interface StartBackendOptions extends CreateDefaultBackendOptions {
  hostname?: string
  port?: number
  token?: string
  publicBaseUrl?: string
  writeClipboardFiles?: (paths: string[]) => Promise<void>
  readClipboardFiles?: () => Promise<string[]>
  clearClipboardFiles?: () => Promise<void>
  logDirectory?: string
  logWriter?: BackendLogWriter
  /**
   * Explicitly records the shared configuration/database contract after this
   * backend has finished its normal initialization. Desktop hosts opt in;
   * ordinary test backends never write to a user's node-app marker.
   */
  dataContractVersion?: number
}

export interface BackendLogWriter {
  append(events: readonly LogEnvelope[]): Promise<void>
  close(): Promise<void>
}

export interface BackendCliOptions extends StartBackendOptions {
  help?: boolean
}

export { resolveBackendDatabaseConfig, resolveBackendDataDir } from "./backendPersistence.js"
export type { BackendDatabaseConfig } from "./backendPersistence.js"

export interface XiraniteBackendApp {
  app: ReturnType<typeof createXiraniteApp>
  repository: WorkspaceRepository
  historyRepository?: NodeRunHistoryRepository
  fileDeletionRepository: FileDeletionRepository
  melodeckRepository: MelodeckRepository
  fileOperations: BackendFileOperationManager
  database?: BackendDatabaseConfig
  resources: ResourceSchedulerService
  close(): void
}

export async function createDefaultBackendApp(options: CreateDefaultBackendOptions = {}) {
  const backend = await createDefaultBackend(options)
  return backend.app
}

export async function createDefaultBackend(options: CreateDefaultBackendOptions = {}): Promise<XiraniteBackendApp> {
  const database = options.repository ? undefined : resolveBackendDatabaseConfig(options)
  const ownsResourceScheduler = options.resourceScheduler === undefined
  const resourceScheduler = options.resourceScheduler ?? createBackendResourceScheduler()
  const repository = options.repository ?? await createDefaultRepository(database!)
  const operationalPersistence = await createBackendOperationalPersistence({
    ...options,
    database: database ?? false,
  })
  const historyRepository = operationalPersistence.historyRepository
  const fileDeletionRepository = operationalPersistence.fileDeletionRepository
  const melodeckRepository = options.melodeckRepository
    ?? (database ? await createDefaultMelodeckRepository(database) : createMemoryMelodeckRepository())
  const fileOperations = new BackendFileOperationManager(fileDeletionRepository, resourceScheduler)
  await ensureDefaultWorkspace(repository, options.now ?? Date.now())
  const memoryProtection = createBackendNodeMemoryProtectionController(process.env, options.nodeMemoryProtection)

  const services = createXiraniteServices(repository, {
    nodeRunner: options.nodeRunner ?? createBackendNodeRunner({ fileOperations, resourceScheduler }),
    configPath: options.configPath,
    databasePath: database?.path,
    dataDir: options.dataDir,
    historyRepository,
    resourceScheduler,
    system: {
      ...options.system,
      getNodeSourceHotReload: getDevelopmentSourceHotReloadEnabled,
      setNodeSourceHotReload: setDevelopmentSourceHotReloadEnabled,
      getNodeMemoryProtection: memoryProtection.getSettings,
      setNodeMemoryProtection: memoryProtection.applySettings,
    },
    onHistoryRecordError: options.onHistoryRecordError,
    nodeMemoryProtection: memoryProtection.options,
  })
  await services.config.ensureConfigFile()
  if (options.nodeMemoryProtection === undefined) {
    const persisted = await services.config.getAppConfig(NODE_MEMORY_PROTECTION_APP_SECTION)
    memoryProtection.applySettings(persisted.config)
  }
  fileOperations.setScheduler(services.resources)

  return {
    app: createXiraniteApp(services),
    repository,
    historyRepository,
    fileDeletionRepository,
    melodeckRepository,
    fileOperations,
    database,
    resources: resourceScheduler,
    close() {
      closeRepository(repository)
      operationalPersistence.close()
      closeMelodeckRepository(melodeckRepository)
      if (ownsResourceScheduler) resourceScheduler.close()
    },
  }
}

export async function startBackend(options: StartBackendOptions = {}) {
  const hostname = options.hostname ?? "127.0.0.1"
  const token = options.token ?? randomToken()
  const instanceId = randomBytes(12).toString("hex")
  const logSession = createLogSession()
  const logWriter = options.logWriter ?? createBackendLogWriter({
    directory: options.logDirectory,
    source: "xiranite",
    sessionId: logSession.id,
  })
  const logTarget = options.logWriter
    ? { kind: "custom-writer" as const }
    : { kind: "rotating-jsonl" as const, directory: resolveLogDirectory(options.logDirectory) }
  const backend = await createDefaultBackend({
    ...options,
    onHistoryRecordError: options.onHistoryRecordError ?? ((error) => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      void logWriter.append([createLogEnvelope({
        severityText: "error",
        eventName: "runtime.history.record_failed",
        body: normalized.message,
        resource: {
          serviceName: "xiranite",
          processType: "backend",
          processId: process.pid,
          runtimeName: process.versions.bun ? "bun" : "node",
          runtimeVersion: process.versions.bun ?? process.version,
        },
        scope: { name: "services.history" },
        session: logSession,
        error: { name: normalized.name, message: normalized.message, ...(normalized.stack ? { stack: normalized.stack } : {}) },
      })]).catch(() => undefined)
    }),
  })
  if (options.dataContractVersion !== undefined) {
    try {
      await recordNodeAppDataContract(options.dataContractVersion)
    } catch (error) {
      backend.close()
      throw error
    }
  }
  let backendUrl = ""
  let readerController: Promise<BackendRequestController> | undefined
  let stagingDirectory: Promise<string> | undefined
  const server = createServer(async (incoming, outgoing) => {
    const requestController = new AbortController()
    const abortIncoming = () => requestController.abort(new Error("Client disconnected"))
    const abortOutgoing = () => {
      if (!outgoing.writableFinished) requestController.abort(new Error("Client disconnected"))
    }
    incoming.once("aborted", abortIncoming)
    outgoing.once("close", abortOutgoing)
    try {
      const request = toFetchRequest(incoming, requestController.signal)
      const url = new URL(request.url)
      if (request.method === "OPTIONS") {
        await writeNodeResponse(outgoing, new Response(null, { status: 204 }))
        return
      }

      if (url.pathname === "/health") {
        await writeNodeResponse(outgoing, Response.json({ ok: true, instanceId }))
        return
      }

      const authorized = request.headers.get("x-xiranite-token") === token || url.searchParams.get("token") === token
      if (url.pathname !== "/health" && !authorized) {
        await writeNodeResponse(outgoing, new Response("Unauthorized", { status: 401 }))
        return
      }

      if (url.pathname === "/local-files/list") {
        await writeNodeResponse(outgoing, await listLocalFiles(url))
        return
      }

      if (url.pathname.startsWith("/melodeck/")) {
        const response = await handleMelodeckRequest(request, url, backend.melodeckRepository)
        if (response) {
          await writeNodeResponse(outgoing, response)
          return
        }
      }

      if (url.pathname === "/file-operations" || url.pathname.startsWith("/file-deletions")) {
        const response = await handleFileOperationRequest(request, url, backend.fileOperations)
        if (response) {
          await writeNodeResponse(outgoing, response)
          return
        }
      }

      if (url.pathname === "/logs" && request.method === "POST") {
        const body = await request.json().catch(() => undefined) as { events?: unknown } | undefined
        if (!body || !Array.isArray(body.events) || body.events.length === 0 || body.events.length > 200) {
          await writeNodeResponse(outgoing, Response.json({ error: "events must be an array containing 1 to 200 log envelopes" }, { status: 400 }))
          return
        }
        const parsed = LogEnvelopeSchema.array().safeParse(body.events)
        if (!parsed.success) {
          await writeNodeResponse(outgoing, Response.json({ error: "invalid log envelope", details: parsed.error.issues }, { status: 400 }))
          return
        }
        try {
          await logWriter.append(parsed.data)
        } catch (error) {
          await writeNodeResponse(outgoing, Response.json({
            error: "log append failed",
            context: {
              operation: "logWriter.append",
              request: { method: request.method, path: url.pathname },
              target: logTarget,
              eventCount: parsed.data.length,
            },
            detail: serializeBackendError(error),
          }, { status: 500 }))
          return
        }
        await writeNodeResponse(outgoing, new Response(null, { status: 204 }))
        return
      }

      if (url.pathname === "/local-files/pick" && request.method === "POST") {
        const body = await request.json().catch(() => ({})) as { kind?: string }
        if (body.kind !== "files" && body.kind !== "directory") {
          await writeNodeResponse(outgoing, Response.json({ error: "kind must be files or directory" }, { status: 400 }))
          return
        }
        await writeNodeResponse(outgoing, Response.json({ paths: await pickLocalPaths(body.kind) }))
        return
      }

      if (url.pathname === "/local-files/stage" && request.method === "POST") {
        stagingDirectory ??= mkdtemp(path.join(tmpdir(), "xiranite-local-files-"))
        await writeNodeResponse(outgoing, await stageLocalFile(request, await stagingDirectory))
        return
      }

      if (url.pathname === "/local-files/clipboard" && request.method === "POST") {
        const body = await request.json().catch(() => ({})) as { paths?: unknown }
        if (!Array.isArray(body.paths) || body.paths.length === 0 || body.paths.some((item) => typeof item !== "string" || !item.trim())) {
          await writeNodeResponse(outgoing, Response.json({ error: "paths must be a non-empty string array" }, { status: 400 }))
          return
        }
        const paths = body.paths as string[]
        await (options.writeClipboardFiles ?? writeFilesToClipboard)(paths)
        await writeNodeResponse(outgoing, Response.json({ copied: paths.length }))
        return
      }

      if (url.pathname === "/local-files/clipboard" && request.method === "GET") {
        try {
          const paths = await (options.readClipboardFiles ?? (() => readFilesFromClipboard()))()
          await writeNodeResponse(outgoing, Response.json({ available: true, paths }))
        } catch (error) {
          if (error instanceof NativeFileClipboardUnavailableError) {
            await writeNodeResponse(outgoing, Response.json({ available: false, paths: [] }))
            return
          }
          throw error
        }
        return
      }

      if (url.pathname === "/local-files/clipboard" && request.method === "DELETE") {
        try {
          await (options.clearClipboardFiles ?? (() => clearFileClipboard()))()
          await writeNodeResponse(outgoing, Response.json({ available: true, cleared: true }))
        } catch (error) {
          if (error instanceof NativeFileClipboardUnavailableError) {
            await writeNodeResponse(outgoing, Response.json({ available: false, cleared: false }))
            return
          }
          throw error
        }
        return
      }

      if (url.pathname === "/local-files") {
        await writeNodeResponse(outgoing, await serveLocalFile(request, url))
        return
      }

      if (url.pathname.startsWith("/reader/")) {
        readerController ??= createReaderController(options.publicBaseUrl ?? backendUrl, token, backend.resources, backend.fileOperations, {
          configPath: options.configPath,
          databasePath: options.databasePath ?? backend.database?.path,
          dataDir: options.dataDir,
          legacyThumbnailDatabasePath: options.legacyThumbnailDatabasePath,
          legacyEmmDatabasePaths: options.legacyEmmDatabasePaths,
        }).catch((error) => {
          readerController = undefined
          throw error
        })
        const response = await (await readerController).handle(request)
        if (response) {
          await writeNodeResponse(outgoing, response)
          return
        }
      }

      await writeNodeResponse(outgoing, await backend.app.handle(request))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!requestController.signal.aborted && !outgoing.destroyed) {
        await writeNodeResponse(outgoing, new Response(message, { status: errorStatus(error) }))
      }
    } finally {
      incoming.removeListener("aborted", abortIncoming)
      outgoing.removeListener("close", abortOutgoing)
    }
  })
  await new Promise<void>((resolveListen) => server.listen(options.port ?? 0, hostname, resolveListen))
  const address = server.address() as AddressInfo
  backendUrl = `http://${hostname}:${address.port}`
  let closePromise: Promise<void> | undefined

  return {
    server,
    hostname,
    port: address.port,
    url: backendUrl,
    token,
    database: backend.database,
    close(): Promise<void> {
      closePromise ??= (async () => {
        const serverClosed = new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => error ? rejectClose(error) : resolveClose())
          server.closeIdleConnections?.()
          server.closeAllConnections?.()
        })
        const readerClosed = readerController
          ?.then((controller) => controller[Symbol.asyncDispose]())
          .catch(() => undefined) ?? Promise.resolve()
        backend.close()
        const stagingRemoved = stagingDirectory
          ?.then((directory) => rm(directory, { force: true, recursive: true }))
          .catch(() => undefined) ?? Promise.resolve()
        await Promise.all([serverClosed, readerClosed, logWriter.close(), stagingRemoved])
      })()
      return closePromise
    },
  }
}

async function stageLocalFile(request: Request, directory: string): Promise<Response> {
  if (!request.body) return new Response("Missing file content.", { status: 400 })
  const encodedName = request.headers.get("x-xiranite-filename")
  if (!encodedName) return new Response("Missing x-xiranite-filename header.", { status: 400 })
  let decodedName: string
  try {
    decodedName = decodeURIComponent(encodedName)
  } catch {
    return new Response("Invalid x-xiranite-filename header.", { status: 400 })
  }
  const fileName = path.basename(decodedName.replaceAll("\0", "")).trim()
  if (!fileName || fileName === "." || fileName === "..") return new Response("Invalid file name.", { status: 400 })
  const targetDirectory = path.join(directory, randomBytes(8).toString("hex"))
  await mkdir(targetDirectory)
  const targetPath = path.join(targetDirectory, fileName)
  await pipeline(Readable.fromWeb(request.body as never), createWriteStream(targetPath, { flags: "wx" }))
  return Response.json({ path: targetPath })
}

function createBackendLogWriter(options: LogWriterOptions): BackendLogWriter {
  let writer: RotatingJsonlLogWriter | undefined
  return {
    append(events) {
      writer ??= new RotatingJsonlLogWriter(options)
      return writer.append(events)
    },
    async close() {
      await writer?.close()
    },
  }
}

interface BackendRequestController extends AsyncDisposable {
  handle(request: Request): Promise<Response | undefined>
}

async function createReaderController(
  baseUrl: string,
  token: string,
  resourceScheduler: ResourceScheduler,
  fileOperations: BackendFileOperationManager,
  config: Pick<StartBackendOptions, "configPath" | "databasePath" | "dataDir" | "legacyThumbnailDatabasePath" | "legacyEmmDatabasePaths">,
): Promise<BackendRequestController> {
  const platform = await loadNodePlatformModule("neoview")
  const factory = platform.createReaderHttpController
  if (typeof factory !== "function") throw new Error("NeoView platform is missing createReaderHttpController().")
  return await (factory as (options: {
    baseUrl: string
    token: string
    resourceScheduler: ResourceScheduler
    configPath?: string
    databasePath?: string
    dataDir?: string
    legacyThumbnailDatabasePath?: string | false
    legacyEmmDatabasePaths?: readonly string[] | false
    useDefaultLegacyProgressStore?: boolean
    fileOperationService?: unknown
  }) => Promise<BackendRequestController>)({
    baseUrl,
    token,
    resourceScheduler,
    fileOperationService: fileOperations.scoped({ nodeId: "neoview" }).asService(),
    useDefaultLegacyProgressStore: true,
    ...config,
  })
}

async function serveLocalFile(request: Request, url: URL): Promise<Response> {
  const requestedPath = url.searchParams.get("path")
  if (!requestedPath) return new Response("Missing local file path.", { status: 400 })

  const resolved = path.resolve(requestedPath)
  const info = await stat(resolved).catch(() => null)
  if (!info?.isFile()) return new Response("Local file was not found.", { status: 404 })

  const size = toSafeNumber(info.size)
  const mtimeMs = toSafeNumber(info.mtimeMs)
  const etag = `"${size}-${Math.trunc(mtimeMs)}"`
  const headers = new Headers({
    "content-type": mimeTypeForPath(resolved),
    "cache-control": "private, max-age=60",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "content-length": String(size),
    "etag": etag,
  })

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers })
  }

  if (request.method === "HEAD") {
    return new Response(null, { headers })
  }

  const range = parseRangeHeader(request.headers.get("range"), size)
  if (range === "invalid") {
    headers.set("content-range", `bytes */${size}`)
    headers.delete("content-length")
    return new Response("Requested range is not satisfiable.", { status: 416, headers })
  }
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`)
    headers.set("content-length", String(range.end - range.start + 1))
    return new Response(Readable.toWeb(createReadStream(resolved, range)) as unknown as BodyInit, {
      status: 206,
      headers,
    })
  }

  return new Response(Readable.toWeb(createReadStream(resolved)) as unknown as BodyInit, { headers })
}

interface LocalFileEntry {
  name: string
  path: string
  isDirectory: boolean
  sizeBytes: number
  lastModified: number
  type: string
}

async function listLocalFiles(url: URL): Promise<Response> {
  const requestedPath = url.searchParams.get("path")
  if (!requestedPath) return jsonResponse({ error: "Missing local file path." }, 400)

  const resolved = path.resolve(requestedPath)
  const info = await stat(resolved).catch(() => null)
  if (!info) return jsonResponse({ error: "Local path was not found." }, 404)

  const recursive = url.searchParams.get("recursive") === "1" || url.searchParams.get("recursive") === "true"
  const includeDirectories = url.searchParams.get("includeDirectories") === "1" || url.searchParams.get("includeDirectories") === "true"
  const extensionSet = parseExtensionFilter(url.searchParams.get("extensions"))
  const maxEntries = Math.min(Number(url.searchParams.get("limit") ?? 2000) || 2000, 10_000)
  const entries: LocalFileEntry[] = []

  if (info.isFile()) {
    if (matchesExtensionFilter(resolved, extensionSet)) {
      entries.push(toLocalFileEntry(resolved, info))
    }
  } else if (info.isDirectory()) {
    await collectLocalFiles(resolved, { recursive, includeDirectories, extensionSet, entries, maxEntries })
  } else {
    return jsonResponse({ error: "Local path is not a file or directory." }, 400)
  }

  return jsonResponse({
    root: resolved,
    truncated: entries.length >= maxEntries,
    entries,
  })
}

async function collectLocalFiles(
  dirPath: string,
  options: {
    recursive: boolean
    includeDirectories: boolean
    extensionSet: Set<string> | undefined
    entries: LocalFileEntry[]
    maxEntries: number
  },
): Promise<void> {
  if (options.entries.length >= options.maxEntries) return

  const dirEntries = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
  for (const entry of dirEntries) {
    if (options.entries.length >= options.maxEntries) return

    const entryPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (options.includeDirectories) {
        const info = await stat(entryPath).catch(() => null)
        if (info?.isDirectory()) options.entries.push(toLocalDirectoryEntry(entryPath, info))
      }
      if (options.recursive) {
        await collectLocalFiles(entryPath, options)
      }
      continue
    }
    if (!entry.isFile() || !matchesExtensionFilter(entryPath, options.extensionSet)) continue

    const info = await stat(entryPath).catch(() => null)
    if (info?.isFile()) {
      options.entries.push(toLocalFileEntry(entryPath, info))
    }
  }
}

function toLocalFileEntry(filePath: string, info: Awaited<ReturnType<typeof stat>>): LocalFileEntry {
  return {
    name: path.basename(filePath),
    path: filePath,
    isDirectory: false,
    sizeBytes: toSafeNumber(info.size),
    lastModified: toSafeNumber(info.mtimeMs),
    type: mimeTypeForPath(filePath),
  }
}

function toSafeNumber(value: number | bigint): number {
  const numberValue = typeof value === "bigint" ? Number(value) : value
  if (!Number.isFinite(numberValue)) return 0
  return Math.min(numberValue, Number.MAX_SAFE_INTEGER)
}

function parseRangeHeader(rangeHeader: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!rangeHeader) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return "invalid"

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return "invalid"

  let start: number
  let end: number
  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return "invalid"
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return "invalid"
  }
  return { start, end: Math.min(end, size - 1) }
}

function parseExtensionFilter(value: string | null): Set<string> | undefined {
  const extensions = value?.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.startsWith(".") ? item : `.${item}`)
  return extensions?.length ? new Set(extensions) : undefined
}

function matchesExtensionFilter(filePath: string, extensionSet: Set<string> | undefined): boolean {
  return !extensionSet || extensionSet.has(path.extname(filePath).toLowerCase())
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

function mimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".png") return "image/png"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  if (ext === ".bmp") return "image/bmp"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".avif") return "image/avif"
  if (ext === ".jxl") return "image/jxl"
  if (ext === ".flac") return "audio/flac"
  if (ext === ".mp3") return "audio/mpeg"
  if (ext === ".wav") return "audio/wav"
  if (ext === ".ogg" || ext === ".oga") return "audio/ogg"
  if (ext === ".m4a") return "audio/mp4"
  if (ext === ".aac") return "audio/aac"
  if (ext === ".opus") return "audio/opus"
  if (ext === ".webm") return "audio/webm"
  return "application/octet-stream"
}

async function createDefaultRepository(config: BackendDatabaseConfig): Promise<WorkspaceRepository> {
  if (config.path) {
    await mkdir(path.dirname(config.path), { recursive: true })
  }

  return createLibsqlWorkspaceRepository({
    url: config.url,
    authToken: config.authToken,
  })
}

function serializeBackendError(error: unknown, seen = new Set<unknown>()): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: "Error", message: String(error) }
  if (seen.has(error)) return { name: error.name || "Error", message: "Circular error cause" }
  seen.add(error)
  const diagnosticFields = [
    "code",
    "errno",
    "syscall",
    "path",
    "dest",
    "operation",
    "logFile",
    "eventCount",
  ] as const
  const diagnostics: Record<string, string | number | boolean> = {}
  for (const field of diagnosticFields) {
    const value = Reflect.get(error, field)
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") diagnostics[field] = value
  }
  return {
    name: error.name || "Error",
    message: error.message,
    ...diagnostics,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(error.cause === undefined ? {} : { cause: serializeBackendError(error.cause, seen) }),
  }
}

function errorStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    return Math.max(400, Math.min(599, Math.trunc(error.status)))
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "ENOENT") return 404
    if (error.code === "ENOTSUP") return 409
  }
  return 500
}

async function createDefaultMelodeckRepository(config: BackendDatabaseConfig): Promise<MelodeckRepository> {
  if (config.path) await mkdir(path.dirname(config.path), { recursive: true })
  return createLibsqlMelodeckRepository({ url: config.url, authToken: config.authToken })
}

async function ensureDefaultWorkspace(repository: WorkspaceRepository, now: number): Promise<void> {
  const workspaces = await repository.listWorkspaces()
  if (workspaces.length > 0) return

  await repository.createWorkspace({
    id: "ws-default",
    label: "Default",
    createdAt: now,
    updatedAt: now,
  })
}

function closeRepository(repository: WorkspaceRepository): void {
  const maybeLibsql = repository as Partial<LibsqlWorkspaceRepository>
  maybeLibsql.client?.close()
}

function closeMelodeckRepository(repository: MelodeckRepository): void {
  const maybeLibsql = repository as Partial<LibsqlMelodeckRepository>
  maybeLibsql.client?.close()
}

function randomToken(): string {
  return randomBytes(32).toString("base64url")
}

function toLocalDirectoryEntry(filePath: string, info: Awaited<ReturnType<typeof stat>>): LocalFileEntry {
  return {
    name: path.basename(filePath),
    path: filePath,
    isDirectory: true,
    sizeBytes: 0,
    lastModified: toSafeNumber(info.mtimeMs),
    type: "inode/directory",
  }
}

function toFetchRequest(incoming: IncomingMessage, signal?: AbortSignal): Request {
  const host = incoming.headers.host ?? "127.0.0.1"
  const url = new URL(incoming.url ?? "/", `http://${host}`)
  const headers = new Headers()
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }

  const method = incoming.method ?? "GET"
  const init: RequestInit & { duplex?: "half" } = { method, headers, signal }
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(incoming) as unknown as BodyInit
    init.duplex = "half"
  }
  return new Request(url, init)
}

async function writeNodeResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status
  writeCorsHeaders(outgoing)
  response.headers.forEach((value, key) => outgoing.setHeader(key, value))
  if (!response.body) {
    outgoing.end()
    return
  }

  const reader = response.body.getReader()
  let completed = false
  const cancelOnDisconnect = () => {
    if (!completed) void reader.cancel(new Error("Client disconnected")).catch(() => undefined)
  }
  outgoing.once("close", cancelOnDisconnect)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!outgoing.write(Buffer.from(value))) {
        await waitForDrain(outgoing)
      }
    }
    completed = true
    outgoing.end()
  } catch (error) {
    outgoing.destroy(error instanceof Error ? error : new Error(String(error)))
  } finally {
    outgoing.removeListener("close", cancelOnDisconnect)
    if (!completed) await reader.cancel(new Error("Response terminated")).catch(() => undefined)
    reader.releaseLock()
  }
}

function waitForDrain(outgoing: ServerResponse): Promise<void> {
  return new Promise((resolveDrain, rejectDrain) => {
    const cleanup = () => {
      outgoing.removeListener("drain", onDrain)
      outgoing.removeListener("close", onClose)
      outgoing.removeListener("error", onError)
    }
    const onDrain = () => {
      cleanup()
      resolveDrain()
    }
    const onClose = () => {
      cleanup()
      rejectDrain(new Error("Client disconnected"))
    }
    const onError = (error: Error) => {
      cleanup()
      rejectDrain(error)
    }
    outgoing.once("drain", onDrain)
    outgoing.once("close", onClose)
    outgoing.once("error", onError)
  })
}

function writeCorsHeaders(outgoing: ServerResponse): void {
  outgoing.setHeader("access-control-allow-origin", "*")
  outgoing.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
  outgoing.setHeader("access-control-allow-headers", "content-type,x-xiranite-token,x-xiranite-filename")
  outgoing.setHeader("access-control-max-age", "86400")
}

export function parseBackendCliArgs(argv: string[] = process.argv.slice(2)): BackendCliOptions {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      help: { type: "boolean", short: "h" },
      host: { type: "string" },
      hostname: { type: "string" },
      port: { type: "string" },
      token: { type: "string" },
      "public-base-url": { type: "string" },
      config: { type: "string" },
      "database-url": { type: "string" },
      "database-path": { type: "string" },
      "data-dir": { type: "string" },
      "database-auth-token": { type: "string" },
      "data-contract-version": { type: "string" },
    },
  })

  const port = values.port === undefined ? undefined : Number(values.port)
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
    throw new Error(`Invalid --port value: ${values.port}`)
  }

  return {
    help: values.help,
    hostname: values.hostname ?? values.host,
    port,
    token: values.token,
    publicBaseUrl: values["public-base-url"],
    configPath: values.config,
    databaseUrl: values["database-url"],
    databasePath: values["database-path"],
    dataDir: values["data-dir"],
    databaseAuthToken: values["database-auth-token"],
    dataContractVersion: parseNodeAppDataContractVersion(values["data-contract-version"]),
  }
}

const backendCliHelp = `Usage: xiranite-backend [options]

Options:
  --host, --hostname <host>              Bind host. Default: 127.0.0.1
  --port <port>                          Bind port. Default: random free port
  --token <token>                        Local service auth token
  --public-base-url <url>                Stable browser-visible gateway origin
  --config <path>                        xiranite.config.toml path override
  --database-url <url>                   libSQL URL. Supports file: and remote libSQL URLs
  --database-path <path>                 Local database file path
  --data-dir <path>                      App data directory. Uses xiranite.db inside it
  --database-auth-token <token>          Remote libSQL auth token
  --data-contract-version <version>      Record an initialized shared data contract
  -h, --help                             Show help

Environment overrides:
  XIRANITE_DATABASE_URL, XIRANITE_DATABASE_PATH, XIRANITE_DATA_DIR,
  XIRANITE_DATABASE_AUTH_TOKEN
`

if (import.meta.main) {
  try {
    const options = parseBackendCliArgs()
    if (options.help) {
      process.stdout.write(backendCliHelp)
      process.exit(0)
    }

    const backend = await startBackend(options)
    process.stdout.write(`${JSON.stringify({
      baseUrl: backend.url,
      url: backend.url,
      token: backend.token,
      database: backend.database,
    })}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
