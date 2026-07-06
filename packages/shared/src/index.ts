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
  dockPanel: z.string().optional(),
  laneId: z.string().optional(),
  hiddenIn: z.object({
    cards: z.boolean().optional(),
    dockview: z.boolean().optional(),
    flow: z.boolean().optional(),
    lane: z.boolean().optional(),
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

export type WorkspaceDTO = z.infer<typeof workspaceSchema>
export type LaneDTO = z.infer<typeof laneSchema>
export type ComponentDTO = z.infer<typeof componentSchema>
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>
export type RenameWorkspaceInput = z.infer<typeof renameWorkspaceInputSchema>
export type WorkspaceSnapshotDTO = z.infer<typeof workspaceSnapshotSchema>
