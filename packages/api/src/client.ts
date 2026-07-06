import { treaty, type Treaty } from "@elysiajs/eden"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import type { XiraniteApp } from "./index.js"

export interface XiraniteClientOptions {
  token?: string
}

export interface XiraniteWorkspaceClient {
  loadSnapshot(): Promise<WorkspaceSnapshotDTO>
  persistSnapshot(snapshot: WorkspaceSnapshotDTO): Promise<WorkspaceSnapshotDTO>
}

export function createXiraniteClient(baseUrl: string, options: XiraniteClientOptions = {}): Treaty.Create<XiraniteApp> {
  return treaty<XiraniteApp>(baseUrl, treatyOptions(options))
}

export function createXiraniteWorkspaceClient(baseUrl: string, options: XiraniteClientOptions = {}): XiraniteWorkspaceClient {
  const client = createXiraniteClient(baseUrl, options)

  return {
    async loadSnapshot() {
      const result = await client.workspace.snapshot.get()
      if (result.error) throw new Error(`Workspace snapshot load failed: ${result.status}`)
      return result.data.snapshot
    },
    async persistSnapshot(snapshot) {
      const result = await client.workspace.snapshot.put(snapshot)
      if (result.error) throw new Error(`Workspace snapshot persist failed: ${result.status}`)
      return result.data.snapshot
    },
  }
}

function treatyOptions(options: XiraniteClientOptions): Treaty.Config {
  if (!options.token) return {}
  return {
    headers: {
      "x-xiranite-token": options.token,
    },
  }
}
