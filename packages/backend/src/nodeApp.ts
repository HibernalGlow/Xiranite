import { createNodeAppApi } from "@xiranite/api"
import { createLogEnvelope, createLogSession, LogEnvelopeSchema } from "@xiranite/logging"
import { RotatingJsonlLogWriter } from "@xiranite/logging/node"
import { createMemoryFileDeletionRepository, createMemoryWorkspaceRepository } from "@xiranite/repository"
import { createLibsqlNodeRunHistoryRepository } from "@xiranite/repository/libsql"
import { createXiraniteServices, type ResourceScheduler } from "@xiranite/services"
import { mkdir, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { createBackendNodeMemoryProtection, createBackendNodeRunner } from "./nodeRunner.js"
import { BackendFileOperationManager } from "./fileOperations.js"
import { pickLocalPaths } from "./localFilePicker.js"
import { NodeAppStateStore, resolveNodeAppDataDirectory } from "./nodeAppState.js"
import { parseNodeAppDataContractVersion, recordNodeAppDataContract, resolveNodeAppDataContractsPath } from "./nodeAppDataContract.js"
import { NodeAppOperationRecoveryStore } from "./nodeAppOperationRecovery.js"
import { getDevelopmentSourceHotReloadEnabled, loadNodePlatformModule, setDevelopmentSourceHotReloadEnabled } from "@xiranite/runtime/node-runner"

export interface StartNodeAppBackendOptions {
  nodeId: string
  token: string
  hostname?: string
  port?: number
  publicBaseUrl?: string
  configPath?: string
  dataDir?: string
  enableReader?: boolean
  snapshotId?: string
  dataContractVersion?: number
}

export async function startNodeAppBackend(options: StartNodeAppBackendOptions) {
  const nodeId = normalizeNodeId(options.nodeId)
  const snapshotId = normalizeSnapshotId(options.snapshotId ?? process.env.XIRANITE_NODE_APP_SNAPSHOT_ID ?? "development")
  const dataDirectory = resolveNodeAppDataDirectory(nodeId)
  const logSession = createLogSession()
  const logWriter = new RotatingJsonlLogWriter({
    directory: path.join(dataDirectory, "logs", snapshotId),
    source: `node-app-${nodeId}-${snapshotId}`,
    sessionId: logSession.id,
  })
  const repository = createMemoryWorkspaceRepository()
  const databasePath = resolveNodeAppDatabasePath(options)
  await mkdir(path.dirname(databasePath), { recursive: true })
  const historyRepository = await createLibsqlNodeRunHistoryRepository({ url: pathToFileURL(databasePath).href })
  const deletionRepository = createMemoryFileDeletionRepository()
  const fileOperations = new BackendFileOperationManager(deletionRepository)
  const services = createXiraniteServices(repository, {
    nodeRunner: createBackendNodeRunner({ fileOperations }),
    configPath: options.configPath,
    databasePath,
    dataDir: options.dataDir,
    historyRepository,
    system: {
      getNodeSourceHotReload: getDevelopmentSourceHotReloadEnabled,
      setNodeSourceHotReload: setDevelopmentSourceHotReloadEnabled,
    },
    nodeMemoryProtection: createBackendNodeMemoryProtection(),
  })
  await services.config.ensureConfigFile()
  const dataContractVersion = options.dataContractVersion
    ?? parseNodeAppDataContractVersion(process.env.XIRANITE_NODE_APP_DATA_CONTRACT_VERSION)
  if (dataContractVersion !== undefined) await recordNodeAppDataContract(dataContractVersion)
  fileOperations.setScheduler(services.resources)
  const activeOperations = new NodeAppOperationRecoveryStore(nodeId)
  await activeOperations.recoverInterrupted(services.history)
  const api = createNodeAppApi(services, nodeId, {
    onOperationStarted: async (operation) => {
      await activeOperations.track(operation)
      void services.nodes.waitForOperation(operation.operationId)
        .finally(async () => await activeOperations.complete(operation.operationId))
    },
  })
  const state = new NodeAppStateStore(nodeId, snapshotId)
  let reader: Promise<BackendRequestController> | undefined

  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/health") return Response.json({ ok: true, nodeId, snapshotId })
      if (!isAuthorized(request, url, options.token)) return new Response("Unauthorized", { status: 401 })
      try {
        if (url.pathname === "/node-app/capabilities" && request.method === "GET") {
          return Response.json({ nodeId, snapshotId, capabilities: ["health", "node-api", "state", "operations", "history"] })
        }
        if (url.pathname === "/node-app/state" && request.method === "GET") {
          return Response.json({ data: await state.get() })
        }
        if (url.pathname === "/node-app/state" && request.method === "PATCH") {
          const body = await request.json().catch(() => undefined) as { patch?: unknown } | undefined
          if (!body || !isRecord(body.patch)) return new Response("State patch must be an object.", { status: 400 })
          return Response.json({ data: await state.patch(body.patch) })
        }
        if (url.pathname === "/node-app/state" && request.method === "PUT") {
          const body = await request.json().catch(() => undefined) as { data?: unknown } | undefined
          if (!body || !isRecord(body.data)) return new Response("State data must be an object.", { status: 400 })
          return Response.json({ data: await state.replace(body.data) })
        }
        if (url.pathname === "/node-app/runtime" && request.method === "GET") {
          return Response.json({
            nodeId,
            snapshotId,
            statePath: state.path,
            logDirectory: path.join(dataDirectory, "logs", snapshotId),
            dataContract: dataContractVersion === undefined
              ? undefined
              : { currentVersion: dataContractVersion, dataPath: resolveNodeAppDataContractsPath() },
          })
        }
        if (url.pathname === "/logs" && request.method === "POST") {
          const body = await request.json().catch(() => undefined) as { events?: unknown } | undefined
          const parsed = LogEnvelopeSchema.array().safeParse(body?.events)
          if (!parsed.success || parsed.data.length === 0 || parsed.data.length > 200) {
            return new Response("Invalid log event batch.", { status: 400 })
          }
          await logWriter.append(parsed.data)
          return new Response(null, { status: 204 })
        }
        if (url.pathname === "/local-files/pick" && request.method === "POST") {
          const body = await request.json().catch(() => ({})) as { kind?: unknown }
          if (body.kind !== "files" && body.kind !== "directory") return new Response("Invalid picker kind.", { status: 400 })
          return Response.json({ paths: await pickLocalPaths(body.kind) })
        }
        if (url.pathname === "/local-files/list") return await listLocalFiles(url)
        if (url.pathname === "/local-files") return await serveLocalFile(url)
        if (options.enableReader && url.pathname.startsWith("/reader/")) {
          reader ??= createReaderController(options.publicBaseUrl ?? url.origin, options.token, services.resources, fileOperations, options)
          const response = await (await reader).handle(request)
          if (response) return response
        }
        return await api.handle(request)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        void logWriter.append([createLogEnvelope({
          severityText: "error",
          eventName: "node_app.backend.request_failed",
          body: message,
          resource: { serviceName: `node-app-${nodeId}`, processType: "backend", processId: process.pid },
          scope: { name: "node-app.backend" },
          session: logSession,
          error: error instanceof Error ? { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) } : undefined,
        })]).catch(() => undefined)
        return new Response(message, { status: 500 })
      }
    },
  })

  return {
    url: `http://${server.hostname}:${server.port}`,
    close: async () => {
      server.stop(true)
      await reader?.then((controller) => controller[Symbol.asyncDispose]()).catch(() => undefined)
      services.resources.close()
      await activeOperations.clear()
      historyRepository.client.close()
      await logWriter.close()
    },
  }
}

