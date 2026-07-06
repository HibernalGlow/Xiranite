import type { ComponentDTO, LaneDTO, WorkspaceDTO, WorkspaceSnapshotDTO } from "@xiranite/shared"

export interface WorkspaceRepository {
  listWorkspaces(): Promise<WorkspaceDTO[]>
  createWorkspace(workspace: WorkspaceDTO): Promise<WorkspaceDTO>
  renameWorkspace(id: string, label: string, updatedAt: number): Promise<WorkspaceDTO>
  deleteWorkspace(id: string): Promise<void>
  listLanes(): Promise<LaneDTO[]>
  listComponents(): Promise<ComponentDTO[]>
  saveSnapshot(snapshot: WorkspaceSnapshotDTO): Promise<WorkspaceSnapshotDTO>
}

export interface MemoryWorkspaceRepositoryOptions {
  workspaces?: WorkspaceDTO[]
  lanes?: LaneDTO[]
  components?: ComponentDTO[]
}

export function createMemoryWorkspaceRepository(options: MemoryWorkspaceRepositoryOptions = {}): WorkspaceRepository {
  let workspaces = [...(options.workspaces ?? [])]
  let lanes = [...(options.lanes ?? [])]
  let components = [...(options.components ?? [])]

  return {
    async listWorkspaces() {
      return clone(workspaces)
    },
    async createWorkspace(workspace) {
      workspaces = [...workspaces.filter((item) => item.id !== workspace.id), workspace]
      return clone(workspace)
    },
    async renameWorkspace(id, label, updatedAt) {
      const workspace = workspaces.find((item) => item.id === id)
      if (!workspace) throw new Error(`Workspace not found: ${id}`)

      const next = { ...workspace, label, updatedAt }
      workspaces = workspaces.map((item) => item.id === id ? next : item)
      return clone(next)
    },
    async deleteWorkspace(id) {
      workspaces = workspaces.filter((workspace) => workspace.id !== id)
      lanes = lanes.filter((lane) => lane.workspaceId !== id)
      components = components.filter((component) => component.workspaceId !== id)
    },
    async listLanes() {
      return clone(lanes)
    },
    async listComponents() {
      return clone(components)
    },
    async saveSnapshot(snapshot) {
      workspaces = clone(snapshot.workspaces)
      lanes = clone(snapshot.lanes)
      components = clone(snapshot.components)
      return clone(snapshot)
    },
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
