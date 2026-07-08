import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "synct",
  moduleName: "synct",
  sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
  configFiles: ["synct/patterns.toml"],
  databaseLabel: "timestamp_archives",
} satisfies PackuToolSpec

export function runSynct(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
