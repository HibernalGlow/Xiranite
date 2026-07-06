import { createXiraniteWorkspaceClient } from "@xiranite/api/client"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"

interface LocalBackendConfig {
  baseUrl: string
  token?: string
}

declare global {
  interface Window {
    __XIRANITE_BACKEND__?: Partial<LocalBackendConfig>
  }
}

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

function resolveLocalBackendConfig(): LocalBackendConfig {
  const injected = typeof window !== "undefined" ? window.__XIRANITE_BACKEND__ : undefined
  const baseUrl = injected?.baseUrl ?? import.meta.env.VITE_XIRANITE_BACKEND_URL
  const token = injected?.token ?? import.meta.env.VITE_XIRANITE_BACKEND_TOKEN

  if (!baseUrl) {
    throw new Error("Xiranite local backend is not configured. Set window.__XIRANITE_BACKEND__ or VITE_XIRANITE_BACKEND_URL.")
  }

  return { baseUrl, token }
}
