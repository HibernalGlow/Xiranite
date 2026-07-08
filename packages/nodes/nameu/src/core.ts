import type { NodeRunEvent } from "@xiranite/contract"
import { runPackuTool } from "@xiranite/packu-node-runtime"
import type { PackuToolInput, PackuToolRuntime, PackuToolSpec } from "@xiranite/packu-node-runtime"

export const toolSpec = {
  id: "nameu",
  moduleName: "nameu",
  sourceRoot: "D:/1VSCODE/Projects/PackU/NameU/src",
  configFiles: ["nameu/nameu.toml"],
  databaseLabel: "archive_id",
} satisfies PackuToolSpec

export function runNameu(input: PackuToolInput, runtime: PackuToolRuntime, onEvent?: (event: NodeRunEvent) => void) {
  return runPackuTool(toolSpec, input, runtime, onEvent)
}
