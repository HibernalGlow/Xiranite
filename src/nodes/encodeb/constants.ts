import { FileText, ScanSearch, ShieldAlert } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { EncodebAction, EncodebPreset, EncodebStrategy } from "./types"

export interface EncodebPresetMeta {
  value: EncodebPreset
  label: string
  shortLabel: string
  srcEncoding?: string
  dstEncoding?: string
  description: string
}

export const PRESETS: EncodebPresetMeta[] = [
  {
    value: "cn",
    label: "中文",
    shortLabel: "CN",
    srcEncoding: "cp437",
    dstEncoding: "cp936",
    description: "ZIP 常见 cp437 字节按 GBK/CP936 还原。",
  },
  {
    value: "jp",
    label: "日文",
    shortLabel: "JP",
    srcEncoding: "cp437",
    dstEncoding: "cp932",
    description: "ZIP 常见 cp437 字节按 Shift-JIS/CP932 还原。",
  },
  {
    value: "kr",
    label: "韩文",
    shortLabel: "KR",
    srcEncoding: "cp437",
    dstEncoding: "cp949",
    description: "ZIP 常见 cp437 字节按 EUC-KR/CP949 还原。",
  },
  {
    value: "custom",
    label: "自定义",
    shortLabel: "Custom",
    description: "手动指定源编码和目标编码。",
  },
]

export interface EncodebStrategyMeta {
  value: EncodebStrategy
  label: string
  shortLabel: string
  description: string
}

export const STRATEGIES: EncodebStrategyMeta[] = [
  {
    value: "replace",
    label: "原地重命名",
    shortLabel: "Replace",
    description: "直接改名原文件或目录，适合确认预览无误后执行。",
  },
  {
    value: "copy",
    label: "复制副本",
    shortLabel: "Copy",
    description: "保留原文件，输出转码后的副本。",
  },
]

export interface EncodebActionMeta {
  value: EncodebAction
  label: string
  icon: LucideIcon
}

export const ACTIONS: EncodebActionMeta[] = [
  { value: "find", label: "扫描乱码", icon: ScanSearch },
  { value: "preview", label: "预览映射", icon: FileText },
  { value: "recover", label: "执行修复", icon: ShieldAlert },
]
