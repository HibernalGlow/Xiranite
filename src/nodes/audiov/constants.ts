import { AudioLines } from "lucide-react"
import type { PackuToolSpec } from "@xiranite/packu-node-runtime/core"
import type { PackuNodeMeta } from "@/nodes/shared/packu/types"

export const NODE_META: PackuNodeMeta = {
  id: "audiov",
  title: "AudioV",
  description: "从视频中提取音轨，保留 PackU AudioV 的 ffmpeg 调用边界。",
  icon: AudioLines,
  spec: {
    id: "audiov",
    moduleName: "audiov.audiov_cli",
    sourceRoot: "D:/1VSCODE/Projects/PackU/VideoBrake/src",
    configFiles: ["audiov/config.json"],
    databaseLabel: "audio_extractions",
  } satisfies PackuToolSpec,
}

export { ACTIONS } from "@/nodes/shared/packu/constants"
