import type { RuntimeInterface } from "../runtime/runtime"
import { EngineVService } from "./enginevService"
import { NodeRunnerService } from "./nodeRunnerService"
import { WorkspaceService } from "./workspaceService"

export interface ServiceContext {
  runtime: RuntimeInterface
}

export interface Service<TName extends string = string> {
  readonly name: TName
}

export type { EngineVService, NodeRunnerService, WorkspaceService }

export interface Backend {
  workspace: WorkspaceService
  enginev: EngineVService
  nodes: NodeRunnerService
}

export function createBackend(ctx: ServiceContext): Backend {
  return {
    workspace: new WorkspaceService(ctx),
    enginev: new EngineVService(ctx),
    nodes: new NodeRunnerService(ctx),
  }
}
