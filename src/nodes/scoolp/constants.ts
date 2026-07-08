import type { LucideIcon } from "lucide-react"
import { Boxes, DatabaseBackup, FolderSync, ListChecks, Package, PackageSearch, Play, RefreshCw, Search, Trash2 } from "lucide-react"
import type { ScoolpAction } from "@xiranite/node-scoolp/core"
import { DEFAULT_SCOOLP_SYNC_TOML } from "@xiranite/node-scoolp/core"

export const DEFAULT_CONFIG_TEXT = DEFAULT_SCOOLP_SYNC_TOML.trim()

export const ACTIONS: Array<{
  value: ScoolpAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  group: "status" | "sync" | "cache"
  destructive?: boolean
}> = [
  {
    value: "status",
    label: "查看状态",
    shortLabel: "状态",
    description: "检查 scoop 是否安装，列出已装包和 bucket。",
    icon: Search,
    group: "status",
  },
  {
    value: "list_packages",
    label: "列出仓库包",
    shortLabel: "列包",
    description: "读取 bucket 路径下的所有包清单。",
    icon: ListChecks,
    group: "status",
  },
  {
    value: "sync",
    label: "同步 Bucket",
    shortLabel: "同步",
    description: "按 TOML 配置重置并添加 bucket，可选执行 scoop update。",
    icon: FolderSync,
    group: "sync",
    destructive: true,
  },
  {
    value: "cache_list",
    label: "扫描缓存",
    shortLabel: "扫描",
    description: "扫描缓存目录中的过时安装包。",
    icon: PackageSearch,
    group: "cache",
  },
  {
    value: "cache_backup",
    label: "备份缓存",
    shortLabel: "备份",
    description: "把过时缓存移动到备份目录，不删除原文件。",
    icon: DatabaseBackup,
    group: "cache",
    destructive: true,
  },
  {
    value: "cache_delete",
    label: "清理缓存",
    shortLabel: "清理",
    description: "永久删除过时缓存文件，释放磁盘空间。",
    icon: Trash2,
    group: "cache",
    destructive: true,
  },
]

export const PRIMARY_ACTION: ScoolpAction = "status"

export const NODE_ICON = Package

export const SECONDARY_ICONS = {
  install: Boxes,
  sync: RefreshCw,
  play: Play,
} as const
