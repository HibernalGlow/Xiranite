import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "snf",
  moduleName: "snf",
  sourceRoot: "D:/1VSCODE/Projects/PackU/OrganizeFolder/src",
  configFiles: ["snf.toml"],
  databaseLabel: "sequence_repairs",
} satisfies PackuToolSpec

export function runSnf(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
