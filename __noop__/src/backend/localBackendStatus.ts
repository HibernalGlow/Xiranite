import { createXiraniteSystemClient } from "@xiranite/api/client"
import { getRuntimeConnectionInfo, type RuntimeConnectionInfo } from "./runtimeConnectionInfo"
import { hydrateLocalBackendConfig, resolveLocalBackendConfig, type LocalBackendConfig } from "./localBackendConfig"

export type LocalBackendStatusKind = "ready" | "missing-config" | "unreachable"

export interface LocalBackendStatus {
  status: LocalBackendStatusKind
  runtime: RuntimeConnectionInfo
  config?: LocalBackendConfig
  error?: string
}

const DEFAULT_HEALTH_TIMEOUT_MS = 2_000

export async function checkLocalBackendStatus(timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS): Promise<LocalBackendStatus> {
  await hydrateLocalBackendConfig()
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
    await withTimeout(
      createXiraniteSystemClient(config.baseUrl, { token: config.token }).health(),
      timeoutMs,
      `Local backend health check timed out after ${timeoutMs}ms`,
    )
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
