import { treaty, type Treaty } from "@elysiajs/eden"
import type {
  NodeOperationCleanupResponseDTO,
  NodeOperationDTO,
  NodeOperationEventsResponseDTO,
  NodeOperationStartResponseDTO,
  NodeOperationStreamMessageDTO,
  NodeRunEventDTO,
  NodeRunHistoryClearQueryDTO,
  NodeRunHistoryClearResultDTO,
  NodeRunHistoryItemDTO,
  NodeRunHistoryListDTO,
  NodeRunHistoryQueryDTO,
  NodeRunResultDTO,
  RuntimeHistoryClearQueryDTO,
  RuntimeHistoryClearResultDTO,
  RuntimeHistoryItemDTO,
  RuntimeHistoryListDTO,
  RuntimeHistoryQueryDTO,
  WorkspaceSnapshotDTO,
} from "@xiranite/shared"
import type { XiraniteApp } from "./index.js"

export interface XiraniteClientOptions {
  token?: string
}

export interface LocalBackendRestartConfig {
  baseUrl: string
  token?: string
}

export interface LocalBackendRestartResult {
  restarted: boolean
  supported: boolean
  message: string
  config?: LocalBackendRestartConfig
}

export interface XiraniteSystemClient {
  health(): Promise<{ ok: boolean }>
  restartBackend(): Promise<LocalBackendRestartResult>
}

export interface XiraniteWorkspaceClient {
  loadSnapshot(): Promise<WorkspaceSnapshotDTO>
  persistSnapshot(snapshot: WorkspaceSnapshotDTO): Promise<WorkspaceSnapshotDTO>
}

export interface XiraniteNodeClient {
  startNodeOperation<TInput = unknown>(
    nodeId: string,
    input: TInput,
    context?: { componentId?: string; workspaceId?: string },
  ): Promise<NodeOperationDTO>
  getNodeOperation<TData = unknown>(operationId: string): Promise<NodeOperationDTO<TData>>
  getNodeOperationEvents<TData = unknown>(
    operationId: string,
    options?: { fromEventIndex?: number; limit?: number },
  ): Promise<NodeOperationEventsResponseDTO<TData>>
  cancelNodeOperation<TData = unknown>(operationId: string): Promise<NodeOperationDTO<TData>>
  cleanupNodeOperations(options?: { maxAgeMs?: number }): Promise<NodeOperationCleanupResponseDTO>
  streamNodeOperation<TData = unknown>(
    operationId: string,
    onMessage: (message: NodeOperationStreamMessageDTO<TData>) => void,
    options?: { fromEventIndex?: number },
  ): Promise<void>
  runNode<TInput = unknown, TData = unknown>(
    nodeId: string,
    input: TInput,
    onEvent?: (event: NodeRunEventDTO) => void,
  ): Promise<NodeRunResultDTO<TData>>
}

export interface XiraniteConfigClient {
  getConfig(): Promise<{ config: unknown; path: string }>
  getConfigPath(): Promise<string>
  getNodeConfig<T = unknown>(nodeId: string): Promise<{ config: T | undefined; path: string }>
  updateNodeConfig<T = unknown>(nodeId: string, config: T): Promise<{ config: T; path: string }>
  getAppConfig<T = unknown>(section: string): Promise<{ config: T | undefined; path: string }>
  updateAppConfig<T = unknown>(section: string, config: T): Promise<{ config: T; path: string }>
  getCustomThemes(): Promise<{ themes: unknown[]; path: string }>
  saveCustomThemes(themes: unknown[]): Promise<{ themes: unknown[]; path: string }>
  getBackgroundImage(): Promise<{ url: string | null; path: string }>
  saveBackgroundImage(url: string | null): Promise<{ url: string | null; path: string }>
  openConfigFile(): Promise<{ opened: boolean; path: string }>
  importLegacy(legacyPath: string, nodeId: string): Promise<{ imported: boolean; config: unknown; path: string }>
}

export interface XiraniteRuntimeHistoryClient {
  list(query: RuntimeHistoryQueryDTO): Promise<RuntimeHistoryListDTO>
  get(id: string): Promise<RuntimeHistoryItemDTO>
  delete(id: string): Promise<void>
  clear(query: RuntimeHistoryClearQueryDTO): Promise<RuntimeHistoryClearResultDTO>
}

export interface XiraniteNodeRunHistoryClient {
  list(query: NodeRunHistoryQueryDTO): Promise<NodeRunHistoryListDTO>
  get(id: string): Promise<NodeRunHistoryItemDTO>
  delete(id: string): Promise<void>
  clear(query: NodeRunHistoryClearQueryDTO): Promise<NodeRunHistoryClearResultDTO>
}

