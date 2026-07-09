import { ListOrdered } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export const NODE_META: PackuNodeMeta = {
  id: "snf",
  title: "SNF",
  description: "修复编号目录顺序，让序列型资源保持连续和可追踪。",
  icon: ListOrdered,
  spec: {
    id: "snf",
    moduleName: "snf",
    sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
    configFiles: ["snf.toml"],
    databaseLabel: "sequence_repairs",
  } satisfies PackuToolSpec,
}

export { ACTIONS } from "@/nodes/shared/packu/constants"
