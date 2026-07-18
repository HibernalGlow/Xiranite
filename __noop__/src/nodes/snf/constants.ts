import { FolderTree, ListChecks, ListOrdered, Play, ScanLine } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { SnfAction } from "@xiranite/node-snf/core"

export interface SnfActionMeta {
  value: SnfAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: SnfActionMeta[] = [
  { value: "scan", label: "扫描序号", shortLabel: "扫描", description: "读取编号目录并检查是否连续。", icon: ScanLine, destructive: false },
  { value: "plan", label: "预览修复", shortLabel: "预览", description: "生成编号修复计划，不改动目录。", icon: ListChecks, destructive: false },
  { value: "rename", label: "执行修复", shortLabel: "修复", description: "按计划重命名编号目录，需要确认。", icon: Play, destructive: true },
]

export const MODES = [
  { value: "library", label: "库目录", icon: FolderTree },
  { value: "artist", label: "作者目录", icon: ListOrdered },
] as const

export const NODE_ICON = ListOrdered