export function createXiraniteConfigClient(baseUrl: string, options: XiraniteClientOptions = {}): XiraniteConfigClient {
  const headers = requestHeaders(options)

  return {
    async getConfig() {
      const response = await fetch(apiUrl(baseUrl, "/config"), { headers })
      if (!response.ok) throw new Error(`Config load failed: ${response.status}`)
      return await response.json() as { config: unknown; path: string }
    },
    async getConfigPath() {
      const response = await fetch(apiUrl(baseUrl, "/config/path"), { headers })
      if (!response.ok) throw new Error(`Config path load failed: ${response.status}`)
      const data = await response.json() as { path: string }
      return data.path
    },
    async getNodeConfig<T = unknown>(nodeId: string) {
      const response = await fetch(apiUrl(baseUrl, `/config/nodes/${encodeURIComponent(nodeId)}`), { headers })
      if (!response.ok) throw new Error(`Node config load failed: ${response.status}`)
      return await response.json() as { config: T | undefined; path: string }
    },
    async updateNodeConfig<T = unknown>(nodeId: string, config: T) {
      const response = await fetch(apiUrl(baseUrl, `/config/nodes/${encodeURIComponent(nodeId)}`), {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ config }),
      })
      if (!response.ok) throw new Error(`Node config save failed: ${response.status}`)
      return await response.json() as { config: T; path: string }
    },
    async getAppConfig<T = unknown>(section: string) {
      const response = await fetch(apiUrl(baseUrl, `/config/app/${encodeURIComponent(section)}`), { headers })
      if (!response.ok) throw new Error(`App config load failed: ${response.status}`)
      return await response.json() as { config: T | undefined; path: string }
    },
    async updateAppConfig<T = unknown>(section: string, config: T) {
      const response = await fetch(apiUrl(baseUrl, `/config/app/${encodeURIComponent(section)}`), {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ config }),
      })
      if (!response.ok) throw new Error(`App config save failed: ${response.status}`)
      return await response.json() as { config: T; path: string }
    },
    async getCustomThemes() {
      const response = await fetch(apiUrl(baseUrl, "/config/themes"), { headers })
      if (!response.ok) throw new Error(`Custom themes load failed: ${response.status}`)
      return await response.json() as { themes: unknown[]; path: string }
    },
    async saveCustomThemes(themes: unknown[]) {
      const response = await fetch(apiUrl(baseUrl, "/config/themes"), {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ themes }),
      })
      if (!response.ok) throw new Error(`Custom themes save failed: ${response.status}`)
      return await response.json() as { themes: unknown[]; path: string }
    },
    async getBackgroundImage() {
      const response = await fetch(apiUrl(baseUrl, "/config/bg-image"), { headers })
      if (!response.ok) throw new Error(`Background image load failed: ${response.status}`)
      return await response.json() as { url: string | null; path: string }
    },
    async saveBackgroundImage(url: string | null) {
      const response = await fetch(apiUrl(baseUrl, "/config/bg-image"), {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ url }),
      })
      if (!response.ok) throw new Error(`Background image save failed: ${response.status}`)
      return await response.json() as { url: string | null; path: string }
    },
    async openConfigFile() {
      const response = await fetch(apiUrl(baseUrl, "/config/open"), {
        method: "POST",
        headers,
      })
      if (!response.ok) throw new Error(`Config open failed: ${response.status}`)
      return await response.json() as { opened: boolean; path: string }
    },
    async importLegacy(legacyPath: string, nodeId: string) {
      const response = await fetch(apiUrl(baseUrl, "/config/import-legacy"), {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ legacyPath, nodeId }),
      })
      if (!response.ok) throw new Error(`Legacy import failed: ${response.status}`)
      return await response.json() as { imported: boolean; config: unknown; path: string }
    },
  }
}

export function createXiraniteClient(baseUrl: string, options: XiraniteClientOptions = {}): Treaty.Create<XiraniteApp> {
  return treaty<XiraniteApp>(baseUrl, treatyOptions(options))
}

export function createXiraniteSystemClient(baseUrl: string, options: XiraniteClientOptions = {}): XiraniteSystemClient {
  const client = createXiraniteClient(baseUrl, options)
  const headers = requestHeaders(options)

  return {
    async health() {
      const result = await client.health.get()
      if (result.error) throw new Error(`Local backend health check failed: ${result.status}`)
      return result.data
    },
    async restartBackend() {
      const response = await fetch(apiUrl(baseUrl, "/system/restart"), {
        method: "POST",
        headers,
      })
      const data = await response.json().catch(() => undefined) as LocalBackendRestartResult | undefined
      if (!response.ok && !data) throw new Error(`Local backend restart failed: ${response.status}`)
      if (data) return data
      return {
        restarted: false,
        supported: false,
        message: `Local backend restart failed: ${response.status}`,
      }
    },
  }
}

