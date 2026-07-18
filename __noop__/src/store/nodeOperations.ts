import { create } from "zustand"
import { devtools } from "zustand/middleware"
import type { NodeOperationDTO, NodeOperationPhaseDTO, NodeRunEventDTO, NodeRunResultDTO } from "@xiranite/shared"

const MAX_TRACKED_OPERATIONS = 30
const MAX_EVENTS_PER_OPERATION = 80

export interface TrackedNodeOperation<TData = unknown> {
  operationId: string
  nodeId: string
  componentId?: string
  workspaceId?: string
  phase: NodeOperationPhaseDTO
  createdAt: number
  updatedAt: number
  startedAt?: number
  cancelledAt?: number
  finishedAt?: number
  eventCount: number
  result?: NodeRunResultDTO<TData>
  events: NodeRunEventDTO[]
  lastMessage?: string
  lastProgress?: number
}

interface NodeOperationsState {
  operations: TrackedNodeOperation[]
  upsertOperation: (operation: NodeOperationDTO) => void
  appendEvent: (operationId: string, index: number | undefined, event: NodeRunEventDTO) => void
  finishOperation: (operation: NodeOperationDTO, result: NodeRunResultDTO) => void
  failBeforeStart: (nodeId: string, message: string) => void
  clearTerminal: () => void
  removeOperation: (operationId: string) => void
  reset: () => void
}

export const useNodeOperations = create<NodeOperationsState>()(
  devtools(
    (set) => ({
      operations: [],
      upsertOperation: (operation) => {
        set((state) => ({ operations: upsertTrackedOperation(state.operations, operation) }), false, "nodeOperations/upsert")
      },
      appendEvent: (operationId, index, event) => {
        set((state) => ({ operations: appendTrackedEvent(state.operations, operationId, index, event) }), false, "nodeOperations/event")
      },
      finishOperation: (operation, result) => {
        set((state) => ({ operations: finishTrackedOperation(state.operations, operation, result) }), false, "nodeOperations/finish")
      },
      failBeforeStart: (nodeId, message) => {
        set((state) => ({ operations: addSyntheticFailure(state.operations, nodeId, message) }), false, "nodeOperations/failBeforeStart")
      },
      clearTerminal: () => {
        set((state) => ({ operations: state.operations.filter((operation) => !isTerminalPhase(operation.phase)) }), false, "nodeOperations/clearTerminal")
      },
      removeOperation: (operationId) => {
        set((state) => ({ operations: state.operations.filter((operation) => operation.operationId !== operationId) }), false, "nodeOperations/remove")
      },
      reset: () => {
        set({ operations: [] }, false, "nodeOperations/reset")
      },
    }),
    { name: "xiranite-node-operations" },
  ),
)

export function activeNodeOperationCount(operations: TrackedNodeOperation[]): number {
  return operations.filter((operation) => !isTerminalPhase(operation.phase)).length
}

export function isTerminalPhase(phase: NodeOperationPhaseDTO): boolean {
  return phase === "completed" || phase === "error" || phase === "cancelled"
}

function upsertTrackedOperation(operations: TrackedNodeOperation[], operation: NodeOperationDTO): TrackedNodeOperation[] {
  const existing = operations.find((item) => item.operationId === operation.operationId)
  const next: TrackedNodeOperation = {
    ...existing,
    ...operation,
    events: existing?.events ?? [],
    lastMessage: existing?.lastMessage ?? operation.result?.message,
    lastProgress: existing?.lastProgress,
  }
  return trimOperations([next, ...operations.filter((item) => item.operationId !== operation.operationId)])
}

function appendTrackedEvent(
  operations: TrackedNodeOperation[],
  operationId: string,
  index: number | undefined,
  event: NodeRunEventDTO,
): TrackedNodeOperation[] {
  return operations.map((operation) => {
    if (operation.operationId !== operationId) return operation
    const events = [...operation.events, event].slice(-MAX_EVENTS_PER_OPERATION)
    return {
      ...operation,
      updatedAt: Date.now(),
      eventCount: Math.max(operation.eventCount, (index ?? operation.eventCount) + 1),
      events,
      lastMessage: event.message,
      lastProgress: event.type === "progress" ? event.progress : operation.lastProgress,
    }
  })
}

function finishTrackedOperation(
  operations: TrackedNodeOperation[],
  operation: NodeOperationDTO,
  result: NodeRunResultDTO,
): TrackedNodeOperation[] {
  const withOperation = upsertTrackedOperation(operations, operation)
  return withOperation.map((item) => {
    if (item.operationId !== operation.operationId) return item
    return {
      ...item,
      ...operation,
      result,
      lastMessage: result.message,
      lastProgress: result.success ? 100 : item.lastProgress,
    }
  })
}

function addSyntheticFailure(operations: TrackedNodeOperation[], nodeId: string, message: string): TrackedNodeOperation[] {
  const now = Date.now()
  const operation: TrackedNodeOperation = {
    operationId: `local-failure-${now.toString(36)}-${Math.random().toString(36).slice(2)}`,
    nodeId,
    phase: "error",
    createdAt: now,
    updatedAt: now,
    finishedAt: now,
    eventCount: 1,
    events: [{ type: "log", message }],
    result: { success: false, message },
    lastMessage: message,
  }
  return trimOperations([operation, ...operations])
}

function trimOperations(operations: TrackedNodeOperation[]): TrackedNodeOperation[] {
  return operations.slice(0, MAX_TRACKED_OPERATIONS)
}

