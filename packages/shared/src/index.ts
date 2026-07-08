import { z } from "zod"

export const workspaceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const laneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  workspaceId: z.string().min(1),
  widthRatio: z.number().positive(),
  collapsed: z.boolean(),
  hidden: z.boolean().optional(),
  cardOrder: z.array(z.string()).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const componentSchema = z.object({
  id: z.string().min(1),
  moduleId: z.string().min(1),
  workspaceId: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
  flowPosition: z.object({ x: z.number(), y: z.number() }).optional(),
  flowSize: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  bentoLayout: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }).optional(),
  dockPanel: z.string().optional(),
  laneId: z.string().optional(),
  hiddenIn: z.object({
    cards: z.boolean().optional(),
    dockview: z.boolean().optional(),
    flow: z.boolean().optional(),
    lane: z.boolean().optional(),
    bento: z.boolean().optional(),
  }).optional(),
  tags: z.array(z.string()).optional(),
  z: z.number().optional(),
  collapsed: z.boolean().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const createWorkspaceInputSchema = z.object({
  label: z.string().trim().min(1),
  icon: z.string().optional(),
})

export const renameWorkspaceInputSchema = z.object({
  label: z.string().trim().min(1),
})

export const workspaceSnapshotSchema = z.object({
  workspaces: z.array(workspaceSchema),
  lanes: z.array(laneSchema),
  components: z.array(componentSchema),
})

export const nodeRunEventSchema = z.object({
  type: z.enum(["progress", "log"]),
  progress: z.number().optional(),
  message: z.string(),
})

export const nodeRunResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
  stats: z.record(z.string(), z.number()).optional(),
  outputPath: z.string().optional(),
})

export const nodeRunRequestSchema = z.object({
  input: z.unknown().optional(),
  context: z.object({
    componentId: z.string().optional(),
    workspaceId: z.string().optional(),
  }).optional(),
})

export const nodeRunResponseSchema = z.object({
  result: nodeRunResultSchema,
  events: z.array(nodeRunEventSchema),
})

export const nodeOperationPhaseSchema = z.enum(["queued", "running", "completed", "error", "cancelled"])

export const nodeOperationSchema = z.object({
  operationId: z.string().min(1),
  nodeId: z.string().min(1),
  componentId: z.string().optional(),
  workspaceId: z.string().optional(),
  phase: nodeOperationPhaseSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().optional(),
  cancelledAt: z.number().int().nonnegative().optional(),
  finishedAt: z.number().int().nonnegative().optional(),
  eventCount: z.number().int().nonnegative(),
  result: nodeRunResultSchema.optional(),
})

export const nodeOperationEventSchema = z.object({
  index: z.number().int().nonnegative(),
  event: nodeRunEventSchema,
})

export const nodeOperationStartResponseSchema = z.object({
  operation: nodeOperationSchema,
})

export const nodeOperationEventsResponseSchema = z.object({
  operation: nodeOperationSchema,
  events: z.array(nodeOperationEventSchema),
  from: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  next: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative(),
})

export const nodeOperationCleanupResponseSchema = z.object({
  removedCount: z.number().int().nonnegative(),
  remainingCount: z.number().int().nonnegative(),
})

export const nodeOperationStreamMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("operation"),
    operation: nodeOperationSchema,
  }),
  z.object({
    type: z.literal("event"),
    index: z.number().int().nonnegative(),
    event: nodeRunEventSchema,
  }),
  z.object({
    type: z.literal("result"),
    operation: nodeOperationSchema,
    result: nodeRunResultSchema,
  }),
])

// ── Node run history ───────────────────────────────────────────────
// 每次节点运行结束后持久化一条快照，用于全局历史中心 / 节点内参数恢复。
export const nodeRunHistoryStatusSchema = z.enum([
  "success",
  "error",
  "cancelled",
])

export const nodeRunHistoryItemSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  componentId: z.string().optional(),
  workspaceId: z.string().optional(),
  input: z.unknown().optional(),
  inputSummary: z.string().optional(),
  status: nodeRunHistoryStatusSchema,
  message: z.string(),
  result: nodeRunResultSchema.optional(),
  eventCount: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
})

export const nodeRunHistoryQuerySchema = z.object({
  nodeId: z.string().optional(),
  componentId: z.string().optional(),
  workspaceId: z.string().optional(),
  status: nodeRunHistoryStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
})

export const nodeRunHistoryClearQuerySchema = z.object({
  nodeId: z.string().optional(),
  componentId: z.string().optional(),
  workspaceId: z.string().optional(),
  before: z.coerce.number().int().nonnegative().optional(),
})

export const nodeRunHistoryListSchema = z.object({
  items: z.array(nodeRunHistoryItemSchema),
  nextCursor: z.string().nullable().optional(),
})

export type WorkspaceDTO = z.infer<typeof workspaceSchema>
export type LaneDTO = z.infer<typeof laneSchema>
export type ComponentDTO = z.infer<typeof componentSchema>
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>
export type RenameWorkspaceInput = z.infer<typeof renameWorkspaceInputSchema>
export type WorkspaceSnapshotDTO = z.infer<typeof workspaceSnapshotSchema>
export type NodeRunEventDTO = z.infer<typeof nodeRunEventSchema>
export type NodeOperationPhaseDTO = z.infer<typeof nodeOperationPhaseSchema>
export interface NodeRunResultDTO<TData = unknown> {
  success: boolean
  message: string
  data?: TData
  stats?: Record<string, number>
  outputPath?: string
}
export interface NodeRunResponseDTO<TData = unknown> {
  result: NodeRunResultDTO<TData>
  events: NodeRunEventDTO[]
}
export interface NodeOperationDTO<TData = unknown> {
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
}
export interface NodeOperationEventDTO {
  index: number
  event: NodeRunEventDTO
}
export interface NodeOperationStartResponseDTO<TData = unknown> {
  operation: NodeOperationDTO<TData>
}
export interface NodeOperationEventsResponseDTO<TData = unknown> {
  operation: NodeOperationDTO<TData>
  events: NodeOperationEventDTO[]
  from: number
  limit: number
  next?: number
  total: number
}
export interface NodeOperationCleanupResponseDTO {
  removedCount: number
  remainingCount: number
}
export type NodeOperationStreamMessageDTO<TData = unknown> =
  | { type: "operation"; operation: NodeOperationDTO<TData> }
  | { type: "event"; index: number; event: NodeRunEventDTO }
  | { type: "result"; operation: NodeOperationDTO<TData>; result: NodeRunResultDTO<TData> }

export type NodeRunHistoryStatusDTO = z.infer<typeof nodeRunHistoryStatusSchema>
export type NodeRunHistoryItemDTO = z.infer<typeof nodeRunHistoryItemSchema>
export type NodeRunHistoryQueryDTO = z.infer<typeof nodeRunHistoryQuerySchema>
export type NodeRunHistoryClearQueryDTO = z.infer<typeof nodeRunHistoryClearQuerySchema>
export type NodeRunHistoryListDTO = z.infer<typeof nodeRunHistoryListSchema>
export interface NodeRunHistoryClearResultDTO {
  deletedCount: number
}
