import { createXiraniteApp } from "@xiranite/api"
import type { WorkspaceRepository } from "@xiranite/repository"
import { createLibsqlWorkspaceRepository, type LibsqlWorkspaceRepository } from "@xiranite/repository/libsql"
import { createXiraniteServices, type NodeRunner } from "@xiranite/services"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
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

  return {
    app: createXiraniteApp(createXiraniteServices(repository, {
      nodeRunner: options.nodeRunner ?? createBackendNodeRunner(),
    })),
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
  const server = Bun.serve({
    hostname,
    port: options.port ?? 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (url.pathname !== "/health" && request.headers.get("x-xiranite-token") !== token) {
        return new Response("Unauthorized", { status: 401 })
      }

      return backend.app.handle(request)
    },
  })

  return {
    server,
    hostname,
    port: server.port,
    url: `http://${hostname}:${server.port}`,
    token,
    database: backend.database,
    close() {
      server.stop(true)
      backend.close()
    },
  }
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
  const databaseUrl = options.databaseUrl ?? Bun.env.XIRANITE_DATABASE_URL
  if (databaseUrl) {
    return {
      url: databaseUrl,
      path: filePathFromDatabaseUrl(databaseUrl),
      authToken: options.databaseAuthToken ?? Bun.env.XIRANITE_DATABASE_AUTH_TOKEN,
    }
  }

  const explicitDatabasePath = options.databasePath ?? Bun.env.XIRANITE_DATABASE_PATH
  const databasePath = explicitDatabasePath
    ? path.resolve(explicitDatabasePath)
    : path.join(resolveBackendDataDir(options), "xiranite.db")
  return {
    url: pathToFileURL(databasePath).href,
    path: databasePath,
    authToken: options.databaseAuthToken ?? Bun.env.XIRANITE_DATABASE_AUTH_TOKEN,
  }
}

export function resolveBackendDataDir(options: Pick<CreateDefaultBackendOptions, "dataDir"> = {}): string {
  if (options.dataDir) return path.resolve(options.dataDir)
  if (Bun.env.XIRANITE_DATA_DIR) return path.resolve(Bun.env.XIRANITE_DATA_DIR)

  const home = homedir()
  if (process.platform === "win32") {
    const base = Bun.env.LOCALAPPDATA ?? Bun.env.APPDATA ?? path.join(home, "AppData", "Local")
    return path.join(base, "Xiranite")
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Xiranite")
  }

  const base = Bun.env.XDG_DATA_HOME ?? path.join(home, ".local", "share")
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
