import type {
  ComponentDTO,
  LaneDTO,
  NodeRunHistoryClearQueryDTO,
  NodeRunHistoryClearResultDTO,
  NodeRunHistoryItemDTO,
  NodeRunHistoryListDTO,
  NodeRunHistoryQueryDTO,
  RuntimeHistoryClearQueryDTO,
  RuntimeHistoryClearResultDTO,
  RuntimeHistoryItemDTO,
  RuntimeHistoryListDTO,
  RuntimeHistoryQueryDTO,
  WorkspaceDTO,
  WorkspaceSnapshotDTO,
} from "@xiranite/shared"

export interface WorkspaceRepository {
  listWorkspaces(): Promise<WorkspaceDTO[]>
  createWorkspace(workspace: WorkspaceDTO): Promise<WorkspaceDTO>
  renameWorkspace(id: string, label: string, updatedAt: number): Promise<WorkspaceDTO>
  deleteWorkspace(id: string): Promise<void>
  listLanes(): Promise<LaneDTO[]>
  listComponents(): Promise<ComponentDTO[]>
  saveSnapshot(snapshot: WorkspaceSnapshotDTO): Promise<WorkspaceSnapshotDTO>
  getKvValue(key: string): Promise<string | null>
  setKvValue(key: string, value: string): Promise<void>
  deleteKvValue(key: string): Promise<void>
}

export interface RuntimeHistoryRepository {
  createRuntimeHistory(item: RuntimeHistoryItemDTO): Promise<RuntimeHistoryItemDTO>
  listRuntimeHistory(query: RuntimeHistoryQueryDTO): Promise<RuntimeHistoryListDTO>
  getRuntimeHistory(id: string): Promise<RuntimeHistoryItemDTO | undefined>
  deleteRuntimeHistory(id: string): Promise<void>
  clearRuntimeHistory(query: RuntimeHistoryClearQueryDTO): Promise<RuntimeHistoryClearResultDTO>
}

export interface NodeRunHistoryRepository extends RuntimeHistoryRepository {
  createNodeRunHistory(item: NodeRunHistoryItemDTO): Promise<NodeRunHistoryItemDTO>
  listNodeRunHistory(query: NodeRunHistoryQueryDTO): Promise<NodeRunHistoryListDTO>
  getNodeRunHistory(id: string): Promise<NodeRunHistoryItemDTO | undefined>
  deleteNodeRunHistory(id: string): Promise<void>
  clearNodeRunHistory(query: NodeRunHistoryClearQueryDTO): Promise<NodeRunHistoryClearResultDTO>
}

export interface MemoryWorkspaceRepositoryOptions {
  workspaces?: WorkspaceDTO[]
  lanes?: LaneDTO[]
  components?: ComponentDTO[]
}

