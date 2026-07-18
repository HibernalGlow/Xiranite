import { FolderSearch, ListChecks, MoveRight } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { SimiuAction, SimiuApplyMode, SimiuScanOrder } from "@xiranite/node-simiu/core"

export interface SimiuActionMeta {
  value: SimiuAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: SimiuActionMeta[] = [
  {
    value: "scan",
    label: "扫描图片",
    shortLabel: "扫描",
    description: "扫描图片根目录和批次，不生成移动计划。",
    icon: FolderSearch,
    destructive: false,
  },
  {
    value: "plan",
    label: "生成分组",
    shortLabel: "计划",
    description: "按大小和签名生成分组及文件操作计划。",
    icon: ListChecks,
    destructive: false,
  },
  {
    value: "apply",
    label: "应用分组",
    shortLabel: "应用",
    description: "执行移动、复制或链接操作，修改文件系统。",
    icon: MoveRight,
    destructive: true,
  },
]

export const APPLY_MODE_OPTIONS: Array<{ value: SimiuApplyMode; label: string }> = [
  { value: "move", label: "移动" },
  { value: "copy", label: "复制" },
  { value: "link", label: "链接" },
]

export const SCAN_ORDER_OPTIONS: Array<{ value: SimiuScanOrder; label: string }> = [
  { value: "path", label: "路径" },
  { value: "smallest-first", label: "小批次优先" },
  { value: "deepest-first", label: "深层优先" },
]
