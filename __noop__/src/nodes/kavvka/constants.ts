import type { LucideIcon } from "lucide-react"
import { FileSearch, Image, Play, Search } from "lucide-react"
import type { KavvkaAction } from "@xiranite/node-kavvka/core"
import { DEFAULT_KAVVKA_KEYWORDS } from "@xiranite/node-kavvka/core"

export const DEFAULT_KEYWORDS_TEXT = DEFAULT_KAVVKA_KEYWORDS.join(", ")

export const DEFAULT_SCAN_DEPTH = 3

export const ACTIONS: Array<{
  value: KavvkaAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}> = [
  {
    value: "scan",
    label: "扫描关键词",
    shortLabel: "扫描",
    description: "扫描根目录下匹配关键词的文件夹，并把结果回填到源路径。",
    icon: Search,
  },
  {
    value: "plan",
    label: "预演计划",
    shortLabel: "预演",
    description: "在 dryRun 模式下生成 Czkawka 比较路径，不实际移动文件夹。",
    icon: FileSearch,
  },
  {
    value: "process",
    label: "执行处理",
    shortLabel: "处理",
    description: "按源路径查找画师文件夹，移动兄弟目录到 #compare 并生成路径。",
    icon: Play,
  },
]

export const NODE_ICON = Image
