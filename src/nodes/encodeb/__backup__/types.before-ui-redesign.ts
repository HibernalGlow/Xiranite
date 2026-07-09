import type { EncodebMapping, EncodebStrategy } from "@xiranite/node-encodeb/core"

export type EncodebPhase =
  | "idle"
  | "scanning"
  | "previewing"
  | "executing"
  | "completed"
  | "error"

export type EncodebPreset = "cn" | "jp" | "kr" | "custom"

export type EncodebAction = "find" | "preview" | "recover"

export interface EncodebCardState {
  pathText?: string
  preset?: EncodebPreset
  srcEncoding?: string
  dstEncoding?: string
  strategy?: EncodebStrategy
  phase?: EncodebPhase
  progress?: number
  progressText?: string
  logs?: string[]
  mappings?: EncodebMapping[]
  matches?: string[]
}

export interface EncodebStatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error" | "warning"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

export const CONFIG_FIELDS: Array<keyof EncodebCardState> = [
  "pathText",
  "preset",
  "srcEncoding",
  "dstEncoding",
  "strategy",
]
