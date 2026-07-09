import { CalendarClock } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export const NODE_META: PackuNodeMeta = {
  id: "synct",
  title: "Synct",
  description: "按提取时间戳归档文件或目录，适合时间线整理。",
  icon: CalendarClock,
  spec: {
    id: "synct",
    moduleName: "synct",
    sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
    configFiles: ["synct/patterns.toml"],
    databaseLabel: "timestamp_archives",
  } satisfies PackuToolSpec,
}

export { ACTIONS } from "@/nodes/shared/packu/constants"
