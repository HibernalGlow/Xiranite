import { createXiraniteNodeClient } from "@xiranite/api/client"
import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { resolveLocalBackendConfig } from "./localBackendConfig"

let nodeClient: ReturnType<typeof createXiraniteNodeClient> | null = null

export async function runNodeOnLocalBackend<TInput = unknown, TData = unknown>(
  nodeId: string,
  input: TInput,
  onEvent?: (event: NodeRunEvent) => void,
): Promise<NodeRunResult<TData>> {
  return getNodeClient().runNode<TInput, TData>(nodeId, input, onEvent)
}

function getNodeClient() {
  if (nodeClient) return nodeClient

  const config = resolveLocalBackendConfig()
  nodeClient = createXiraniteNodeClient(config.baseUrl, { token: config.token })
  return nodeClient
}
