import type {
  NodeRunHistoryClearQueryDTO,
  NodeRunHistoryClearResultDTO,
  NodeRunHistoryItemDTO,
  NodeRunHistoryListDTO,
  NodeRunHistoryQueryDTO,
  NodeRunResultDTO,
  RuntimeHistoryClearQueryDTO,
  RuntimeHistoryClearResultDTO,
  RuntimeHistoryItemDTO,
  RuntimeHistoryListDTO,
  RuntimeHistoryQueryDTO,
} from "@xiranite/shared"
import type { NodeRunHistoryRepository } from "@xiranite/repository"

export interface NodeRunHistoryServiceOptions {
  repository: NodeRunHistoryRepository
  createId?: () => string
  now?: () => number
}

export interface RuntimeHistoryRecordInput {
  kind: RuntimeHistoryItemDTO["kind"]
  operation: string
  status?: RuntimeHistoryItemDTO["status"]
  title?: string
  message: string
  target?: RuntimeHistoryItemDTO["target"]
  nodeId?: string
  componentId?: string
  workspaceId?: string
  input?: unknown
  inputSummary?: string
  result?: unknown
  resultSummary?: string
  metadata?: Record<string, unknown>
  eventCount?: number
  startedAt?: number
  finishedAt?: number
}

function summarizeResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined
  const record = result as Record<string, unknown>
  const message = record.message
  if (typeof message === "string" && message.trim()) return message.slice(0, 240)
  const outputPath = record.outputPath
  if (typeof outputPath === "string" && outputPath.trim()) return outputPath.slice(0, 240)
  return undefined
}

/**
 * NodeRunHistoryService
 *
 * 封装 NodeRunHistoryRepository，提供 list/get/delete/clear 方法，
 * 以及给 NodeRunnerService.finishOperation 用的 recordFromOperation 工厂方法。
 *
 * 脱敏与摘要在此层处理，repository 只负责持久化。
 */
export class NodeRunHistoryService {
  private readonly repository: NodeRunHistoryRepository
  private readonly createId: () => string
  private readonly now: () => number

  constructor(options: NodeRunHistoryServiceOptions) {
    this.repository = options.repository
    this.createId = options.createId ?? (() => `hist-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`)
    this.now = options.now ?? Date.now
  }

  async listRuntime(query: RuntimeHistoryQueryDTO): Promise<RuntimeHistoryListDTO> {
    return this.repository.listRuntimeHistory(query)
  }

  async getRuntime(id: string): Promise<RuntimeHistoryItemDTO | undefined> {
    return this.repository.getRuntimeHistory(id)
  }

  async deleteRuntime(id: string): Promise<void> {
    await this.repository.deleteRuntimeHistory(id)
  }

  async clearRuntime(query: RuntimeHistoryClearQueryDTO): Promise<RuntimeHistoryClearResultDTO> {
    return this.repository.clearRuntimeHistory(query)
  }

  async list(query: NodeRunHistoryQueryDTO): Promise<NodeRunHistoryListDTO> {
    return this.repository.listNodeRunHistory(query)
  }

  async get(id: string): Promise<NodeRunHistoryItemDTO | undefined> {
    return this.repository.getNodeRunHistory(id)
  }

  async delete(id: string): Promise<void> {
    await this.repository.deleteNodeRunHistory(id)
  }

  async clear(query: NodeRunHistoryClearQueryDTO): Promise<NodeRunHistoryClearResultDTO> {
    return this.repository.clearNodeRunHistory(query)
  }

  /**
   * 从一次节点运行结束状态生成历史记录并持久化。
   * 失败不抛出（仅 console.warn），避免影响主运行链路。
   */
  async recordFromOperation(params: {
    nodeId: string
    componentId?: string
    workspaceId?: string
    input: unknown
    status: NodeRunHistoryItemDTO["status"]
    result: NodeRunResultDTO
    eventCount: number
    startedAt: number
    finishedAt: number
  }): Promise<void> {
    await this.record({
      kind: "node",
      operation: "node.run",
      status: params.status,
      title: params.nodeId,
      message: params.result.message,
      target: { type: "node", id: params.nodeId, label: params.nodeId },
      nodeId: params.nodeId,
      componentId: params.componentId,
      workspaceId: params.workspaceId,
      input: params.input,
      result: params.result,
      resultSummary: params.result.message,
      eventCount: params.eventCount,
      startedAt: params.startedAt,
      finishedAt: params.finishedAt,
    })
  }

  async record(params: RuntimeHistoryRecordInput): Promise<void> {
    try {
      const startedAt = params.startedAt ?? this.now()
      const finishedAt = params.finishedAt ?? this.now()
      const durationMs = Math.max(0, finishedAt - startedAt)
      const item: RuntimeHistoryItemDTO = {
        id: this.createId(),
        kind: params.kind,
        operation: params.operation,
        status: params.status ?? "success",
        title: params.title,
        message: params.message,
        target: params.target,
        nodeId: params.nodeId,
        componentId: params.componentId,
        workspaceId: params.workspaceId,
        input: sanitizeInput(params.input),
        inputSummary: params.inputSummary ?? summarizeInput(params.input),
        result: params.result,
        resultSummary: params.resultSummary ?? summarizeResult(params.result),
        metadata: sanitizeInput(params.metadata) as Record<string, unknown> | undefined,
        eventCount: params.eventCount,
        startedAt,
        finishedAt,
        durationMs,
      }
      await this.repository.createRuntimeHistory(item)
    } catch (error) {
      console.warn("[RuntimeHistory] Failed to record history:", error instanceof Error ? error.message : error)
    }
  }
}

// ── 脱敏 ──────────────────────────────────────────────────────────

const SENSITIVE_KEY_PATTERNS = [
  /^token$/i,
  /^password$/i,
  /^secret$/i,
  /^apikey$/i,
  /^api[-_]?key$/i,
  /^authorization$/i,
  /^auth$/i,
  /^credential$/i,
]

const REDACTED = "[REDACTED]"

/**
 * 递归脱敏 input 中的敏感字段。
 * 返回深拷贝，不修改原始 input。
 */
export function sanitizeInput(input: unknown): unknown {
  if (input === null || input === undefined) return input
  if (typeof input !== "object") return input
  if (Array.isArray(input)) return input.map(sanitizeInput)

  const record = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      out[key] = REDACTED
    } else if (value !== null && typeof value === "object") {
      out[key] = sanitizeInput(value)
    } else {
      out[key] = value
    }
  }
  return out
}

// ── 摘要 ──────────────────────────────────────────────────────────

const SUMMARY_KEYS = [
  "path",
  "rootPath",
  "sourcePath",
  "sourcePaths",
  "targetPath",
  "destinationPath",
  "action",
  "mode",
  "dryRun",
  "pattern",
  "ext",
  "extensions",
]

/**
 * 生成 input 的保守摘要字符串（≤240 字符）。
 * 只取预定义的有用键，不递归。
 */
export function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return ""
  const record = input as Record<string, unknown>
  const parts: string[] = []
  for (const key of SUMMARY_KEYS) {
    const value = record[key]
    if (value === undefined || value === null) continue
    const text = Array.isArray(value) ? value.join(",") : String(value)
    if (!text) continue
    parts.push(`${key}: ${text}`)
    if (parts.join(" · ").length > 240) break
  }
  return parts.join(" · ").slice(0, 240)
}
