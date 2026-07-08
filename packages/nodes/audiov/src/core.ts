import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "audiov",
  moduleName: "audiov.audiov_cli",
  sourceRoot: "D:/1VSCODE/Projects/PackU/VideoBrake/src",
  configFiles: ["audiov/config.json"],
  databaseLabel: "audio_extractions",
} satisfies PackuToolSpec

export function runAudiov(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
