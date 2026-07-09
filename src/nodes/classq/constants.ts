import { FolderTree } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

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

export { ACTIONS } from "@/nodes/shared/packu/constants"
