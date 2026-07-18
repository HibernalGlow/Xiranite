import { GalleryThumbnails, Images, PackageSearch } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { CoveruAction } from "@xiranite/node-coveru/core"

export interface CoveruActionMeta {
  value: CoveruAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}

export const ACTIONS: CoveruActionMeta[] = [
  {
    value: "scan",
    label: "扫描封面",
    shortLabel: "扫描",
    description: "读取路径并找出可作为封面的候选，不写入文件。",
    icon: PackageSearch,
  },
  {
    value: "plan",
    label: "生成计划",
    shortLabel: "计划",
    description: "计算输出位置、冲突和不支持的归档。",
    icon: GalleryThumbnails,
  },
  {
    value: "extract",
    label: "提取封面",
    shortLabel: "提取",
    description: "按计划写出封面文件，默认仍以预览模式运行。",
    icon: Images,
  },
]

export const NODE_ICON = Images
export const DEFAULT_PREFERRED_NAMES_TEXT = "cover, folder, front, 000, 001"
