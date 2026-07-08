import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "classq",
  moduleName: "classq",
  sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
  defaultArgs: ["classify"],
  configFiles: ["classq.toml"],
  databaseLabel: "quick_classification_runs",
} satisfies PackuToolSpec

export function runClassq(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
