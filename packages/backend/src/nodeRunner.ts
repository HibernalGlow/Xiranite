import { runNodeWithEvents } from "@xiranite/runtime/node-runner"
import type { NodeOperationContext, NodeOperationControl, NodeRunner } from "@xiranite/services"
import type { NodeRunEventDTO, NodeRunResultDTO } from "@xiranite/shared"

import type { BackendFileOperationManager } from "./fileOperations.js"

export interface BackendNodeRunnerOptions {
  fileOperations?: BackendFileOperationManager
}

export function createBackendNodeRunner(options: BackendNodeRunnerOptions = {}): NodeRunner {
  return {
    async runNode<TInput = unknown, TData = unknown>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEventDTO) => void, control?: NodeOperationControl, context: NodeOperationContext = {}) {
      return await runNodeWithEvents(nodeId, input, onEvent, control, {
        nodeId,
        componentId: context.componentId,
        workspaceId: context.workspaceId,
        fileOperations: options.fileOperations?.scoped({ nodeId, ...context }),
      }) as NodeRunResultDTO<TData>
    },
  }
}