function resolveNodeAppDatabasePath(options: Pick<StartNodeAppBackendOptions, "dataDir">): string {
  if (process.env.XIRANITE_DATABASE_PATH) return path.resolve(process.env.XIRANITE_DATABASE_PATH)
  const dataDirectory = options.dataDir ?? process.env.XIRANITE_DATA_DIR
  if (dataDirectory) return path.resolve(dataDirectory, "xiranite.db")
  const base = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? process.cwd(), "AppData", "Local")
  return path.join(base, "Xiranite", "xiranite.db")
}

export async function runNodeAppBackendCli(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "node-id": { type: "string" },
      token: { type: "string" },
      hostname: { type: "string" },
      port: { type: "string" },
      "public-base-url": { type: "string" },
      "config-path": { type: "string" },
      "data-dir": { type: "string" },
      "enable-reader": { type: "boolean" },
      "snapshot-id": { type: "string" },
      "data-contract-version": { type: "string" },
    },
  })
  const nodeId = parsed.values["node-id"] ?? process.env.XIRANITE_NODE_APP_ID
  const token = parsed.values.token
  if (!nodeId || !token) throw new Error("--node-id and --token are required for a node app backend.")
  const backend = await startNodeAppBackend({
    nodeId,
    token,
    hostname: parsed.values.hostname,
    port: parsed.values.port ? Number(parsed.values.port) : undefined,
    publicBaseUrl: parsed.values["public-base-url"],
    configPath: parsed.values["config-path"],
    dataDir: parsed.values["data-dir"],
    enableReader: parsed.values["enable-reader"] === true,
    snapshotId: parsed.values["snapshot-id"],
    dataContractVersion: parseNodeAppDataContractVersion(parsed.values["data-contract-version"]),
  })
  process.stdout.write(`${JSON.stringify({ baseUrl: backend.url, token })}\n`)
  const close = () => { void backend.close().finally(() => process.exit(0)) }
  process.once("SIGINT", close)
  process.once("SIGTERM", close)
}

