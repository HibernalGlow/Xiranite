import { FilePenLine, Play, Route, ScanLine } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { PackuToolAction, PackuToolSpec } from "@xiranite/packu-node-runtime/core"

export type NameuAction = PackuToolAction

export interface NameuActionMeta {
  value: NameuAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: NameuActionMeta[] = [
  {
    value: "status",
    label: "查看配置",
    shortLabel: "配置",
    description: "检查 nameu.toml 配置文件、模块路径和数据库标签。",
    icon: ScanLine,
    destructive: false,
  },
  {
    value: "plan",
    label: "预览重命名",
    shortLabel: "预览",
    description: "生成重命名计划，不执行实际重命名。",
    icon: Route,
    destructive: false,
  },
  {
    value: "run",
    label: "执行重命名",
    shortLabel: "重命名",
    description: "调用 NameU 模块执行真实重命名，需要关闭预演。",
    icon: Play,
    destructive: true,
  },
]

export const NODE_META = {
  id: "nameu",
  title: "NameU",
  description: "按 NameU 规则重命名画师归档目录，并记录运行结果。",
  icon: FilePenLine,
  spec: {
    id: "nameu",
    moduleName: "nameu",
    sourceRoot: "D:/1VSCODE/Projects/PackU/NameU/src",
    configFiles: ["nameu/nameu.toml"],
    databaseLabel: "archive_id",
  } satisfies PackuToolSpec,
}
