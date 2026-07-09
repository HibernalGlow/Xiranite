import { FolderInput, MoveRight, Search } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { MoveaAction } from "./types"

export interface MoveaActionMeta {
  value: MoveaAction
  label: string
  shortLabel: string
  icon: LucideIcon
  description: string
}

export const ACTIONS: MoveaActionMeta[] = [
  {
    value: "scan",
    label: "扫描目录",
    shortLabel: "扫描",
    icon: Search,
    description: "扫描根目录下的一级文件夹，归档压缩包和可移动文件夹。",
  },
  {
    value: "match",
    label: "匹配目标",
    shortLabel: "匹配",
    icon: FolderInput,
    description: "根据归档名和正则模式匹配目标子文件夹。",
  },
  {
    value: "move_single",
    label: "执行移动",
    shortLabel: "移动",
    icon: MoveRight,
    description: "按移动计划把归档或文件夹移动到目标子文件夹。",
  },
]

export const MOVEA_NODE_LABEL = "Movea"