if (import.meta.main) await runNodeAppBackendCli()

interface BackendRequestController extends AsyncDisposable {
  handle(request: Request): Promise<Response | undefined>
}

async function createReaderController(
  baseUrl: string,
  token: string,
  resourceScheduler: ResourceScheduler,
  fileOperations: BackendFileOperationManager,
  options: Pick<StartNodeAppBackendOptions, "configPath" | "dataDir">,
): Promise<BackendRequestController> {
  const platform = await loadNodePlatformModule("neoview")
  const factory = platform.createReaderHttpController
  if (typeof factory !== "function") throw new Error("NeoView platform is missing createReaderHttpController().")
  return await (factory as (input: Record<string, unknown>) => Promise<BackendRequestController>)({
    baseUrl,
    token,
    resourceScheduler,
    fileOperationService: fileOperations.scoped({ nodeId: "neoview" }).asService(),
    useDefaultLegacyProgressStore: true,
    ...options,
  })
}

async function serveLocalFile(url: URL): Promise<Response> {
  const requested = url.searchParams.get("path")
  if (!requested) return new Response("Missing local file path.", { status: 400 })
  const resolved = path.resolve(requested)
  const info = await stat(resolved).catch(() => undefined)
  if (!info?.isFile()) return new Response("Local file was not found.", { status: 404 })
  return new Response(Bun.file(resolved), {
    headers: {
      "content-type": Bun.file(resolved).type || "application/octet-stream",
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  })
}

async function listLocalFiles(url: URL): Promise<Response> {
  const requested = url.searchParams.get("path")
  if (!requested) return new Response("Missing local path.", { status: 400 })
  const root = path.resolve(requested)
  const recursive = url.searchParams.get("recursive") === "1" || url.searchParams.get("recursive") === "true"
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 2000) || 2000, 10_000)
  const entries: Array<{ name: string; path: string; isDirectory: boolean; sizeBytes: number; lastModified: number; type: string }> = []
  await collectLocalFiles(root, recursive, limit, entries)
  return Response.json({ root, truncated: entries.length >= limit, entries })
}

async function collectLocalFiles(
  root: string,
  recursive: boolean,
  limit: number,
  entries: Array<{ name: string; path: string; isDirectory: boolean; sizeBytes: number; lastModified: number; type: string }>,
): Promise<void> {
  const info = await stat(root).catch(() => undefined)
  if (!info || entries.length >= limit) return
  if (info.isFile()) {
    entries.push({ name: path.basename(root), path: root, isDirectory: false, sizeBytes: Number(info.size), lastModified: Number(info.mtimeMs), type: Bun.file(root).type })
    return
  }
  if (!info.isDirectory()) return
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entries.length >= limit) return
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (recursive) await collectLocalFiles(entryPath, recursive, limit, entries)
      continue
    }
    if (!entry.isFile()) continue
    const entryInfo = await stat(entryPath).catch(() => undefined)
    if (!entryInfo) continue
    entries.push({ name: entry.name, path: entryPath, isDirectory: false, sizeBytes: Number(entryInfo.size), lastModified: Number(entryInfo.mtimeMs), type: Bun.file(entryPath).type })
  }
}

function isAuthorized(request: Request, url: URL, token: string): boolean {
  return request.headers.get("x-xiranite-token") === token || url.searchParams.get("token") === token
}

function normalizeNodeId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`Invalid node ID: ${value}`)
  return value
}

function normalizeSnapshotId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) throw new Error(`Invalid node application snapshot ID: ${value}`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
