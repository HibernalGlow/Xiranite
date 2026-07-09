import { Languages, Play, Route, ScanLine } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { PackuToolAction, PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export type TransqAction = PackuToolAction

export interface TransqActionMeta {
  value: TransqAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: TransqActionMeta[] = [
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
    description: "生成命令计划，不执行原工具。",
    icon: Route,
    destructive: false,
  },
  {
    value: "run",
    label: "整理队列",
    shortLabel: "整理",
    description: "调用 TransQ 模块整理翻译队列，需要真实改动时再关闭预演。",
    icon: Play,
    destructive: true,
  },
]

export const NODE_META: PackuNodeMeta = {
  id: "transq",
  title: "TransQ",
  description: "整理翻译结果文件，维护翻译队列和输出位置。",
  icon: Languages,
  spec: {
    id: "transq",
    moduleName: "transq",
    sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
    configFiles: ["transq.toml"],
    databaseLabel: "translation_queue",
  } satisfies PackuToolSpec,
}