export function createMemoryWorkspaceRepository(options: MemoryWorkspaceRepositoryOptions = {}): WorkspaceRepository {
  let workspaces = [...(options.workspaces ?? [])]
  let lanes = [...(options.lanes ?? [])]
  let components = [...(options.components ?? [])]
  let kvStore = new Map<string, string>()

  return {
    async listWorkspaces() {
      return clone(workspaces)
    },
    async createWorkspace(workspace) {
      workspaces = [...workspaces.filter((item) => item.id !== workspace.id), workspace]
      return clone(workspace)
    },
    async renameWorkspace(id, label, updatedAt) {
      const workspace = workspaces.find((item) => item.id === id)
      if (!workspace) throw new Error(`Workspace not found: ${id}`)

      const next = { ...workspace, label, updatedAt }
      workspaces = workspaces.map((item) => item.id === id ? next : item)
      return clone(next)
    },
    async deleteWorkspace(id) {
      workspaces = workspaces.filter((workspace) => workspace.id !== id)
      lanes = lanes.filter((lane) => lane.workspaceId !== id)
      components = components.filter((component) => component.workspaceId !== id)
    },
    async listLanes() {
      return clone(lanes)
    },
    async listComponents() {
      return clone(components)
    },
    async saveSnapshot(snapshot) {
      workspaces = clone(snapshot.workspaces)
      lanes = clone(snapshot.lanes)
      components = clone(snapshot.components)
      return clone(snapshot)
    },
    async getKvValue(key) {
      return kvStore.get(key) ?? null
    },
    async setKvValue(key, value) {
      kvStore.set(key, value)
    },
    async deleteKvValue(key) {
      kvStore.delete(key)
    },
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

// ── Memory NodeRunHistoryRepository ────────────────────────────────

export interface MemoryNodeRunHistoryRepositoryOptions {
  items?: NodeRunHistoryItemDTO[]
  limitPerNode?: number
  globalLimit?: number
}

export function createMemoryNodeRunHistoryRepository(
  options: MemoryNodeRunHistoryRepositoryOptions = {},
): NodeRunHistoryRepository {
  let items = (options.items ?? []).map(nodeHistoryToRuntimeHistory)
  const limitPerNode = options.limitPerNode ?? 100
  const globalLimit = options.globalLimit ?? 1000

  function enforceLimits(): void {
    if (items.length > globalLimit) {
      items = items.slice(items.length - globalLimit)
    }
    if (limitPerNode > 0) {
      const byNode = new Map<string, RuntimeHistoryItemDTO[]>()
      for (const item of items) {
        if (item.kind !== "node" || !item.nodeId) continue
        const list = byNode.get(item.nodeId) ?? []
        list.push(item)
        byNode.set(item.nodeId, list)
      }
      const next: RuntimeHistoryItemDTO[] = []
      for (const list of byNode.values()) {
        if (list.length > limitPerNode) {
          next.push(...list.slice(list.length - limitPerNode))
        } else {
          next.push(...list)
        }
      }
      next.sort((a, b) => a.finishedAt - b.finishedAt)
      const nodeIds = new Set(next.map((item) => item.id))
      items = items.filter((item) => item.kind !== "node" || nodeIds.has(item.id))
    }
  }

  const repository: NodeRunHistoryRepository = {
    async createRuntimeHistory(item) {
      items = [...items.filter((existing) => existing.id !== item.id), item]
      enforceLimits()
      return clone(item)
    },
    async listRuntimeHistory(query) {
      let filtered = items.slice()
      if (query.kind) filtered = filtered.filter((item) => item.kind === query.kind)
      if (query.operation) filtered = filtered.filter((item) => item.operation === query.operation)
      if (query.nodeId) filtered = filtered.filter((item) => item.nodeId === query.nodeId)
      if (query.componentId) filtered = filtered.filter((item) => item.componentId === query.componentId)
      if (query.workspaceId) filtered = filtered.filter((item) => item.workspaceId === query.workspaceId)
      if (query.status) filtered = filtered.filter((item) => item.status === query.status)

      filtered.sort((a, b) => b.finishedAt - a.finishedAt)

      let startIndex = 0
      if (query.cursor) {
        const cursorIndex = filtered.findIndex((item) => item.id === query.cursor)
        if (cursorIndex >= 0) startIndex = cursorIndex + 1
      }

      const limit = query.limit ?? 50
      const slice = filtered.slice(startIndex, startIndex + limit)
      const nextCursor = startIndex + limit < filtered.length ? slice[slice.length - 1]?.id ?? null : null

      return {
        items: clone(slice),
        nextCursor,
      }
    },
    async getRuntimeHistory(id) {
      const item = items.find((existing) => existing.id === id)
      return item ? clone(item) : undefined
    },
    async deleteRuntimeHistory(id) {
      items = items.filter((existing) => existing.id !== id)
    },
    async clearRuntimeHistory(query) {
      const before = query.before
      const beforeCount = items.length
      items = items.filter((item) => {
        if (query.kind && item.kind !== query.kind) return true
        if (query.operation && item.operation !== query.operation) return true
        if (query.nodeId && item.nodeId !== query.nodeId) return true
        if (query.componentId && item.componentId !== query.componentId) return true
        if (query.workspaceId && item.workspaceId !== query.workspaceId) return true
        if (before !== undefined && item.finishedAt >= before) return true
        return false
      })
      return { deletedCount: beforeCount - items.length }
    },
    async createNodeRunHistory(item) {
      await repository.createRuntimeHistory(nodeHistoryToRuntimeHistory(item))
      return clone(item)
    },
    async listNodeRunHistory(query) {
      const result = await repository.listRuntimeHistory({ ...query, kind: "node" })
      return {
        items: result.items.map(runtimeHistoryToNodeHistory).filter((item): item is NodeRunHistoryItemDTO => item !== undefined),
        nextCursor: result.nextCursor,
      }
    },
    async getNodeRunHistory(id) {
      const item = await repository.getRuntimeHistory(id)
      const nodeItem = item ? runtimeHistoryToNodeHistory(item) : undefined
      return nodeItem ? clone(nodeItem) : undefined
    },
    async deleteNodeRunHistory(id) {
      await repository.deleteRuntimeHistory(id)
    },
    async clearNodeRunHistory(query) {
      return await repository.clearRuntimeHistory({ ...query, kind: "node" })
    },
  }
  return repository
}

function nodeHistoryToRuntimeHistory(item: NodeRunHistoryItemDTO): RuntimeHistoryItemDTO {
  return {
    id: item.id,
    kind: "node",
    operation: "node.run",
    status: item.status,
    title: item.nodeId,
    message: item.message,
    target: { type: "node", id: item.nodeId, label: item.nodeId },
    nodeId: item.nodeId,
    componentId: item.componentId,
    workspaceId: item.workspaceId,
    input: item.input,
    inputSummary: item.inputSummary,
    result: item.result,
    resultSummary: item.result?.message,
    eventCount: item.eventCount,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    durationMs: item.durationMs,
  }
}

function runtimeHistoryToNodeHistory(item: RuntimeHistoryItemDTO): NodeRunHistoryItemDTO | undefined {
  if (item.kind !== "node" || !item.nodeId) return undefined
  if (item.status !== "success" && item.status !== "error" && item.status !== "cancelled") return undefined
  return {
    id: item.id,
    nodeId: item.nodeId,
    componentId: item.componentId,
    workspaceId: item.workspaceId,
    input: item.input,
    inputSummary: item.inputSummary,
    status: item.status,
    message: item.message,
    result: item.result as NodeRunHistoryItemDTO["result"],
    eventCount: item.eventCount ?? 0,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    durationMs: item.durationMs,
  }
}
