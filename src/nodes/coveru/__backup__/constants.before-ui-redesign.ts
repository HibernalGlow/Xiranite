import { Image } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export const NODE_META: PackuNodeMeta = {
  id: "coveru",
  title: "CoverU",
  description: "从归档中提取封面并按 CoverU 配置转换输出。",
  icon: Image,
  spec: {
    id: "coveru",
    moduleName: "coveru",
    sourceRoot: "D:/1VSCODE/Projects/PackU/NameU/src",
    configFiles: ["coveru/config.toml"],
    databaseLabel: "cover_jobs",
  } satisfies PackuToolSpec,
}

export { ACTIONS } from "@/nodes/shared/packu/constants"