export function createXiraniteWorkspaceClient(baseUrl: string, options: XiraniteClientOptions = {}): XiraniteWorkspaceClient {
  const client = createXiraniteClient(baseUrl, options)

  return {
    async loadSnapshot() {
      const result = await client.workspace.snapshot.get()
      if (result.error) throw new Error(`Workspace snapshot load failed: ${result.status}`)
      return result.data.snapshot
    },
    async persistSnapshot(snapshot) {
      const result = await client.workspace.snapshot.put(snapshot)
      if (result.error) throw new Error(`Workspace snapshot persist failed: ${result.status}`)
      return result.data.snapshot
    },
  }
}

export function createXiraniteNodeClient(baseUrl: string, options: XiraniteClientOptions = {}): XiraniteNodeClient {
  const headers = requestHeaders(options)

  return {
    async startNodeOperation(nodeId, input, context) {
      const response = await fetch(apiUrl(baseUrl, `/nodes/${encodeURIComponent(nodeId)}/operations`), {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ input, context }),
      })
      if (!response.ok) throw new Error(`Node operation start failed: ${response.status}`)
      const data = await response.json() as NodeOperationStartResponseDTO
      return data.operation
    },
    async getNodeOperation<TData = unknown>(operationId: string) {
      const response = await fetch(apiUrl(baseUrl, `/node-operations/${encodeURIComponent(operationId)}`), {
        headers,
      })
      if (!response.ok) throw new Error(`Node operation load failed: ${response.status}`)
      const data = await response.json() as { operation: NodeOperationDTO<TData> }
      return data.operation
    },
    async getNodeOperationEvents<TData = unknown>(operationId: string, eventOptions?: { fromEventIndex?: number; limit?: number }) {
      const url = apiUrl(baseUrl, `/node-operations/${encodeURIComponent(operationId)}/events`)
      if (eventOptions?.fromEventIndex !== undefined) url.searchParams.set("from", String(eventOptions.fromEventIndex))
      if (eventOptions?.limit !== undefined) url.searchParams.set("limit", String(eventOptions.limit))
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`Node operation events load failed: ${response.status}`)
      return await response.json() as NodeOperationEventsResponseDTO<TData>
    },
    async cancelNodeOperation<TData = unknown>(operationId: string) {
      const response = await fetch(apiUrl(baseUrl, `/node-operations/${encodeURIComponent(operationId)}/cancel`), {
        method: "POST",
        headers,
      })
      if (!response.ok) throw new Error(`Node operation cancel failed: ${response.status}`)
      const data = await response.json() as { operation: NodeOperationDTO<TData> }
      return data.operation
    },
    async cleanupNodeOperations(cleanupOptions?: { maxAgeMs?: number }) {
      const url = apiUrl(baseUrl, "/node-operations")
      if (cleanupOptions?.maxAgeMs !== undefined) url.searchParams.set("maxAgeMs", String(cleanupOptions.maxAgeMs))
      const response = await fetch(url, {
        method: "DELETE",
        headers,
      })
      if (!response.ok) throw new Error(`Node operation cleanup failed: ${response.status}`)
      return await response.json() as NodeOperationCleanupResponseDTO
    },
    async streamNodeOperation<TData = unknown>(operationId: string, onMessage: (message: NodeOperationStreamMessageDTO<TData>) => void, streamOptions?: { fromEventIndex?: number }) {
      const url = apiUrl(baseUrl, `/node-operations/${encodeURIComponent(operationId)}/stream`)
      if (streamOptions?.fromEventIndex !== undefined) url.searchParams.set("from", String(streamOptions.fromEventIndex))
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`Node operation stream failed: ${response.status}`)
      await readNdjsonStream<NodeOperationStreamMessageDTO>(response, (message) => {
        onMessage(message as NodeOperationStreamMessageDTO<TData>)
      })
    },
    async runNode<TInput = unknown, TData = unknown>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEventDTO) => void) {
      const operation = await this.startNodeOperation(nodeId, input)
      let finalResult: NodeRunResultDTO<TData> | undefined
      await this.streamNodeOperation<TData>(operation.operationId, (message) => {
        if (message.type === "event") onEvent?.(message.event)
        if (message.type === "result") finalResult = message.result
      })
      if (!finalResult) throw new Error(`Node operation did not return a result: ${operation.operationId}`)
      return finalResult
    },
  }
}

