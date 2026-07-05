/**
 * WorkspaceService — workspace/components 持久化。
 *
 * 这是端到端示例的第一站：前端 store 改动会通过此 service 写到 storage，
 * 刷新页面后从 storage 还原。三种 viewMode（cards/dockview/flow）共享同一份数据。
 */

import type { Service } from "."
import type {
  WorkspaceDTO,
  ComponentDTO,
} from "../shared/types"
import type { ServiceContext } from "."

const KEY_WORKSPACES = "xiranite:workspaces"
const KEY_COMPONENTS = "xiranite:components"

export class WorkspaceService implements Service<"workspace"> {
  readonly name = "workspace"
  private ctx: ServiceContext
  private cache: {
    workspaces?: WorkspaceDTO[]
    components?: ComponentDTO[]
  } = {}

  constructor(ctx: ServiceContext) {
    this.ctx = ctx
  }

  // ── Workspaces ──
  async listWorkspaces(): Promise<WorkspaceDTO[]> {
    if (!this.cache.workspaces) {
      const raw = await this.ctx.runtime.storage.get(KEY_WORKSPACES)
      this.cache.workspaces = raw ? JSON.parse(raw) : []
    }
    return this.cache.workspaces!
  }

  async saveWorkspace(ws: WorkspaceDTO): Promise<void> {
    const list = await this.listWorkspaces()
    const idx = list.findIndex(w => w.id === ws.id)
    if (idx >= 0) list[idx] = { ...ws, updatedAt: Date.now() }
    else list.push({ ...ws, createdAt: Date.now(), updatedAt: Date.now() })
    await this.persistWorkspaces(list)
  }

  async deleteWorkspace(id: string): Promise<void> {
    const list = (await this.listWorkspaces()).filter(w => w.id !== id)
    await this.persistWorkspaces(list)
    // 级联删除组件
    const comps = (await this.listComponents()).filter(c => c.workspaceId !== id)
    await this.persistComponents(comps)
  }

  // ── Components ──
  async listComponents(): Promise<ComponentDTO[]> {
    if (!this.cache.components) {
      const raw = await this.ctx.runtime.storage.get(KEY_COMPONENTS)
      this.cache.components = raw ? JSON.parse(raw) : []
    }
    return this.cache.components!
  }

  async listComponentsByWorkspace(workspaceId: string): Promise<ComponentDTO[]> {
    return (await this.listComponents()).filter(c => c.workspaceId === workspaceId)
  }

  async saveComponent(comp: ComponentDTO): Promise<void> {
    const list = await this.listComponents()
    const idx = list.findIndex(c => c.id === comp.id)
    if (idx >= 0) list[idx] = { ...comp, updatedAt: Date.now() }
    else list.push({ ...comp, createdAt: Date.now(), updatedAt: Date.now() })
    await this.persistComponents(list)
  }

  async deleteComponent(id: string): Promise<void> {
    const list = (await this.listComponents()).filter(c => c.id !== id)
    await this.persistComponents(list)
  }

  // ── internals ──
  private async persistWorkspaces(list: WorkspaceDTO[]): Promise<void> {
    this.cache.workspaces = list
    await this.ctx.runtime.storage.set(KEY_WORKSPACES, JSON.stringify(list))
  }

  private async persistComponents(list: ComponentDTO[]): Promise<void> {
    this.cache.components = list
    await this.ctx.runtime.storage.set(KEY_COMPONENTS, JSON.stringify(list))
  }
}
