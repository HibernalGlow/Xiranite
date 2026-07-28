import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { getNodeConfigFromBackend, saveNodeConfigToBackend } from "@/backend/configRpcClient"
import { runNodeOnLocalBackend } from "@/backend/nodeRpcClient"

export interface ExternalNodeGateway<TConfig = Record<string, unknown>> {
  readonly nodeId: string
  readonly config: {
    get(): Promise<{ config: TConfig | undefined; path: string }>
    patch(patch: Partial<TConfig>): Promise<void>
  }
  run<TInput = unknown, TData = unknown>(
    input: TInput,
    onEvent?: (event: NodeRunEvent) => void,
    context?: { componentId?: string; workspaceId?: string },
  ): Promise<NodeRunResult<TData>>
}

/** Stable frontend adapter for invoking another node's public interfaces. */
export function externalNode<TConfig = Record<string, unknown>>(nodeId: string): ExternalNodeGateway<TConfig> {
  return {
    nodeId,
    config: {
      get: () => getNodeConfigFromBackend<TConfig>(nodeId),
      patch: (patch) => saveNodeConfigToBackend<Partial<TConfig>>(nodeId, patch),
    },
    run: (input, onEvent, context) => {
      if (context) return runNodeOnLocalBackend(nodeId, input, onEvent, context)
      if (onEvent) return runNodeOnLocalBackend(nodeId, input, onEvent)
      return runNodeOnLocalBackend(nodeId, input)
    },
  }
}
