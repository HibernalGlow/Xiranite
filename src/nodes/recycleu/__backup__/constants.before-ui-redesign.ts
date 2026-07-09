import type { LucideIcon } from "lucide-react"
import { Gauge, ShieldAlert, Trash2 } from "lucide-react"
import type { RecycleuAction } from "@xiranite/node-recycleu/core"
import type { RecycleuCardState, RecycleuStatusMeta } from "./types"

export const INTERVAL_PRESETS = [5, 10, 30, 60] as const

export const CONFIG_FIELDS = ["interval", "maxCycles", "driveLetter"] satisfies (keyof RecycleuCardState)[]

export const ACTIONS: Array<{
  value: RecycleuAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}> = [
  {
    value: "start",
    label: "自动清理",
    shortLabel: "自动",
    description: "按设定间隔和次数持续清空回收站。",
    icon: Gauge,
  },
  {
    value: "clean_now",
    label: "立即清理",
    shortLabel: "清理",
    description: "立刻清空一次回收站。",
    icon: Trash2,
  },
  {
    value: "status",
    label: "状态检查",
    shortLabel: "状态",
    description: "读取当前清理状态，不执行系统操作。",
    icon: ShieldAlert,
  },
]

export function statusFromState(data: RecycleuCardState, running: boolean): RecycleuStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      detail: data.progressText || "正在等待下一次清理。",
      tone: "running",
      badgeVariant: "default",
    }
  }
  if (data.phase === "error") {
    return {
      label: "失败",
      detail: data.progressText || "最近一次操作失败。",
      tone: "error",
      badgeVariant: "destructive",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      detail: data.progressText || "最近一次操作已完成。",
      tone: "success",
      badgeVariant: "secondary",
    }
  }
  return {
    label: "就绪",
    detail: data.progressText || "等待启动清理任务。",
    tone: "idle",
    badgeVariant: "outline",
  }
}
