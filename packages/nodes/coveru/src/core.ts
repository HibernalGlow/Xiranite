import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "coveru",
  moduleName: "coveru",
  sourceRoot: "D:/1VSCODE/Projects/PackU/NameU/src",
  configFiles: ["coveru/config.toml"],
  databaseLabel: "cover_jobs",
} satisfies PackuToolSpec

export function runCoveru(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
