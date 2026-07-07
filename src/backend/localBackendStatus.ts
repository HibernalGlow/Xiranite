import { createXiraniteSystemClient } from "@xiranite/api/client"
import { getRuntimeConnectionInfo, type RuntimeConnectionInfo } from "./runtimeConnectionInfo"
import { resolveLocalBackendConfig, type LocalBackendConfig } from "./localBackendConfig"

export type LocalBackendStatusKind = "ready" | "missing-config" | "unreachable"

export interface LocalBackendStatus {
  status: LocalBackendStatusKind
  runtime: RuntimeConnectionInfo
  config?: LocalBackendConfig
  error?: string
}

export async function checkLocalBackendStatus(): Promise<LocalBackendStatus> {
  const runtime = getRuntimeConnectionInfo()
  let config: LocalBackendConfig

  try {
    config = resolveLocalBackendConfig()
  } catch (error) {
    return {
      status: "missing-config",
      runtime,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    await createXiraniteSystemClient(config.baseUrl, { token: config.token }).health()
    return { status: "ready", runtime, config }
  } catch (error) {
    return {
      status: "unreachable",
      runtime,
      config,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
