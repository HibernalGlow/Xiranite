import type { WorkspaceRepository } from "@xiranite/repository"
import {
  createWorkspaceInputSchema,
  renameWorkspaceInputSchema,
  type CreateWorkspaceInput,
  type RenameWorkspaceInput,
  type WorkspaceSnapshotDTO,
  type WorkspaceDTO,
  workspaceSnapshotSchema,
} from "@xiranite/shared"

export interface WorkspaceServiceOptions {
  repository: WorkspaceRepository
  now?: () => number
  createId?: () => string
}

export class WorkspaceService {
  private readonly repository: WorkspaceRepository
  private readonly now: () => number
  private readonly createId: () => string

  constructor(options: WorkspaceServiceOptions) {
    this.repository = options.repository
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? (() => Math.random().toString(36).slice(2))
  }

  async listWorkspaces(): Promise<WorkspaceDTO[]> {
    return this.repository.listWorkspaces()
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceDTO> {
    const parsed = createWorkspaceInputSchema.parse(input)
    const now = this.now()
    return this.repository.createWorkspace({
      id: `ws-${this.createId()}`,
      label: parsed.label,
      icon: parsed.icon,
      createdAt: now,
      updatedAt: now,
    })
  }

  async renameWorkspace(id: string, input: RenameWorkspaceInput): Promise<WorkspaceDTO> {
    const parsed = renameWorkspaceInputSchema.parse(input)
    return this.repository.renameWorkspace(id, parsed.label, this.now())
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.repository.deleteWorkspace(id)
  }

  async getSnapshot(): Promise<WorkspaceSnapshotDTO> {
    const [workspaces, lanes, components] = await Promise.all([
      this.repository.listWorkspaces(),
      this.repository.listLanes(),
      this.repository.listComponents(),
    ])

    return { workspaces, lanes, components }
  }

  async saveSnapshot(snapshot: WorkspaceSnapshotDTO): Promise<WorkspaceSnapshotDTO> {
    const parsed = workspaceSnapshotSchema.parse(snapshot)
    return this.repository.saveSnapshot(parsed)
  }
}

export interface XiraniteServices {
  workspace: WorkspaceService
}

export function createXiraniteServices(repository: WorkspaceRepository): XiraniteServices {
  return {
    workspace: new WorkspaceService({ repository }),
  }
}
