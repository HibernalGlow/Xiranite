import type { LucideIcon } from "lucide-react"
import { FolderTree, Play, Search } from "lucide-react"
import type { SeriexAction } from "@xiranite/node-seriex/core"

export const DEFAULT_CONFIG_TEXT = `formats = [".mp4", ".nov", ".zip", ".rar", ".7z", ".cbz", ".cbr"]
archive_formats = [".zip", ".rar", ".7z", ".cbz", ".cbr"]
prefix = "[#s]"
add_prefix = true
check_integrity = false
known_series_dirs = []
known_series_allow_single = true
`.trim()

export const ACTIONS: Array<{
  value: SeriexAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  group: "plan" | "execute"
  destructive?: boolean
}> = [
  {
    value: "plan",
    label: "预览计划",
    shortLabel: "预览",
    description: "扫描目录并生成系列归档分组计划，不移动任何文件。",
    icon: Search,
    group: "plan",
  },
  {
    value: "execute",
    label: "执行移动",
    shortLabel: "执行",
    description: "按计划将文件移动到对应系列文件夹，会修改文件系统。",
    icon: Play,
    group: "execute",
    destructive: true,
  },
  {
    value: "apply",
    label: "应用计划",
    shortLabel: "应用",
    description: "重新生成计划并立即应用，等价于执行移动。",
    icon: FolderTree,
    group: "execute",
    destructive: true,
  },
]

export const PRIMARY_ACTION: SeriexAction = "plan"

export const NODE_ICON = FolderTree
