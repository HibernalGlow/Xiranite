import { createXiraniteNodeClient } from "@xiranite/api/client"
import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { NodeOperationCleanupResponseDTO, NodeOperationDTO } from "@xiranite/shared"
import { useNodeOperations } from "@/store/nodeOperations"
import { resolveLocalBackendConfig, type LocalBackendConfig } from "./localBackendConfig"

let nodeClient: ReturnType<typeof createXiraniteNodeClient> | null = null
let nodeClientKey: string | null = null

export async function runNodeOnLocalBackend<TInput = unknown, TData = unknown>(
  nodeId: string,
  input: TInput,
  onEvent?: (event: NodeRunEvent) => void,
  context?: { componentId?: string; workspaceId?: string },
): Promise<NodeRunResult<TData>> {
  let operationId: string | undefined
  try {
    const client = getNodeClient()
    const operation = await client.startNodeOperation<TInput>(nodeId, input, context)
    operationId = operation.operationId
    useNodeOperations.getState().upsertOperation(operation)

    let finalResult: NodeRunResult<TData> | undefined
    await client.streamNodeOperation<TData>(operation.operationId, (message) => {
      if (message.type === "operation") {
        useNodeOperations.getState().upsertOperation(message.operation)
      } else if (message.type === "event") {
        useNodeOperations.getState().appendEvent(operation.operationId, message.index, message.event)
        onEvent?.(message.event)
      } else {
        finalResult = message.result
        useNodeOperations.getState().finishOperation(message.operation, message.result)
      }
    })

    if (!finalResult) throw new Error(`Node operation did not return a result: ${operation.operationId}`)
    return finalResult
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result: NodeRunResult<TData> = { success: false, message }
    if (operationId) {
      markTrackedOperationFailed(operationId, nodeId, result)
    } else {
      useNodeOperations.getState().failBeforeStart(nodeId, message)
    }
    return result
  }
}

export async function cancelNodeOperationOnLocalBackend<TData = unknown>(operationId: string): Promise<NodeOperationDTO<TData>> {
  const operation = await getNodeClient().cancelNodeOperation<TData>(operationId)
  useNodeOperations.getState().upsertOperation(operation)
  return operation
}

export async function pauseNodeOperationOnLocalBackend<TData = unknown>(operationId: string): Promise<NodeOperationDTO<TData>> {
  const operation = await getNodeClient().pauseNodeOperation<TData>(operationId)
  useNodeOperations.getState().upsertOperation(operation)
  return operation
}

export async function resumeNodeOperationOnLocalBackend<TData = unknown>(operationId: string): Promise<NodeOperationDTO<TData>> {
  const operation = await getNodeClient().resumeNodeOperation<TData>(operationId)
  useNodeOperations.getState().upsertOperation(operation)
  return operation
}

export async function cleanupNodeOperationsOnLocalBackend(options?: { maxAgeMs?: number }): Promise<NodeOperationCleanupResponseDTO> {
  return getNodeClient().cleanupNodeOperations(options)
}

function getNodeClient() {
  const config = resolveLocalBackendConfig()
  const key = backendConfigCacheKey(config)
  if (nodeClient && nodeClientKey === key) return nodeClient

  nodeClient = createXiraniteNodeClient(config.baseUrl, { token: config.token })
  nodeClientKey = key
  return nodeClient
}

function backendConfigCacheKey(config: LocalBackendConfig): string {
  return `${config.baseUrl}\n${config.token ?? ""}`
}

function markTrackedOperationFailed(operationId: string, nodeId: string, result: NodeRunResult) {
  const now = Date.now()
  useNodeOperations.getState().appendEvent(operationId, undefined, { type: "log", message: result.message })
  const current = useNodeOperations.getState().operations.find((operation) => operation.operationId === operationId)
  useNodeOperations.getState().finishOperation({
    operationId,
    nodeId,
    phase: "error",
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    startedAt: current?.startedAt,
    finishedAt: now,
    eventCount: current?.eventCount ?? 0,
    result,
  }, result)
}
