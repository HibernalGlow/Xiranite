/**
 * WorkspaceService — workspace/components 持久化。
 *
 * 这是端到端示例的第一站：前端 store 改动会通过此 service 写到 storage，
 * 刷新页面后从 storage 还原。三种 viewMode（cards/dockview/flow）共享同一份数据。
 */

import type { Service } from "."
import type {
  WorkspaceDTO,
  LaneDTO,
  ComponentDTO,
} from "../shared/types"
import type { ServiceContext } from "."
import type { RuntimeInterface } from "../runtime/runtime"

const KEY_WORKSPACES = "xiranite:workspaces"
const KEY_LANES = "xiranite:lanes"
const KEY_COMPONENTS = "xiranite:components"

export interface WorkspaceServiceAPI {
  // Workspaces
  listWorkspaces(): Promise<WorkspaceDTO[]>
  saveWorkspace(ws: WorkspaceDTO): Promise<void>
  deleteWorkspace(id: string): Promise<void>
  // Lanes
  listLanes(): Promise<LaneDTO[]>
  listLanesByWorkspace(workspaceId: string): Promise<LaneDTO[]>
  saveLane(lane: LaneDTO): Promise<void>
  deleteLane(id: string): Promise<void>
  // Components
  listComponents(): Promise<ComponentDTO[]>
  listComponentsByWorkspace(workspaceId: string): Promise<ComponentDTO[]>
  saveComponent(comp: ComponentDTO): Promise<void>
  deleteComponent(id: string): Promise<void>
}

export class WorkspaceService implements Service<"workspace">, WorkspaceServiceAPI {
  readonly name = "workspace"
  private ctx: ServiceContext
  private cache: {
    workspaces?: WorkspaceDTO[]
    lanes?: LaneDTO[]
    components?: ComponentDTO[]
  } = {}

  constructor(ctx: ServiceContext) {
    this.ctx = ctx
  }

  private get runtime(): RuntimeInterface { return this.ctx.runtime }

  // ── Workspaces ──
  async listWorkspaces(): Promise<WorkspaceDTO[]> {
    if (!this.cache.workspaces) {
      const raw = await this.runtime.storage.get(KEY_WORKSPACES)
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
    // 级联删除 lane 和 component
    const lanes = (await this.listLanes()).filter(l => l.workspaceId !== id)
    await this.persistLanes(lanes)
    const comps = (await this.listComponents()).filter(c => c.workspaceId !== id)
    await this.persistComponents(comps)
  }

  // ── Lanes ──
  async listLanes(): Promise<LaneDTO[]> {
    if (!this.cache.lanes) {
      const raw = await this.runtime.storage.get(KEY_LANES)
      this.cache.lanes = raw ? JSON.parse(raw) : []
    }
    return this.cache.lanes!
  }

  async listLanesByWorkspace(workspaceId: string): Promise<LaneDTO[]> {
    return (await this.listLanes()).filter(l => l.workspaceId === workspaceId)
  }

  async saveLane(lane: LaneDTO): Promise<void> {
    const list = await this.listLanes()
    const idx = list.findIndex(l => l.id === lane.id)
    if (idx >= 0) list[idx] = { ...lane, updatedAt: Date.now() }
    else list.push({ ...lane, createdAt: Date.now(), updatedAt: Date.now() })
    await this.persistLanes(list)
  }

  async deleteLane(id: string): Promise<void> {
    const list = (await this.listLanes()).filter(l => l.id !== id)
    await this.persistLanes(list)
  }

  // ── Components ──
  async listComponents(): Promise<ComponentDTO[]> {
    if (!this.cache.components) {
      const raw = await this.runtime.storage.get(KEY_COMPONENTS)
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
    await this.runtime.storage.set(KEY_WORKSPACES, JSON.stringify(list))
  }

  private async persistLanes(list: LaneDTO[]): Promise<void> {
    this.cache.lanes = list
    await this.runtime.storage.set(KEY_LANES, JSON.stringify(list))
  }

  private async persistComponents(list: ComponentDTO[]): Promise<void> {
    this.cache.components = list
    await this.runtime.storage.set(KEY_COMPONENTS, JSON.stringify(list))
  }
}
