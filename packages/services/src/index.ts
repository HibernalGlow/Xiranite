import type { NodeRunHistoryRepository, WorkspaceRepository } from "@xiranite/repository"
import { ConfigService } from "./configService.js"
import { NodeRunHistoryService } from "./historyService.js"
import {
  createWorkspaceInputSchema,
  type NodeOperationCleanupResponseDTO,
  type NodeOperationDTO,
  type NodeOperationEventsResponseDTO,
  type NodeOperationPhaseDTO,
  type NodeOperationStreamMessageDTO,
  type NodeRunEventDTO,
  type NodeRunResultDTO,
  renameWorkspaceInputSchema,
  type CreateWorkspaceInput,
  type RenameWorkspaceInput,
  type WorkspaceSnapshotDTO,
  type WorkspaceDTO,
  workspaceSnapshotSchema,
} from "@xiranite/shared"

export interface WorkspaceServiceOptions {
  repository: WorkspaceRepository
  now?: () => number
  createId?: () => string
  history?: NodeRunHistoryService
}

export interface NodeRunner {
  runNode<TInput = unknown, TData = unknown>(
    nodeId: string,
    input: TInput,
    onEvent?: (event: NodeRunEventDTO) => void,
  ): Promise<NodeRunResultDTO<TData>>
}

export interface NodeRunnerServiceOptions {
  runner?: NodeRunner
  now?: () => number
  createOperationId?: () => string
  operationRetentionMs?: number
  history?: NodeRunHistoryService
}

export interface NodeOperationContext {
  componentId?: string
  workspaceId?: string
}

export class WorkspaceService {
  private readonly repository: WorkspaceRepository
  private readonly now: () => number
  private readonly createId: () => string
  private readonly history?: NodeRunHistoryService

  constructor(options: WorkspaceServiceOptions) {
    this.repository = options.repository
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? (() => Math.random().toString(36).slice(2))
    this.history = options.history
  }

