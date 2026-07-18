import { Archive, FileSearch, HelpCircle, Layers, Search } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { FindzAction, FindzOutputFormat } from "@xiranite/node-findz/core"

export interface FindzActionMeta {
  value: FindzAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}

export const ACTIONS: FindzActionMeta[] = [
  {
    value: "search",
    label: "普通搜索",
    shortLabel: "搜索",
    description: "扫描路径与压缩包成员，按 SQL 过滤器筛选匹配项。",
    icon: Search,
  },
  {
    value: "archives_only",
    label: "仅压缩包",
    shortLabel: "压缩包",
    description: "只列出路径下的压缩包文件，不展开内部成员。",
    icon: Archive,
  },
  {
    value: "nested",
    label: "嵌套归档",
    shortLabel: "嵌套",
    description: "找出包含嵌套归档的压缩包，便于二次解压。",
    icon: Layers,
  },
]

export const HELP_ACTION: FindzActionMeta = {
  value: "help",
  label: "过滤器帮助",
  shortLabel: "帮助",
  description: "输出 findz SQL 过滤器语法说明。",
  icon: HelpCircle,
}

export interface FindzOutputFormatMeta {
  value: FindzOutputFormat
  label: string
}

export const OUTPUT_FORMATS: FindzOutputFormatMeta[] = [
  { value: "text", label: "文本" },
  { value: "json", label: "JSON" },
  { value: "csv", label: "CSV" },
  { value: "efu", label: "EFU" },
]

export const DEFAULT_WHERE = "1"
export const DEFAULT_ARCHIVE_SEPARATOR = "//"
export const FILE_SEARCH_ICON = FileSearch
