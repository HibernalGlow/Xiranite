import type { ClassfAction, ClassfClassifyMode, ClassfData, ClassfExistingPolicy, ClassfPlacementMode, ClassfStage, ClassfTransferMode } from "@xiranite/node-classf/core"
import type { NodePanelLayouts } from "@/nodes/shared/nodePanelLayouts"

export type ClassfPhase = "idle" | "running" | "completed" | "error"

export interface ClassfCardState {
  action?: ClassfAction
  pathsText?: string
  crashuSourcesText?: string
  targetDir?: string
  transferMode?: ClassfTransferMode
  classifyMode?: ClassfClassifyMode
  placementMode?: ClassfPlacementMode
  existingPolicy?: ClassfExistingPolicy
  dryRun?: boolean
  phase?: ClassfPhase
  progress?: number
  progressText?: string
  logs?: string[]
  result?: ClassfData | null
  planFingerprint?: string
  runningItem?: { sourcePath: string; stage: ClassfStage } | null
  panelResizeEnabled?: boolean
  panelLayouts?: NodePanelLayouts
}

export interface ClassfStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS = [
  "pathsText",
  "crashuSourcesText",
  "targetDir",
  "transferMode",
  "classifyMode",
  "placementMode",
  "existingPolicy",
  "dryRun",
] as const satisfies Array<keyof ClassfCardState>
