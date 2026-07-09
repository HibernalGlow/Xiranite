import { Clock3 } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export const NODE_META: PackuNodeMeta = {
  id: "timeu",
  title: "TimeU",
  description: "备份或恢复文件时间戳，适合归档整理前后的时间记录。",
  icon: Clock3,
  spec: {
    id: "timeu",
    moduleName: "timeu",
    sourceRoot: "D:/1VSCODE/Projects/PackU/NameU/src",
    configFiles: ["timeu/timestamp_backups"],
    databaseLabel: "timestamps",
  } satisfies PackuToolSpec,
}

export { ACTIONS } from "@/nodes/shared/packu/constants"
