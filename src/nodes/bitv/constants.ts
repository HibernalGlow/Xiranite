import { Gauge } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export const NODE_META: PackuNodeMeta = {
  id: "bitv",
  title: "BitV",
  description: "分析视频码率并输出分类报告，作为视频整理前的检查节点。",
  icon: Gauge,
  spec: {
    id: "bitv",
    moduleName: "bitv",
    sourceRoot: "D:/1VSCODE/Projects/PackU/VideoBrake/src",
    configFiles: ["bitv/taskfile.yaml"],
    databaseLabel: "video_bitrate_reports",
  } satisfies PackuToolSpec,
}

export { ACTIONS } from "@/nodes/shared/packu/constants"
