/**
 * Service 注册中心 — Service 层。
 *
 * 设计原则（用户原话："同仓 + Service + 强约束 Runtime Interface + Adapter IPC"）：
 *
 * - Service 是业务逻辑层，所有领域功能（Workspace 持久化、EngineV 扫描…）都封装为 Service。
 * - Service 只依赖 RuntimeInterface，不直接接触 IPC / window / fetch。
 * - 前端通过 `backend.client` 拿到 service 实例，对前端来说 backend 是个黑盒。
 * - 切换后端框架时（Electbun → Tauri），Service 层一行不改。
 */

import type { RuntimeInterface } from "../runtime/runtime"

export interface ServiceContext {
  runtime: RuntimeInterface
}

/**
 * 所有 service 必须实现此接口，便于在 registry 中统一注册。
 * 名字字段方便日志、调试、未来 RPC 化。
 */
export interface Service<TName extends string = string> {
  readonly name: TName
}

import { WorkspaceService } from "./workspaceService"
import { EngineVService } from "./enginevService"

export type { WorkspaceService, EngineVService }

/**
 * Backend 是所有 service 的聚合根。前端只能通过 backend.client 取到 Backend 实例。
 * 新增 service 时：1) 实现 service 类，2) 在 createBackend 里实例化并挂到 services 上。
 */
export interface Backend {
  workspace: WorkspaceService
  enginev: EngineVService
}

export function createBackend(ctx: ServiceContext): Backend {
  return {
    workspace: new WorkspaceService(ctx),
    enginev: new EngineVService(ctx),
  }
}