  async listWorkspaces(): Promise<WorkspaceDTO[]> {
    return this.repository.listWorkspaces()
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceDTO> {
    const parsed = createWorkspaceInputSchema.parse(input)
    const now = this.now()
    const workspace = await this.repository.createWorkspace({
      id: `ws-${this.createId()}`,
      label: parsed.label,
      icon: parsed.icon,
      createdAt: now,
      updatedAt: now,
    })
    void this.history?.record({
      kind: "workspace",
      operation: "workspace.create",
      title: workspace.label,
      message: `Created workspace: ${workspace.label}`,
      target: { type: "workspace", id: workspace.id, label: workspace.label },
      workspaceId: workspace.id,
      input: parsed,
      result: workspace,
      startedAt: now,
      finishedAt: this.now(),
    })
    return workspace
  }

  async renameWorkspace(id: string, input: RenameWorkspaceInput): Promise<WorkspaceDTO> {
    const parsed = renameWorkspaceInputSchema.parse(input)
    const startedAt = this.now()
    const workspace = await this.repository.renameWorkspace(id, parsed.label, startedAt)
    void this.history?.record({
      kind: "workspace",
      operation: "workspace.rename",
      title: workspace.label,
      message: `Renamed workspace: ${workspace.label}`,
      target: { type: "workspace", id: workspace.id, label: workspace.label },
      workspaceId: workspace.id,
      input: { id, ...parsed },
      result: workspace,
      startedAt,
      finishedAt: this.now(),
    })
    return workspace
  }

  async deleteWorkspace(id: string): Promise<void> {
    const startedAt = this.now()
    await this.repository.deleteWorkspace(id)
    void this.history?.record({
      kind: "workspace",
      operation: "workspace.delete",
      title: id,
      message: `Deleted workspace: ${id}`,
      target: { type: "workspace", id },
      workspaceId: id,
      input: { id },
      startedAt,
      finishedAt: this.now(),
    })
  }

  async getSnapshot(): Promise<WorkspaceSnapshotDTO> {
    const [workspaces, lanes, components] = await Promise.all([
      this.repository.listWorkspaces(),
      this.repository.listLanes(),
      this.repository.listComponents(),
    ])

    return { workspaces, lanes, components }
  }

  async saveSnapshot(snapshot: WorkspaceSnapshotDTO): Promise<WorkspaceSnapshotDTO> {
    const parsed = workspaceSnapshotSchema.parse(snapshot)
    const saved = await this.repository.saveSnapshot(parsed)
    return saved
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const unavailableNodeRunner: NodeRunner = {
  async runNode() {
    return { success: false, message: "Xiranite node runner is not configured." }
  },
}

const defaultOperationRetentionMs = 30 * 60 * 1000
const defaultOperationEventLimit = 100
const maxOperationEventLimit = 1000

export class NodeRunnerService {
  private readonly runner: NodeRunner
  private readonly now: () => number
  private readonly createOperationId: () => string
  private readonly operationRetentionMs: number
  private readonly history?: NodeRunHistoryService
  private readonly operations = new Map<string, NodeOperationState>()

  constructor(options: NodeRunnerServiceOptions = {}) {
    this.runner = options.runner ?? unavailableNodeRunner
    this.now = options.now ?? Date.now
    this.createOperationId = options.createOperationId ?? (() => `op-${Math.random().toString(36).slice(2)}`)
    this.operationRetentionMs = options.operationRetentionMs ?? defaultOperationRetentionMs
    this.history = options.history
  }

  startOperation<TInput = unknown>(nodeId: string, input: TInput, context?: NodeOperationContext): NodeOperationDTO {
    this.cleanupOperations()
    const now = this.now()
    const operationId = this.createUniqueOperationId()
    let resolveCompletion!: (result: NodeRunResultDTO) => void
    const completion = new Promise<NodeRunResultDTO>((resolve) => {
      resolveCompletion = resolve
    })
    const state: NodeOperationState = {
      operationId,
      nodeId,
      input,
      componentId: context?.componentId,
      workspaceId: context?.workspaceId,
      phase: "queued",
      createdAt: now,
      updatedAt: now,
      events: [],
      listeners: new Set(),
      completion,
      resolveCompletion,
    }

    this.operations.set(operationId, state)
    void this.executeOperation(state)
    return toOperationDTO(state)
  }

  getOperation<TData = unknown>(operationId: string): NodeOperationDTO<TData> | undefined {
    const state = this.operations.get(operationId)
    return state ? toOperationDTO<TData>(state) : undefined
  }

  getOperationEvents<TData = unknown>(
    operationId: string,
    options: { fromEventIndex?: number; limit?: number } = {},
  ): NodeOperationEventsResponseDTO<TData> | undefined {
    const state = this.operations.get(operationId)
    if (!state) return undefined

    const from = normalizeEventIndex(options.fromEventIndex)
    const limit = normalizeEventLimit(options.limit)
    const end = Math.min(state.events.length, from + limit)
    const events = state.events.slice(from, end).map((event, offset) => ({
      index: from + offset,
      event,
    }))
    const next = end < state.events.length ? end : undefined

    return {
      operation: toOperationDTO<TData>(state),
      events,
      from,
      limit,
      next,
      total: state.events.length,
    }
  }

  cancelOperation<TData = unknown>(operationId: string, reason = "Node operation cancelled."): NodeOperationDTO<TData> | undefined {
    const state = this.operations.get(operationId)
    if (!state) return undefined
    if (isTerminalPhase(state.phase)) return toOperationDTO<TData>(state)

    state.cancelledAt = this.now()
    this.pushEvent(state, { type: "log", message: reason })
    this.finishOperation(state, { success: false, message: reason }, "cancelled")
    return toOperationDTO<TData>(state)
  }

  cleanupOperations(options: { maxAgeMs?: number; now?: number } = {}): NodeOperationCleanupResponseDTO {
    const maxAgeMs = normalizeRetentionMs(options.maxAgeMs ?? this.operationRetentionMs)
    const now = options.now ?? this.now()
    let removedCount = 0

    for (const [operationId, state] of this.operations) {
      if (!isTerminalPhase(state.phase)) continue
      const referenceTime = state.finishedAt ?? state.updatedAt
      if (now - referenceTime < maxAgeMs) continue
      this.operations.delete(operationId)
      removedCount += 1
    }

    return {
      removedCount,
      remainingCount: this.operations.size,
    }
  }

  subscribeOperation<TData = unknown>(
    operationId: string,
    listener: (message: NodeOperationStreamMessageDTO<TData>) => void,
    options: { fromEventIndex?: number; includeSnapshot?: boolean } = {},
  ): () => void {
    const state = this.operations.get(operationId)
    if (!state) throw new Error(`Node operation not found: ${operationId}`)

    if (options.includeSnapshot ?? true) {
      listener({ type: "operation", operation: toOperationDTO<TData>(state) })
    }

    const fromEventIndex = Math.max(0, options.fromEventIndex ?? 0)
    for (let index = fromEventIndex; index < state.events.length; index += 1) {
      listener({ type: "event", index, event: state.events[index]! })
    }

    if (isTerminalPhase(state.phase) && state.result) {
      listener({ type: "result", operation: toOperationDTO<TData>(state), result: state.result as NodeRunResultDTO<TData> })
      return () => {}
    }

    state.listeners.add(listener as OperationListener)
    return () => {
      state.listeners.delete(listener as OperationListener)
    }
  }

  async waitForOperation<TData = unknown>(operationId: string): Promise<NodeRunResultDTO<TData>> {
    const state = this.operations.get(operationId)
    if (!state) throw new Error(`Node operation not found: ${operationId}`)
    return await state.completion as NodeRunResultDTO<TData>
  }

  async runNode<TInput = unknown, TData = unknown>(
    nodeId: string,
    input: TInput,
    onEvent?: (event: NodeRunEventDTO) => void,
    context?: NodeOperationContext,
  ): Promise<NodeRunResultDTO<TData>> {
    const operation = this.startOperation(nodeId, input, context)
    const unsubscribe = this.subscribeOperation<TData>(operation.operationId, (message) => {
      if (message.type === "event") onEvent?.(message.event)
    }, { fromEventIndex: 0, includeSnapshot: false })
    try {
      return await this.waitForOperation<TData>(operation.operationId)
    } catch (error) {
      const message = `Node runner failed: ${errorMessage(error)}`
      onEvent?.({ type: "log", message })
      return { success: false, message }
    } finally {
      unsubscribe()
    }
  }

  private createUniqueOperationId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const operationId = this.createOperationId()
      if (!this.operations.has(operationId)) return operationId
    }
    return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }

  private async executeOperation(state: NodeOperationState): Promise<void> {
    if (isTerminalPhase(state.phase)) return
    state.phase = "running"
    state.startedAt = this.now()
    state.updatedAt = state.startedAt
    this.emitOperation(state)

    try {
      const result = await this.runner.runNode(state.nodeId, state.input, (event) => {
        if (isTerminalPhase(state.phase)) return
        this.pushEvent(state, event)
      })
      if (isTerminalPhase(state.phase)) return
      this.finishOperation(state, result, result.success ? "completed" : "error")
    } catch (error) {
      if (isTerminalPhase(state.phase)) return
      const message = `Node runner failed: ${errorMessage(error)}`
      this.pushEvent(state, { type: "log", message })
      this.finishOperation(state, { success: false, message }, "error")
    }
  }

  private pushEvent(state: NodeOperationState, event: NodeRunEventDTO): void {
    if (isTerminalPhase(state.phase)) return
    const index = state.events.push(event) - 1
    state.updatedAt = this.now()
    this.emit(state, { type: "event", index, event })
  }

  private finishOperation(state: NodeOperationState, result: NodeRunResultDTO, phase: Extract<NodeOperationPhaseDTO, "completed" | "error" | "cancelled">): void {
    if (isTerminalPhase(state.phase)) return
    state.phase = phase
    state.result = result
    state.finishedAt = this.now()
    state.updatedAt = state.finishedAt
    const message: NodeOperationStreamMessageDTO = {
      type: "result",
      operation: toOperationDTO(state),
      result,
    }
    this.emit(state, message)
    state.listeners.clear()
    state.resolveCompletion(result)

    void this.recordHistory(state, result, phase)
  }

  private async recordHistory(
    state: NodeOperationState,
    result: NodeRunResultDTO,
    phase: Extract<NodeOperationPhaseDTO, "completed" | "error" | "cancelled">,
  ): Promise<void> {
    if (!this.history) return
    const status = phase === "completed" ? "success" : phase === "error" ? "error" : "cancelled"
    const startedAt = state.startedAt ?? state.createdAt
    await this.history.recordFromOperation({
      nodeId: state.nodeId,
      componentId: state.componentId,
      workspaceId: state.workspaceId,
      input: state.input,
      status,
      result,
      eventCount: state.events.length,
      startedAt,
      finishedAt: state.finishedAt ?? this.now(),
    })
  }

  private emitOperation(state: NodeOperationState): void {
    this.emit(state, { type: "operation", operation: toOperationDTO(state) })
  }

  private emit(state: NodeOperationState, message: NodeOperationStreamMessageDTO): void {
    for (const listener of state.listeners) listener(message)
  }
}

interface NodeOperationState {
  operationId: string
  nodeId: string
  input: unknown
  componentId?: string
  workspaceId?: string
  phase: NodeOperationPhaseDTO
  createdAt: number
  updatedAt: number
  startedAt?: number
  cancelledAt?: number
  finishedAt?: number
  events: NodeRunEventDTO[]
  result?: NodeRunResultDTO
  listeners: Set<OperationListener>
  completion: Promise<NodeRunResultDTO>
  resolveCompletion: (result: NodeRunResultDTO) => void
}

type OperationListener = (message: NodeOperationStreamMessageDTO) => void

function toOperationDTO<TData = unknown>(state: NodeOperationState): NodeOperationDTO<TData> {
  return {
    operationId: state.operationId,
    nodeId: state.nodeId,
    componentId: state.componentId,
    workspaceId: state.workspaceId,
    phase: state.phase,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    startedAt: state.startedAt,
    cancelledAt: state.cancelledAt,
    finishedAt: state.finishedAt,
    eventCount: state.events.length,
    result: state.result as NodeRunResultDTO<TData> | undefined,
  }
}

function isTerminalPhase(phase: NodeOperationPhaseDTO): boolean {
  return phase === "completed" || phase === "error" || phase === "cancelled"
}

function normalizeEventIndex(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function normalizeEventLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return defaultOperationEventLimit
  return Math.min(maxOperationEventLimit, Math.max(1, Math.floor(value)))
}

function normalizeRetentionMs(value: number): number {
  if (!Number.isFinite(value)) return defaultOperationRetentionMs
  return Math.max(0, Math.floor(value))
}

export interface XiraniteServices {
  workspace: WorkspaceService
  nodes: NodeRunnerService
  config: ConfigService
  history?: NodeRunHistoryService
  system?: XiraniteSystemService
}

export interface LocalBackendRestartConfig {
  baseUrl: string
  token?: string
}

export interface LocalBackendRestartResult {
  restarted: boolean
  supported: boolean
  message: string
  config?: LocalBackendRestartConfig
}

export interface XiraniteSystemService {
  restartBackend?: () => Promise<LocalBackendRestartResult>
}

export interface CreateXiraniteServicesOptions {
  nodeRunner?: NodeRunner
  configPath?: string
  databasePath?: string
  dataDir?: string
  historyRepository?: NodeRunHistoryRepository
  system?: XiraniteSystemService
}

export function createXiraniteServices(repository: WorkspaceRepository, options: CreateXiraniteServicesOptions = {}): XiraniteServices {
  const history = options.historyRepository
    ? new NodeRunHistoryService({ repository: options.historyRepository })
    : undefined
  return {
    workspace: new WorkspaceService({ repository, history }),
    nodes: new NodeRunnerService({ runner: options.nodeRunner, history }),
    config: new ConfigService({
      configPath: options.configPath,
      databasePath: options.databasePath,
      dataDir: options.dataDir,
      history,
    }),
    history,
    system: options.system,
  }
}

export { ConfigService } from "./configService.js"
export { NodeRunHistoryService, sanitizeInput, summarizeInput } from "./historyService.js"
export type {
  EnsureConfigFileResult,
  GetAppConfigResult,
  GetConfigResult,
  GetNodeConfigResult,
  ImportLegacyResult,
  OpenConfigFileResult,
  UpdateAppConfigResult,
  UpdateNodeConfigResult,
} from "./configService.js"
export type { NodeRunHistoryServiceOptions } from "./historyService.js"
