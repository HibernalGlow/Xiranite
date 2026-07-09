import { Languages } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

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

export { ACTIONS } from "@/nodes/shared/packu/constants"
