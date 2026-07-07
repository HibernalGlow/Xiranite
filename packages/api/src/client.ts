import { treaty, type Treaty } from "@elysiajs/eden"
import type {
  NodeOperationCleanupResponseDTO,
  NodeOperationDTO,
  NodeOperationEventsResponseDTO,
  NodeOperationStartResponseDTO,
  NodeOperationStreamMessageDTO,
  NodeRunEventDTO,
  NodeRunResultDTO,
  WorkspaceSnapshotDTO,
} from "@xiranite/shared"
import type { XiraniteApp } from "./index.js"

export interface XiraniteClientOptions {
  token?: string
}

export interface XiraniteSystemClient {
  health(): Promise<{ ok: boolean }>
}

export interface XiraniteWorkspaceClient {
  loadSnapshot(): Promise<WorkspaceSnapshotDTO>
  persistSnapshot(snapshot: WorkspaceSnapshotDTO): Promise<WorkspaceSnapshotDTO>
}

export interface XiraniteNodeClient {
  startNodeOperation<TInput = unknown>(
    nodeId: string,
    input: TInput,
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

export function createXiraniteClient(baseUrl: string, options: XiraniteClientOptions = {}): Treaty.Create<XiraniteApp> {
  return treaty<XiraniteApp>(baseUrl, treatyOptions(options))
}

export function createXiraniteSystemClient(baseUrl: string, options: XiraniteClientOptions = {}): XiraniteSystemClient {
  const client = createXiraniteClient(baseUrl, options)

  return {
    async health() {
      const result = await client.health.get()
      if (result.error) throw new Error(`Local backend health check failed: ${result.status}`)
      return result.data
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
    async startNodeOperation(nodeId, input) {
      const response = await fetch(apiUrl(baseUrl, `/nodes/${encodeURIComponent(nodeId)}/operations`), {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ input }),
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
