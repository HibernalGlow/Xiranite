import { Archive, FolderOpen, ScanLine, Settings2, SquareTerminal } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { SmartZipAction } from "@xiranite/node-smartzip/core"

export interface SmartZipActionMeta {
  value: SmartZipAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: SmartZipActionMeta[] = [
  {
    value: "status",
    label: "查看状态",
    shortLabel: "状态",
    description: "加载 SmartZip 配置，列出归档扩展名和密码。",
    icon: ScanLine,
    destructive: false,
  },
  {
    value: "extract",
    label: "解压归档",
    shortLabel: "解压",
    description: "调用 SmartZip 解压选中的归档文件。",
    icon: SquareTerminal,
    destructive: true,
  },
  {
    value: "extract_codepage",
    label: "代码页解压",
    shortLabel: "代码页",
    description: "用指定代码页解压归档，处理非 ASCII 文件名。",
    icon: SquareTerminal,
    destructive: true,
  },
  {
    value: "open",
    label: "打开归档",
    shortLabel: "打开",
    description: "在 SmartZip GUI 中打开归档文件。",
    icon: FolderOpen,
    destructive: false,
  },
  {
    value: "archive",
    label: "创建归档",
    shortLabel: "打包",
    description: "把选中路径打包成归档文件。",
    icon: Archive,
    destructive: true,
  },
  {
    value: "settings",
    label: "打开设置",
    shortLabel: "设置",
    description: "打开 SmartZip 设置窗口。",
    icon: Settings2,
    destructive: false,
  },
]

export const DESTRUCTIVE_ACTIONS: SmartZipAction[] = ["extract", "extract_codepage", "archive"]

export function isDestructiveAction(action: SmartZipAction): boolean {
  return DESTRUCTIVE_ACTIONS.includes(action)
}

export function actionI18nKey(action: SmartZipAction): string {
  return action.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
