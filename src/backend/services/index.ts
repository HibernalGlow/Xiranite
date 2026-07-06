import type { RuntimeInterface } from "../runtime/runtime"
import { EngineVService } from "./enginevService"
import { NodeRunnerService } from "./nodeRunnerService"
import { WindowService } from "./windowService"
import { WorkspaceService } from "./workspaceService"

export interface ServiceContext {
  runtime: RuntimeInterface
}

export interface Service<TName extends string = string> {
  readonly name: TName
}

export type { EngineVService, NodeRunnerService, WindowService, WorkspaceService }

export interface Backend {
  workspace: WorkspaceService
  enginev: EngineVService
  nodes: NodeRunnerService
  windows: WindowService
}

export function createBackend(ctx: ServiceContext): Backend {
  return {
    workspace: new WorkspaceService(ctx),
    enginev: new EngineVService(ctx),
    nodes: new NodeRunnerService(ctx),
    windows: new WindowService(ctx),
  }
}
