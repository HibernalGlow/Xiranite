import { runNodeWithEvents } from "@xiranite/runtime/node-runner"
import type { NodeOperationControl, NodeRunner } from "@xiranite/services"
import type { NodeRunEventDTO, NodeRunResultDTO } from "@xiranite/shared"

export function createBackendNodeRunner(): NodeRunner {
  return {
    async runNode<TInput = unknown, TData = unknown>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEventDTO) => void, control?: NodeOperationControl) {
      return await runNodeWithEvents(nodeId, input, onEvent, control) as NodeRunResultDTO<TData>
    },
  }
}
