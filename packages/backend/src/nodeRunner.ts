import { runNodeFromMain } from "@xiranite/runtime/node-runner"
import type { NodeRunner } from "@xiranite/services"
import type { NodeRunEventDTO, NodeRunResultDTO } from "@xiranite/shared"

export function createBackendNodeRunner(): NodeRunner {
  return {
    async runNode<TInput = unknown, TData = unknown>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEventDTO) => void) {
      const response = await runNodeFromMain({ nodeId, input })
      response.events.forEach((event) => onEvent?.(event))
      return response.result as NodeRunResultDTO<TData>
    },
  }
}
