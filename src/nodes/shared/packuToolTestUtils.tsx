import type { ComponentType } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { PackuToolData, PackuToolInput } from "@xiranite/packu-node-runtime"
import type { NodeSurfaceMode } from "./useNodeSurface"
import { describeMigratedToolComponentContract } from "./migratedToolTestUtils"

export function describePackuMigratedToolComponent({
  Component,
  nodeId,
  title,
  surfaceModes,
}: {
  Component: ComponentType<NodeComponentProps>
  nodeId: string
  title: string
  surfaceModes: readonly NodeSurfaceMode[]
}) {
  describeMigratedToolComponentContract<Record<string, unknown>, PackuToolInput, PackuToolData>({
    name: `app-owned ${nodeId} Component`,
    Component,
    nodeId,
    title,
    initialState: {
      pathsText: "D:/input\nD:/second",
      argsText: "--flag value",
      configPath: "D:/packu.toml",
    },
    runResult: packuRunResult(nodeId),
    buttonName: "生成计划",
    expectedInput: {
      action: "plan",
      paths: ["D:/input", "D:/second"],
      args: ["--flag", "value"],
      configPath: "D:/packu.toml",
      dryRun: true,
      recordRun: false,
    },
    surfaceModes,
  })
}

function packuRunResult(nodeId: string): NodeRunResult<PackuToolData> {
  return {
    success: true,
    message: `PackU ${nodeId} planned.`,
    data: {
      spec: {
        id: nodeId,
        moduleName: `packu.${nodeId}`,
        sourceRoot: "D:/PackU",
      },
      command: {
        label: `python -m packu.${nodeId}`,
        command: "python",
        args: ["-m", `packu.${nodeId}`],
        cwd: "D:/PackU",
      },
      integration: {
        sourceRoot: "D:/PackU",
        moduleName: `packu.${nodeId}`,
        configCandidates: [],
        recordRun: false,
        recordFormat: "jsonl",
      },
      selectedPaths: ["D:/input", "D:/second"],
      errors: [],
    },
  }
}
