import { Archive, Brush, FileText, FolderTree, Sparkles, Trash2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { CleanfPresetId } from "@xiranite/node-cleanf/core"

export interface CleanfPresetMeta {
  id: CleanfPresetId
  label: string
  description: string
  icon: LucideIcon
}

export const PRESET_METAS: CleanfPresetMeta[] = [
  {
    id: "empty_folders",
    label: "空文件夹",
    description: "递归删除所有空文件夹。",
    icon: FolderTree,
  },
  {
    id: "backup_files",
    label: "备份文件",
    description: "删除 .bak 备份文件。",
    icon: Archive,
  },
  {
    id: "temp_folders",
    label: "临时文件夹",
    description: "删除 temp_ 开头的文件夹。",
    icon: Trash2,
  },
  {
    id: "trash_files",
    label: "垃圾文件",
    description: "删除 .trash 文件和文件夹。",
    icon: Trash2,
  },
  {
    id: "hb_txt_files",
    label: "[#hb] 文本",
    description: "删除 [#hb] 开头的 txt 文件。",
    icon: FileText,
  },
  {
    id: "log_files",
    label: "日志文件",
    description: "删除 .log 和轮转日志文件。",
    icon: FileText,
  },
  {
    id: "upscale",
    label: "Upscale 缓存",
    description: "删除 .upbak 文件。",
    icon: Sparkles,
  },
]

export const DEFAULT_SELECTED_PRESETS: CleanfPresetId[] = ["empty_folders", "backup_files"]

export const NODE_ICON = Brush
