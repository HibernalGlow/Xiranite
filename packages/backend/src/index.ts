import { createXiraniteApp } from "@xiranite/api"
import type { WorkspaceRepository } from "@xiranite/repository"
import { createLibsqlWorkspaceRepository, type LibsqlWorkspaceRepository } from "@xiranite/repository/libsql"
import { createXiraniteServices, type NodeRunner } from "@xiranite/services"
import { createReadStream } from "node:fs"
import { mkdir, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { homedir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { createBackendNodeRunner } from "./nodeRunner.js"

export interface CreateDefaultBackendOptions {
  now?: number
  repository?: WorkspaceRepository
  databaseUrl?: string
  databasePath?: string
  databaseAuthToken?: string
  dataDir?: string
  nodeRunner?: NodeRunner
}

export interface StartBackendOptions extends CreateDefaultBackendOptions {
  hostname?: string
  port?: number
  token?: string
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
  database?: BackendDatabaseConfig
  close(): void
}

export async function createDefaultBackendApp(options: CreateDefaultBackendOptions = {}) {
  const backend = await createDefaultBackend(options)
  return backend.app
}

export async function createDefaultBackend(options: CreateDefaultBackendOptions = {}): Promise<XiraniteBackendApp> {
  const repository = options.repository ?? await createDefaultRepository(options)
  await ensureDefaultWorkspace(repository, options.now ?? Date.now())

  const services = createXiraniteServices(repository, {
    nodeRunner: options.nodeRunner ?? createBackendNodeRunner(),
  })
  await services.config.ensureConfigFile()

  return {
    app: createXiraniteApp(services),
    repository,
    database: options.repository ? undefined : resolveBackendDatabaseConfig(options),
    close() {
      closeRepository(repository)
    },
  }
}

export async function startBackend(options: StartBackendOptions = {}) {
  const backend = await createDefaultBackend(options)
  const hostname = options.hostname ?? "127.0.0.1"
  const token = options.token ?? randomToken()
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = toFetchRequest(incoming)
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

      if (url.pathname === "/local-files") {
        await writeNodeResponse(outgoing, await serveLocalFile(url))
        return
      }

      await writeNodeResponse(outgoing, await backend.app.handle(request))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await writeNodeResponse(outgoing, new Response(message, { status: 500 }))
    }
  })
  await new Promise<void>((resolveListen) => server.listen(options.port ?? 0, hostname, resolveListen))
  const address = server.address() as AddressInfo

  return {
    server,
    hostname,
    port: address.port,
    url: `http://${hostname}:${address.port}`,
    token,
    database: backend.database,
    close() {
      server.close()
      backend.close()
    },
  }
}

async function serveLocalFile(url: URL): Promise<Response> {
  const requestedPath = url.searchParams.get("path")
  if (!requestedPath) return new Response("Missing local file path.", { status: 400 })

  const resolved = path.resolve(requestedPath)
  const info = await stat(resolved).catch(() => null)
  if (!info?.isFile()) return new Response("Local file was not found.", { status: 404 })

  const headers = new Headers({
    "content-type": mimeTypeForPath(resolved),
    "cache-control": "private, max-age=60",
    "x-content-type-options": "nosniff",
  })
  return new Response(Readable.toWeb(createReadStream(resolved)) as unknown as BodyInit, { headers })
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

function filePathFromDatabaseUrl(url: string): string | undefined {
  if (!url.startsWith("file:")) return undefined
  return fileURLToPath(url)
}

function randomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function toFetchRequest(incoming: IncomingMessage): Request {
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
  const init: RequestInit & { duplex?: "half" } = { method, headers }
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
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!outgoing.write(Buffer.from(value))) {
        await new Promise<void>((resolveDrain) => outgoing.once("drain", resolveDrain))
      }
    }
    outgoing.end()
  } catch (error) {
    outgoing.destroy(error instanceof Error ? error : new Error(String(error)))
  } finally {
    reader.releaseLock()
  }
}

function writeCorsHeaders(outgoing: ServerResponse): void {
  outgoing.setHeader("access-control-allow-origin", "*")
  outgoing.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS")
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
