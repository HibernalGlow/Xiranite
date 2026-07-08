import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "transq",
  moduleName: "transq",
  sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
  configFiles: ["transq.toml"],
  databaseLabel: "translation_queue",
} satisfies PackuToolSpec

export function runTransq(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
