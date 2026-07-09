import { AudioLines, Play, Route, ScanLine } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { PackuToolAction, PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export type AudiovAction = PackuToolAction

export interface AudiovActionMeta {
  value: AudiovAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: AudiovActionMeta[] = [
  {
    value: "status",
    label: "查看状态",
    shortLabel: "状态",
    description: "检查 ffmpeg 调用边界、配置候选和数据库标签。",
    icon: ScanLine,
    destructive: false,
  },
  {
    value: "plan",
    label: "生成计划",
    shortLabel: "计划",
    description: "生成 ffmpeg 音轨提取命令计划，不执行原工具。",
    icon: Route,
    destructive: false,
  },
  {
    value: "run",
    label: "提取音轨",
    shortLabel: "提取",
    description: "调用 PackU AudioV 的 ffmpeg 边界执行真实音轨提取。",
    icon: Play,
    destructive: true,
  },
]

export const NODE_META: PackuNodeMeta = {
  id: "audiov",
  title: "AudioV",
  description: "从视频中提取音轨，保留 PackU AudioV 的 ffmpeg 调用边界。",
  icon: AudioLines,
  spec: {
    id: "audiov",
    moduleName: "audiov.audiov_cli",
    sourceRoot: "D:/1VSCODE/Projects/PackU/VideoBrake/src",
    configFiles: ["audiov/config.json"],
    databaseLabel: "audio_extractions",
  } satisfies PackuToolSpec,
}
