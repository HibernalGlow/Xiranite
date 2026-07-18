import { createXiraniteApp } from "@xiranite/api"
import type { NodeRunHistoryRepository, WorkspaceRepository } from "@xiranite/repository"
import {
  createLibsqlNodeRunHistoryRepository,
  createLibsqlWorkspaceRepository,
  type LibsqlNodeRunHistoryRepository,
  type LibsqlWorkspaceRepository,
} from "@xiranite/repository/libsql"
import {
  createXiraniteServices,
  type NodeRunner,
  type ResourceScheduler,
  type ResourceSchedulerService,
  type XiraniteSystemService,
} from "@xiranite/services"
import { randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { homedir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { createBackendNodeRunner } from "./nodeRunner.js"
import { pickLocalPaths } from "./localFilePicker.js"
import { writeFilesToClipboard } from "./fileClipboard.js"
import { getDevelopmentSourceHotReloadEnabled, loadNodePlatformModule, setDevelopmentSourceHotReloadEnabled } from "@xiranite/runtime/node-runner"

export interface CreateDefaultBackendOptions {
  now?: number
  repository?: WorkspaceRepository
  historyRepository?: NodeRunHistoryRepository
  configPath?: string
  databaseUrl?: string
  databasePath?: string
  databaseAuthToken?: string
  dataDir?: string
  legacyThumbnailDatabasePath?: string | false
  nodeRunner?: NodeRunner
  resourceScheduler?: ResourceSchedulerService
  system?: XiraniteSystemService
}

export interface StartBackendOptions extends CreateDefaultBackendOptions {
  hostname?: string
  port?: number
  token?: string
  writeClipboardFiles?: (paths: string[]) => Promise<void>
}

export interface BackendCliOptions extends StartBackendOptions {
  help?: boolean
}

export interface BackendDatabaseConfig {
  url: string
  path?: string
  authToken?: string
}

export interface XiraniteBackendApp {
  app: ReturnType<typeof createXiraniteApp>
  repository: WorkspaceRepository
  historyRepository?: NodeRunHistoryRepository
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
  const repository = options.repository ?? await createDefaultRepository(options)
  const historyRepository = options.historyRepository ?? (options.repository ? undefined : await createDefaultHistoryRepository(options))
  await ensureDefaultWorkspace(repository, options.now ?? Date.now())

  const services = createXiraniteServices(repository, {
    nodeRunner: options.nodeRunner ?? createBackendNodeRunner(),
    configPath: options.configPath,
    databasePath: database?.path,
    dataDir: options.dataDir,
    historyRepository,
    resourceScheduler: options.resourceScheduler,
    system: {
      ...options.system,
      getNodeSourceHotReload: getDevelopmentSourceHotReloadEnabled,
      setNodeSourceHotReload: setDevelopmentSourceHotReloadEnabled,
    },
  })
  await services.config.ensureConfigFile()

  return {
    app: createXiraniteApp(services),
    repository,
    historyRepository,
    database,
    resources: services.resources,
    close() {
      closeRepository(repository)
      closeHistoryRepository(historyRepository)
      if (ownsResourceScheduler) services.resources.close()
    },
  }
}

export async function startBackend(options: StartBackendOptions = {}) {
  const backend = await createDefaultBackend(options)
  const hostname = options.hostname ?? "127.0.0.1"
  const token = options.token ?? randomToken()
  let backendUrl = ""
  let readerController: Promise<BackendRequestController> | undefined
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

      const authorized = request.headers.get("x-xiranite-token") === token || url.searchParams.get("token") === token
      if (url.pathname !== "/health" && !authorized) {
        await writeNodeResponse(outgoing, new Response("Unauthorized", { status: 401 }))
        return
      }

      if (url.pathname === "/local-files/list") {
        await writeNodeResponse(outgoing, await listLocalFiles(url))
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

      if (url.pathname === "/local-files") {
        await writeNodeResponse(outgoing, await serveLocalFile(request, url))
        return
      }

      if (url.pathname.startsWith("/reader/")) {
        readerController ??= createReaderController(backendUrl, token, backend.resources, {
          configPath: options.configPath,
          databasePath: options.databasePath ?? backend.database?.path,
          dataDir: options.dataDir,
          legacyThumbnailDatabasePath: options.legacyThumbnailDatabasePath,
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
        await writeNodeResponse(outgoing, new Response(message, { status: 500 }))
      }
    } finally {
      incoming.removeListener("aborted", abortIncoming)
      outgoing.removeListener("close", abortOutgoing)
    }
  })
  await new Promise<void>((resolveListen) => server.listen(options.port ?? 0, hostname, resolveListen))
  const address = server.address() as AddressInfo
  backendUrl = `http://${hostname}:${address.port}`

  return {
    server,
    hostname,
    port: address.port,
    url: backendUrl,
    token,
    database: backend.database,
    close(): Promise<void> {
      const serverClosed = new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      const readerClosed = readerController
        ?.then((controller) => controller[Symbol.asyncDispose]())
        .catch(() => undefined) ?? Promise.resolve()
      backend.close()
      return Promise.all([serverClosed, readerClosed]).then(() => undefined)
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
  config: Pick<StartBackendOptions, "configPath" | "databasePath" | "dataDir" | "legacyThumbnailDatabasePath">,
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
    useDefaultLegacyProgressStore?: boolean
  }) => Promise<BackendRequestController>)({
    baseUrl,
    token,
    resourceScheduler,
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
  const extensionSet = parseExtensionFilter(url.searchParams.get("extensions"))
  const maxEntries = Math.min(Number(url.searchParams.get("limit") ?? 2000) || 2000, 10_000)
  const entries: LocalFileEntry[] = []

  if (info.isFile()) {
    if (matchesExtensionFilter(resolved, extensionSet)) {
      entries.push(toLocalFileEntry(resolved, info))
    }
  } else if (info.isDirectory()) {
    await collectLocalFiles(resolved, { recursive, extensionSet, entries, maxEntries })
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

async function createDefaultRepository(options: CreateDefaultBackendOptions): Promise<WorkspaceRepository> {
  const config = resolveBackendDatabaseConfig(options)
  if (config.path) {
    await mkdir(path.dirname(config.path), { recursive: true })
  }

  return createLibsqlWorkspaceRepository({
    url: config.url,
    authToken: config.authToken,
  })
}

async function createDefaultHistoryRepository(options: CreateDefaultBackendOptions): Promise<NodeRunHistoryRepository> {
  const config = resolveBackendDatabaseConfig(options)
  if (config.path) {
    await mkdir(path.dirname(config.path), { recursive: true })
  }

  return createLibsqlNodeRunHistoryRepository({
    url: config.url,
    authToken: config.authToken,
  })
}

export function resolveBackendDatabaseConfig(options: CreateDefaultBackendOptions = {}): BackendDatabaseConfig {
  const databaseUrl = options.databaseUrl ?? process.env.XIRANITE_DATABASE_URL
  if (databaseUrl) {
    return {
      url: databaseUrl,
      path: filePathFromDatabaseUrl(databaseUrl),
      authToken: options.databaseAuthToken ?? process.env.XIRANITE_DATABASE_AUTH_TOKEN,
    }
  }

  const explicitDatabasePath = options.databasePath ?? process.env.XIRANITE_DATABASE_PATH
  const databasePath = explicitDatabasePath
    ? path.resolve(explicitDatabasePath)
    : path.join(resolveBackendDataDir(options), "xiranite.db")
  return {
    url: pathToFileURL(databasePath).href,
    path: databasePath,
    authToken: options.databaseAuthToken ?? process.env.XIRANITE_DATABASE_AUTH_TOKEN,
  }
}

export function resolveBackendDataDir(options: Pick<CreateDefaultBackendOptions, "dataDir"> = {}): string {
  if (options.dataDir) return path.resolve(options.dataDir)
  if (process.env.XIRANITE_DATA_DIR) return path.resolve(process.env.XIRANITE_DATA_DIR)

  const home = homedir()
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? path.join(home, "AppData", "Local")
    return path.join(base, "Xiranite")
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Xiranite")
  }

  const base = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share")
  return path.join(base, "xiranite")
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

function closeHistoryRepository(repository: NodeRunHistoryRepository | undefined): void {
  if (!repository) return
  const maybeLibsql = repository as Partial<LibsqlNodeRunHistoryRepository>
  maybeLibsql.client?.close()
}

function filePathFromDatabaseUrl(url: string): string | undefined {
  if (!url.startsWith("file:")) return undefined
  return fileURLToPath(url)
}

function randomToken(): string {
  return randomBytes(32).toString("base64url")
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
  outgoing.setHeader("access-control-allow-headers", "content-type,x-xiranite-token")
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
      config: { type: "string" },
      "database-url": { type: "string" },
      "database-path": { type: "string" },
      "data-dir": { type: "string" },
      "database-auth-token": { type: "string" },
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
    configPath: values.config,
    databaseUrl: values["database-url"],
    databasePath: values["database-path"],
    dataDir: values["data-dir"],
    databaseAuthToken: values["database-auth-token"],
  }
}

const backendCliHelp = `Usage: xiranite-backend [options]

Options:
  --host, --hostname <host>              Bind host. Default: 127.0.0.1
  --port <port>                          Bind port. Default: random free port
  --token <token>                        Local service auth token
  --config <path>                        xiranite.config.toml path override
  --database-url <url>                   libSQL URL. Supports file: and remote libSQL URLs
  --database-path <path>                 Local database file path
  --data-dir <path>                      App data directory. Uses xiranite.db inside it
  --database-auth-token <token>          Remote libSQL auth token
  -h, --help                             Show help

Environment overrides:
  XIRANITE_DATABASE_URL, XIRANITE_DATABASE_PATH, XIRANITE_DATA_DIR,
  XIRANITE_DATABASE_AUTH_TOKEN
`

if (import.meta.main) {
  try {
    const options = parseBackendCliArgs()
    if (options.help) {
      console.log(backendCliHelp)
      process.exit(0)
    }

    const backend = await startBackend(options)
    console.log(JSON.stringify({
      baseUrl: backend.url,
      url: backend.url,
      token: backend.token,
      database: backend.database,
    }))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
