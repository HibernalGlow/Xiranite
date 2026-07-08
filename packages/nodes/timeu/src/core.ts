import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "timeu",
  moduleName: "timeu",
  sourceRoot: "D:/1VSCODE/Projects/PackU/NameU/src",
  configFiles: ["timeu/timestamp_backups"],
  databaseLabel: "timestamps",
} satisfies PackuToolSpec

export function runTimeu(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
