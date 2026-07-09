import { FolderTree, Play, Route, ScanLine } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { PackuToolAction, PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export type ClassqAction = PackuToolAction

export interface ClassqActionMeta {
  value: ClassqAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: ClassqActionMeta[] = [
  {
    value: "status",
    label: "查看状态",
    shortLabel: "状态",
    description: "检查配置候选、数据库路径和将要调用的 Python 模块。",
    icon: ScanLine,
    destructive: false,
  },
  {
    value: "plan",
    label: "生成计划",
    shortLabel: "计划",
    description: "生成关键词分类计划，不执行原工具。",
    icon: Route,
    destructive: false,
  },
  {
    value: "run",
    label: "执行分类",
    shortLabel: "分类",
    description: "调用 ClassQ 模块按关键词分类文件夹，需要真实改动时再关闭预演。",
    icon: Play,
    destructive: true,
  },
]

export const NODE_META: PackuNodeMeta = {
  id: "classq",
  title: "ClassQ",
  description: "按关键词快速分类文件夹，适合轻量整理和预分组。",
  icon: FolderTree,
  spec: {
    id: "classq",
    moduleName: "classq",
    sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
    defaultArgs: ["classify"],
    configFiles: ["classq.toml"],
    databaseLabel: "quick_classification_runs",
  } satisfies PackuToolSpec,
}
