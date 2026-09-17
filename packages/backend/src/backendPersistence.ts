import {
  createMemoryFileDeletionRepository,
  type FileDeletionRepository,
  type NodeRunHistoryRepository,
} from "@xiranite/repository"
import {
  createLibsqlFileDeletionRepository,
  createLibsqlNodeRunHistoryRepository,
  type LibsqlFileDeletionRepository,
  type LibsqlNodeRunHistoryRepository,
} from "@xiranite/repository/libsql"
import { resolveAppDataDir } from "@xiranite/platform"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export interface BackendDatabaseOptions {
  databaseUrl?: string
  databasePath?: string
  databaseAuthToken?: string
  dataDir?: string
}

export interface BackendDatabaseConfig {
  url: string
  path?: string
  authToken?: string
}

export interface BackendOperationalPersistenceOptions extends BackendDatabaseOptions {
  /** Explicit false is reserved for injected or in-memory test compositions. */
  database?: BackendDatabaseConfig | false
  historyRepository?: NodeRunHistoryRepository
  fileDeletionRepository?: FileDeletionRepository
}

export interface BackendOperationalPersistence {
  database?: BackendDatabaseConfig
  persistent: boolean
  historyRepository?: NodeRunHistoryRepository
  fileDeletionRepository: FileDeletionRepository
  close(): void
}

/**
 * Creates the shared operational stores used by every production backend host.
 * Workspace state stays host-specific; run history and file-operation history do not.
 */
export async function createBackendOperationalPersistence(
  options: BackendOperationalPersistenceOptions = {},
): Promise<BackendOperationalPersistence> {
  const database = options.database === false
    ? undefined
    : options.database ?? resolveBackendDatabaseConfig(options)
  if (database?.path) await mkdir(path.dirname(database.path), { recursive: true })

  let historyRepository = options.historyRepository
  let fileDeletionRepository = options.fileDeletionRepository
  let ownsHistoryRepository = false
  const created: Array<NodeRunHistoryRepository | FileDeletionRepository> = []
  try {
    if (!historyRepository && database) {
      historyRepository = await createLibsqlNodeRunHistoryRepository(database)
      ownsHistoryRepository = true
      created.push(historyRepository)
    }
    if (!fileDeletionRepository) {
      const historyClient = ownsHistoryRepository
        ? historyRepository as Partial<LibsqlNodeRunHistoryRepository> | undefined
        : undefined
      fileDeletionRepository = database
        ? await createLibsqlFileDeletionRepository({ ...database, client: historyClient?.client })
        : createMemoryFileDeletionRepository()
      created.push(fileDeletionRepository)
    }
  } catch (error) {
    closeRepositoryClients(created)
    throw error
  }

  let closed = false
  return {
    database,
    persistent: Boolean(database),
    historyRepository,
    fileDeletionRepository,
    close() {
      if (closed) return
      closed = true
      closeRepositoryClients([historyRepository, fileDeletionRepository])
    },
  }
}

export function resolveBackendDatabaseConfig(options: BackendDatabaseOptions = {}): BackendDatabaseConfig {
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

export function resolveBackendDataDir(options: Pick<BackendDatabaseOptions, "dataDir"> = {}): string {
  if (options.dataDir) return path.resolve(options.dataDir)
  if (process.env.XIRANITE_DATA_DIR) return path.resolve(process.env.XIRANITE_DATA_DIR)
  return resolveAppDataDir()
}

function closeRepositoryClients(
  repositories: readonly (NodeRunHistoryRepository | FileDeletionRepository | undefined)[],
): void {
  const clients = new Set<LibsqlNodeRunHistoryRepository["client"] | LibsqlFileDeletionRepository["client"]>()
  for (const repository of repositories) {
    const client = (repository as Partial<LibsqlNodeRunHistoryRepository | LibsqlFileDeletionRepository> | undefined)?.client
    if (client) clients.add(client)
  }
  for (const client of clients) client.close()
}

function filePathFromDatabaseUrl(url: string): string | undefined {
  if (!url.startsWith("file:")) return undefined
  return fileURLToPath(url)
}