export function createXiraniteRuntimeHistoryClient(baseUrl: string, options: XiraniteClientOptions = {}): XiraniteRuntimeHistoryClient {
  const headers = requestHeaders(options)

  return {
    async list(query) {
      const url = apiUrl(baseUrl, "/runtime-history")
      if (query.kind) url.searchParams.set("kind", query.kind)
      if (query.operation) url.searchParams.set("operation", query.operation)
      if (query.nodeId) url.searchParams.set("nodeId", query.nodeId)
      if (query.componentId) url.searchParams.set("componentId", query.componentId)
      if (query.workspaceId) url.searchParams.set("workspaceId", query.workspaceId)
      if (query.status) url.searchParams.set("status", query.status)
      if (query.limit !== undefined) url.searchParams.set("limit", String(query.limit))
      if (query.cursor) url.searchParams.set("cursor", query.cursor)
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`Runtime history load failed: ${response.status}`)
      return await response.json() as RuntimeHistoryListDTO
    },
    async get(id) {
      const response = await fetch(apiUrl(baseUrl, `/runtime-history/${encodeURIComponent(id)}`), { headers })
      if (!response.ok) throw new Error(`Runtime history item load failed: ${response.status}`)
      const data = await response.json() as { item: RuntimeHistoryItemDTO }
      return data.item
    },
    async delete(id) {
      const response = await fetch(apiUrl(baseUrl, `/runtime-history/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers,
      })
      if (!response.ok) throw new Error(`Runtime history delete failed: ${response.status}`)
    },
    async clear(query) {
      const url = apiUrl(baseUrl, "/runtime-history")
      if (query.kind) url.searchParams.set("kind", query.kind)
      if (query.operation) url.searchParams.set("operation", query.operation)
      if (query.nodeId) url.searchParams.set("nodeId", query.nodeId)
      if (query.componentId) url.searchParams.set("componentId", query.componentId)
      if (query.workspaceId) url.searchParams.set("workspaceId", query.workspaceId)
      if (query.before !== undefined) url.searchParams.set("before", String(query.before))
      const response = await fetch(url, { method: "DELETE", headers })
      if (!response.ok) throw new Error(`Runtime history clear failed: ${response.status}`)
      return await response.json() as RuntimeHistoryClearResultDTO
    },
  }
}

function treatyOptions(options: XiraniteClientOptions): Treaty.Config {
  if (!options.token) return {}
  return {
    headers: {
      "x-xiranite-token": options.token,
    },
  }
}

function requestHeaders(options: XiraniteClientOptions): Record<string, string> {
  return options.token ? { "x-xiranite-token": options.token } : {}
}

function apiUrl(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
}

export function createXiraniteNodeRunHistoryClient(baseUrl: string, options: XiraniteClientOptions = {}): XiraniteNodeRunHistoryClient {
  const headers = requestHeaders(options)

  return {
    async list(query) {
      const url = apiUrl(baseUrl, "/node-run-history")
      if (query.nodeId) url.searchParams.set("nodeId", query.nodeId)
      if (query.componentId) url.searchParams.set("componentId", query.componentId)
      if (query.workspaceId) url.searchParams.set("workspaceId", query.workspaceId)
      if (query.status) url.searchParams.set("status", query.status)
      if (query.limit !== undefined) url.searchParams.set("limit", String(query.limit))
      if (query.cursor) url.searchParams.set("cursor", query.cursor)
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`Node run history load failed: ${response.status}`)
      return await response.json() as NodeRunHistoryListDTO
    },
    async get(id) {
      const response = await fetch(apiUrl(baseUrl, `/node-run-history/${encodeURIComponent(id)}`), { headers })
      if (!response.ok) throw new Error(`Node run history item load failed: ${response.status}`)
      const data = await response.json() as { item: NodeRunHistoryItemDTO }
      return data.item
    },
    async delete(id) {
      const response = await fetch(apiUrl(baseUrl, `/node-run-history/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers,
      })
      if (!response.ok) throw new Error(`Node run history delete failed: ${response.status}`)
    },
    async clear(query) {
      const url = apiUrl(baseUrl, "/node-run-history")
      if (query.nodeId) url.searchParams.set("nodeId", query.nodeId)
      if (query.componentId) url.searchParams.set("componentId", query.componentId)
      if (query.workspaceId) url.searchParams.set("workspaceId", query.workspaceId)
      if (query.before !== undefined) url.searchParams.set("before", String(query.before))
      const response = await fetch(url, { method: "DELETE", headers })
      if (!response.ok) throw new Error(`Node run history clear failed: ${response.status}`)
      return await response.json() as NodeRunHistoryClearResultDTO
    },
  }
}

async function readNdjsonStream<TMessage>(response: Response, onMessage: (message: TMessage) => void): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Response does not contain a readable stream.")

  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    buffer = consumeLines(buffer, onMessage)
  }

  buffer += decoder.decode()
  consumeLines(`${buffer}\n`, onMessage)
}

function consumeLines<TMessage>(buffer: string, onMessage: (message: TMessage) => void): string {
  const lines = buffer.split(/\r?\n/)
  const rest = lines.pop() ?? ""
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) onMessage(JSON.parse(trimmed) as TMessage)
  }
  return rest
}
