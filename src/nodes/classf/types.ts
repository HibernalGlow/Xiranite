import type { ClassfAction, ClassfClassifyMode, ClassfData, ClassfExistingPolicy, ClassfTransferMode } from "@xiranite/node-classf/core"

export type ClassfPhase = "idle" | "running" | "completed" | "error"

export interface ClassfCardState {
  action?: ClassfAction
  pathsText?: string
  targetDir?: string
  transferMode?: ClassfTransferMode
  classifyMode?: ClassfClassifyMode
  existingPolicy?: ClassfExistingPolicy
  dryRun?: boolean
  phase?: ClassfPhase
  progress?: number
  progressText?: string
  logs?: string[]
  result?: ClassfData | null
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
  "targetDir",
  "transferMode",
  "classifyMode",
  "existingPolicy",
  "dryRun",
] as const satisfies Array<keyof ClassfCardState>
