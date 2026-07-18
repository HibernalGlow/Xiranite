import { FileSearch, FileText, HardDriveDownload } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { EnvuConfigAction } from "@xiranite/node-envuconfig/core"
import { DEFAULT_ENVU_INCLUDE } from "@xiranite/node-envuconfig/core"

export interface EnvuConfigActionMeta {
  value: EnvuConfigAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: EnvuConfigActionMeta[] = [
  {
    value: "scan",
    label: "扫描配置",
    shortLabel: "扫描",
    description: "列出 EnvU 根目录下的配置、dotfile 和 toml 文件。",
    icon: FileSearch,
    destructive: false,
  },
  {
    value: "manifest",
    label: "生成清单",
    shortLabel: "清单",
    description: "扫描并生成备份清单，规划每个文件的目标路径。",
    icon: FileText,
    destructive: false,
  },
  {
    value: "backup",
    label: "执行备份",
    shortLabel: "备份",
    description: "复制 EnvU 配置文件到备份目录，会写入磁盘。",
    icon: HardDriveDownload,
    destructive: true,
  },
]

export const DEFAULT_INCLUDE_TEXT = DEFAULT_ENVU_INCLUDE.join("\n")
