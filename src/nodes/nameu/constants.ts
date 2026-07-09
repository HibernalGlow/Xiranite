import { FilePenLine } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export const NODE_META: PackuNodeMeta = {
  id: "nameu",
  title: "NameU",
  description: "按 PackU NameU 规则重命名画师归档目录，并记录运行结果。",
  icon: FilePenLine,
  spec: {
    id: "nameu",
    moduleName: "nameu",
    sourceRoot: "D:/1VSCODE/Projects/PackU/NameU/src",
    configFiles: ["nameu/nameu.toml"],
    databaseLabel: "archive_id",
  } satisfies PackuToolSpec,
}

export { ACTIONS } from "@/nodes/shared/packu/constants"
