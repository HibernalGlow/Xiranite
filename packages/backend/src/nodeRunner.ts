import { runNodeWithEvents } from "@xiranite/runtime/node-runner"
import type { NodeMemoryProtectionOptions, NodeOperationContext, NodeOperationControl, NodeRunner } from "@xiranite/services"
import type { NodeRunEventDTO, NodeRunResultDTO } from "@xiranite/shared"

import type { BackendFileOperationManager } from "./fileOperations.js"

export interface BackendNodeRunnerOptions {
  fileOperations?: BackendFileOperationManager
}

const MIB = 1024 * 1024

export function createBackendNodeMemoryProtection(env: Record<string, string | undefined> = process.env): NodeMemoryProtectionOptions {
  return {
    defaultPolicy: {
      maxRssGrowthBytes: memoryLimitBytes(env.XIRANITE_NODE_MAX_RSS_GROWTH_MIB, 8_192),
      maxHeapGrowthBytes: memoryLimitBytes(env.XIRANITE_NODE_MAX_HEAP_GROWTH_MIB, 4_096),
      maxRetainedEvents: positiveInteger(env.XIRANITE_NODE_MAX_RETAINED_EVENTS, 1_000),
      sampleIntervalMs: 250,
    },
    nodePolicies: {
      xlchemy: {
        maxRssGrowthBytes: memoryLimitBytes(env.XIRANITE_XLCHEMY_MAX_RSS_GROWTH_MIB, 4_096),
        maxHeapGrowthBytes: memoryLimitBytes(env.XIRANITE_XLCHEMY_MAX_HEAP_GROWTH_MIB, 2_048),
        maxRetainedEvents: positiveInteger(env.XIRANITE_XLCHEMY_MAX_RETAINED_EVENTS, 256),
        sampleIntervalMs: 100,
      },
    },
    readMemoryUsage: () => {
      const usage = process.memoryUsage()
      return { rssBytes: usage.rss, heapUsedBytes: usage.heapUsed }
    },
  }
}

function memoryLimitBytes(value: string | undefined, fallbackMiB: number): number {
  const mebibytes = Number(value ?? fallbackMiB)
  return (Number.isFinite(mebibytes) && mebibytes > 0 ? mebibytes : fallbackMiB) * MIB
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
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
