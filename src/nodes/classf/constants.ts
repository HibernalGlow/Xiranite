import { Workflow } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export const NODE_META: PackuNodeMeta = {
  id: "classf",
  title: "ClassF",
  description: "编排 PackU 分类流程，集中调用相关整理核心。",
  icon: Workflow,
  spec: {
    id: "classf",
    moduleName: "classf",
    sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
    defaultArgs: ["run"],
    configFiles: ["classf.toml"],
    databaseLabel: "classification_runs",
  } satisfies PackuToolSpec,
}

export { ACTIONS } from "@/nodes/shared/packu/constants"
