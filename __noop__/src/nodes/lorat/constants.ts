import { Database, Download, RefreshCw, Tags, XCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { LoratAction, LoratScopeFilter, LoratStatusFilter } from "@xiranite/node-lorat/core"

export interface LoratActionMeta {
  value: LoratAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: LoratActionMeta[] = [
  {
    value: "scan",
    label: "扫描模型",
    shortLabel: "扫描",
    description: "扫描目录内的 LoRA 模型文件并推断触发词，不写入任何 sidecar。",
    icon: RefreshCw,
    destructive: false,
  },
  {
    value: "apply_db",
    label: "应用 TriggerDB",
    shortLabel: "应用",
    description: "用 TriggerDB JSON 覆盖当前行的触发词，纯本地操作不写入文件。",
    icon: Database,
    destructive: false,
  },
  {
    value: "write_triggers",
    label: "写入触发词",
    shortLabel: "写入",
    description: "把选中行的触发词写入 sidecar 文件，已存在的 sidecar 会被覆盖。",
    icon: Tags,
    destructive: true,
  },
  {
    value: "mark_no_trigger",
    label: "标记无触发词",
    shortLabel: "无触发",
    description: "为选中行写入 no-trigger sidecar，标记该 LoRA 没有触发词。",
    icon: XCircle,
    destructive: true,
  },
  {
    value: "export_db",
    label: "导出 TriggerDB",
    shortLabel: "导出",
    description: "收集当前所有触发词生成 TriggerDB JSON 并复制到剪贴板，不写入文件。",
    icon: Download,
    destructive: false,
  },
]

export const STATUS_FILTERS: Array<{ value: LoratStatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "missing", label: "缺失" },
  { value: "trigger", label: "已有" },
  { value: "notrigger", label: "无触发" },
]

export const SCOPE_FILTERS: Array<{ value: LoratScopeFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "self", label: "self" },
  { value: "at", label: "@" },
]
