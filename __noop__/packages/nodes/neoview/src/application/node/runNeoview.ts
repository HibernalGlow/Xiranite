import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export interface NeoViewInput {
  action?: "status"
}

export interface NeoViewRuntime {
  migrationStatus: () => Promise<NeoViewMigrationStatus>
}

export interface NeoViewMigrationStatus {
  sourceRevision: string
  featureCount: number
  pendingFeatures: number
  readerCoreReady: boolean
}

export interface NeoViewNodeData {
  migration: NeoViewMigrationStatus
}

export async function runNeoview(
  input: NeoViewInput,
  runtime: NeoViewRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<NodeRunResult<NeoViewNodeData>> {
  if ((input.action ?? "status") !== "status") {
    return { success: false, message: "NeoView reader execution is not enabled until ReaderSession and ArchiveProvider are complete." }
  }
  const migration = await runtime.migrationStatus()
  onEvent({ type: "log", message: `NeoView migration: ${migration.pendingFeatures}/${migration.featureCount} features pending.` })
  return {
    success: true,
    message: migration.readerCoreReady ? "NeoView reader core contracts are ready." : "NeoView migration status loaded.",
    data: { migration },
  }
}
