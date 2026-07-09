import { Gauge, Play, Route, ScanLine } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { PackuToolAction, PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export type BitvAction = PackuToolAction

export interface BitvActionMeta {
  value: BitvAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: BitvActionMeta[] = [
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
    label: "分析码率",
    shortLabel: "分析",
    description: "调用 BitV 模块执行码率分析，输出视频分类报告。",
    icon: Play,
    destructive: true,
  },
]

export const NODE_META: PackuNodeMeta = {
  id: "bitv",
  title: "BitV",
  description: "分析视频码率并输出分类报告，作为视频整理前的检查节点。",
  icon: Gauge,
  spec: {
    id: "bitv",
    moduleName: "bitv",
    sourceRoot: "D:/1VSCODE/Projects/PackU/VideoBrake/src",
    configFiles: ["bitv/taskfile.yaml"],
    databaseLabel: "video_bitrate_reports",
  } satisfies PackuToolSpec,
}
