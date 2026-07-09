import { Play, Route, ScanLine } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { PackuToolAction } from "@xiranite/packu-node-runtime/core"

export interface PackuActionMeta {
  value: PackuToolAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: PackuActionMeta[] = [
  {
    value: "status",
    label: "查看状态",
    shortLabel: "状态",
    description: "检查配置候选、数据库路径和将要调用的 Python 模块。",
    icon: ScanLine,
    destructive: false,
  },
  {
    value: "plan",
    label: "生成计划",
    shortLabel: "计划",
    description: "生成命令计划，不执行原工具。",
    icon: Route,
    destructive: false,
  },
  {
    value: "run",
    label: "执行运行",
    shortLabel: "运行",
    description: "调用原 PackU 模块，需要真实改动时再关闭预演。",
    icon: Play,
    destructive: true,
  },
]
