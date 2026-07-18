import { Activity, FileCog, Globe, Play } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { JellyPotAction } from "@xiranite/node-jellypot/core"

export interface JellyPotActionMeta {
  value: JellyPotAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: JellyPotActionMeta[] = [
  {
    value: "status",
    label: "检查状态",
    shortLabel: "状态",
    description: "检查 PotPlayer、浏览器和注册表路径是否存在。",
    icon: Activity,
    destructive: false,
  },
  {
    value: "launch_media",
    label: "播放媒体",
    shortLabel: "播放",
    description: "把媒体路径交给 PotPlayer 打开。",
    icon: Play,
    destructive: false,
  },
  {
    value: "open_jellyfin",
    label: "打开 Jellyfin",
    shortLabel: "Jellyfin",
    description: "用浏览器打开 Jellyfin Web 首页。",
    icon: Globe,
    destructive: false,
  },
  {
    value: "apply_registry",
    label: "导入注册表",
    shortLabel: "注册表",
    description: "应用 PotPlayer 注册表配置，会修改系统注册表。",
    icon: FileCog,
    destructive: true,
  },
]
