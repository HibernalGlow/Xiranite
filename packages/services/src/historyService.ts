import type {
  NodeRunHistoryClearQueryDTO,
  NodeRunHistoryClearResultDTO,
  NodeRunHistoryItemDTO,
  NodeRunHistoryListDTO,
  NodeRunHistoryQueryDTO,
  NodeRunResultDTO,
} from "@xiranite/shared"
import type { NodeRunHistoryRepository } from "@xiranite/repository"

export interface NodeRunHistoryServiceOptions {
  repository: NodeRunHistoryRepository
  createId?: () => string
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

  constructor(options: NodeRunHistoryServiceOptions) {
    this.repository = options.repository
    this.createId = options.createId ?? (() => `hist-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`)
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
    try {
      const durationMs = Math.max(0, params.finishedAt - params.startedAt)
      const item: NodeRunHistoryItemDTO = {
        id: this.createId(),
        nodeId: params.nodeId,
        componentId: params.componentId,
        workspaceId: params.workspaceId,
        input: sanitizeInput(params.input),
        inputSummary: summarizeInput(params.input),
        status: params.status,
        message: params.result.message,
        result: params.result,
        eventCount: params.eventCount,
        startedAt: params.startedAt,
        finishedAt: params.finishedAt,
        durationMs,
      }
      await this.repository.createNodeRunHistory(item)
    } catch (error) {
      console.warn("[NodeRunHistory] Failed to record history:", error instanceof Error ? error.message : error)
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
