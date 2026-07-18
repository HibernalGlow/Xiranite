import type { SimiuAction, SimiuApplyMode, SimiuData, SimiuScanOrder } from "@xiranite/node-simiu/core"

export type SimiuPhase = "idle" | "running" | "completed" | "error"

export interface SimiuCardState {
  action?: SimiuAction
  rootsText?: string
  configPath?: string
  databasePath?: string
  mode?: SimiuApplyMode
  scanOrder?: SimiuScanOrder
  namePrefix?: string
  minGroupSize?: string
  sizeToleranceBytes?: string
  dryRun?: boolean
  recordRun?: boolean
  result?: SimiuData | null
  logs?: string[]
  phase?: SimiuPhase
  progress?: number
  progressText?: string
}

export interface SimiuStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof SimiuCardState> = [
  "rootsText",
  "configPath",
  "databasePath",
  "mode",
  "scanOrder",
  "namePrefix",
  "minGroupSize",
  "sizeToleranceBytes",
  "dryRun",
  "recordRun",
]
