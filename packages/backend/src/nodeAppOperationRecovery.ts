import { readAtomicJsonFile, updateAtomicJsonFile } from "@xiranite/config"
import type { NodeOperationDTO } from "@xiranite/shared"
import type { NodeRunHistoryService } from "@xiranite/services"
import path from "node:path"
import { resolveNodeAppDataDirectory } from "./nodeAppState.js"

const schemaVersion = 1

interface InterruptedOperation {
  operationId: string
  nodeId: string
  componentId?: string
  workspaceId?: string
  startedAt: number
  eventCount: number
}

interface ActiveOperationsDocument {
  schemaVersion: number
  operations: InterruptedOperation[]
}

/**
 * Tracks only in-flight standalone operations outside the shared database.
 * A graceful close clears this journal. If Bun disappears, the next backend
 * writes a terminal error history record and never attempts to replay work.
 */
export class NodeAppOperationRecoveryStore {
  readonly path: string

  constructor(nodeId: string, pathname = path.join(resolveNodeAppDataDirectory(nodeId), "active-operations.json")) {
    this.path = pathname
  }

  async recoverInterrupted(history: NodeRunHistoryService | undefined): Promise<number> {
    const document = await this.read()
    if (document.operations.length === 0) return 0
    if (history) {
      const finishedAt = Date.now()
      for (const operation of document.operations) {
        await history.recordFromOperation({
          nodeId: operation.nodeId,
          componentId: operation.componentId,
          workspaceId: operation.workspaceId,
          input: { interruptedOperationId: operation.operationId, recovery: "backend-crash" },
          status: "error",
          result: { success: false, message: "Operation was interrupted because the standalone node backend exited unexpectedly. It was not replayed." },
          eventCount: operation.eventCount,
          startedAt: operation.startedAt,
          finishedAt,
        })
      }
    }
    await this.replace([])
    return document.operations.length
  }

  async track(operation: NodeOperationDTO): Promise<void> {
    const record: InterruptedOperation = {
      operationId: operation.operationId,
      nodeId: operation.nodeId,
      componentId: operation.componentId,
      workspaceId: operation.workspaceId,
      startedAt: operation.startedAt ?? operation.createdAt,
      eventCount: operation.eventCount,
    }
    await this.update((operations) => [...operations.filter((item) => item.operationId !== record.operationId), record])
  }

  async complete(operationId: string): Promise<void> {
    await this.update((operations) => operations.filter((item) => item.operationId !== operationId))
  }

  async clear(): Promise<void> {
    await this.replace([])
  }

  private async read(): Promise<ActiveOperationsDocument> {
    return await readAtomicJsonFile(this.path, {
      fallback: { schemaVersion, operations: [] },
      parse: parseDocument,
    })
  }

  private async replace(operations: InterruptedOperation[]): Promise<void> {
    await updateAtomicJsonFile(this.path, () => ({ schemaVersion, operations }), {
      fallback: { schemaVersion, operations: [] },
      parse: parseDocument,
    })
  }

  private async update(update: (operations: InterruptedOperation[]) => InterruptedOperation[]): Promise<void> {
    await updateAtomicJsonFile(this.path, (document) => ({ schemaVersion, operations: update(document.operations) }), {
      fallback: { schemaVersion, operations: [] },
      parse: parseDocument,
    })
  }
}

function parseDocument(value: unknown): ActiveOperationsDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Node app active operation journal must be an object.")
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== schemaVersion || !Array.isArray(record.operations)) throw new Error("Node app active operation journal schema is unsupported.")
  return {
    schemaVersion,
    operations: record.operations.map(parseOperation),
  }
}

function parseOperation(value: unknown): InterruptedOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Node app active operation is invalid.")
  const record = value as Record<string, unknown>
  if (
    typeof record.operationId !== "string"
    || typeof record.nodeId !== "string"
    || typeof record.startedAt !== "number"
    || !Number.isFinite(record.startedAt)
    || typeof record.eventCount !== "number"
    || !Number.isInteger(record.eventCount)
  ) throw new Error("Node app active operation is invalid.")
  return {
    operationId: record.operationId,
    nodeId: record.nodeId,
    componentId: typeof record.componentId === "string" ? record.componentId : undefined,
    workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : undefined,
    startedAt: record.startedAt,
    eventCount: record.eventCount,
  }
}
