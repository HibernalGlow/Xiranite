import type { OwithuAction, OwithuData, RegistryHive } from "@xiranite/node-owithu/core"

export type OwithuPhase = "idle" | "running" | "completed" | "error"

export interface OwithuCardState {
  action?: OwithuAction
  path?: string
  configText?: string
  hive?: RegistryHive | ""
  onlyKey?: string
  result?: OwithuData | null
  logs?: string[]
  phase?: OwithuPhase
  progress?: number
  progressText?: string
}

export interface OwithuStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof OwithuCardState> = [
  "action",
  "path",
  "configText",
  "hive",
  "onlyKey",
]
