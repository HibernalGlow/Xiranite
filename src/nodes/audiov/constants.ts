import { AudioLines, Play, Route, ScanLine } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { AudiovAction } from "@xiranite/node-audiov/core"

export type { AudiovAction }

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
    label: "检查 ffmpeg",
    shortLabel: "状态",
    description: "检查本机 ffmpeg 是否可用。",
    icon: ScanLine,
    destructive: false,
  },
  {
    value: "plan",
    label: "生成计划",
    shortLabel: "计划",
    description: "生成固定 AAC / M4A 音轨提取计划，不写入文件。",
    icon: Route,
    destructive: false,
  },
  {
    value: "run",
    label: "提取音轨",
    shortLabel: "提取",
    description: "使用内置 AAC / M4A 配置提取每个视频的第一条音轨。",
    icon: Play,
    destructive: true,
  },
]

export const NODE_META = {
  id: "audiov",
  title: "AudioV",
  description: "从视频文件中提取音轨，使用内置 ffmpeg 配置。",
  icon: AudioLines,
} as const
