import { createXiraniteWorkspaceClient } from "@xiranite/api/client"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import { resolveLocalBackendConfig } from "./localBackendConfig"

let workspaceClient: ReturnType<typeof createXiraniteWorkspaceClient> | null = null

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshotDTO> {
  return getWorkspaceClient().loadSnapshot()
}

export async function persistWorkspaceSnapshot(snapshot: WorkspaceSnapshotDTO): Promise<void> {
  await getWorkspaceClient().persistSnapshot(snapshot)
}

function getWorkspaceClient() {
  if (workspaceClient) return workspaceClient

  const config = resolveLocalBackendConfig()
  workspaceClient = createXiraniteWorkspaceClient(config.baseUrl, { token: config.token })
  return workspaceClient
}
