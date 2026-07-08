import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "bitv",
  moduleName: "bitv",
  sourceRoot: "D:/1VSCODE/Projects/PackU/VideoBrake/src",
  configFiles: ["bitv/taskfile.yaml"],
  databaseLabel: "video_bitrate_reports",
} satisfies PackuToolSpec

export function runBitv(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
