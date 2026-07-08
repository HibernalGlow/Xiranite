import { FileText, ScanSearch, Zap } from "lucide-react"
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
    shortLabel: "中文",
    srcEncoding: "cp437",
    dstEncoding: "cp936",
    description: "cp437 -> cp936，修复中文乱码文件名。",
  },
  {
    value: "jp",
    label: "日文",
    shortLabel: "日文",
    srcEncoding: "cp437",
    dstEncoding: "cp932",
    description: "cp437 -> cp932，修复日文乱码文件名。",
  },
  {
    value: "kr",
    label: "韩文",
    shortLabel: "韩文",
    srcEncoding: "cp437",
    dstEncoding: "cp949",
    description: "cp437 -> cp949，修复韩文乱码文件名。",
  },
  {
    value: "custom",
    label: "自定义",
    shortLabel: "自定义",
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
    shortLabel: "重命名",
    description: "直接重命名原文件，不保留原始副本。",
  },
  {
    value: "copy",
    label: "复制副本",
    shortLabel: "复制",
    description: "保留原文件，输出转码后的副本到新路径。",
  },
]

export interface EncodebActionMeta {
  value: EncodebAction
  label: string
  icon: LucideIcon
}

export const ACTIONS: EncodebActionMeta[] = [
  { value: "find", label: "扫描乱码", icon: ScanSearch },
  { value: "preview", label: "预览转换", icon: FileText },
  { value: "recover", label: "执行修复", icon: Zap },
]
