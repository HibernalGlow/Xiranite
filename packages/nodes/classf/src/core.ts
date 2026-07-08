import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "classf",
  moduleName: "classf",
  sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
  defaultArgs: ["run"],
  configFiles: ["classf.toml"],
  databaseLabel: "classification_runs",
} satisfies PackuToolSpec

export function runClassf(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
