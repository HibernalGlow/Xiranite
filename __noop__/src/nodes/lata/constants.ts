import { ListTodo, Play, RefreshCw } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { LataAction } from "@xiranite/node-lata/core"

export const LATA_ACTIONS: Array<{ value: LataAction; label: string; shortLabel: string; icon: LucideIcon }> = [
  { value: "list", label: "加载任务", shortLabel: "加载", icon: RefreshCw },
  { value: "plan", label: "预览命令", shortLabel: "预览", icon: ListTodo },
  { value: "execute", label: "执行任务", shortLabel: "执行", icon: Play },
]
