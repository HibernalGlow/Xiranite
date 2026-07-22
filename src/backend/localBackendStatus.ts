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
    await checkHealth(config, timeoutMs)
    return { status: "ready", runtime, config }
  } catch (error) {
    const refreshedConfig = await hydrateLocalBackendConfig({ refresh: true })
    if (refreshedConfig && !sameConfig(config, refreshedConfig)) {
      try {
        await checkHealth(refreshedConfig, timeoutMs)
        return { status: "ready", runtime, config: refreshedConfig }
      } catch (refreshError) {
        return unreachable(runtime, refreshedConfig, refreshError)
      }
    }
    return unreachable(runtime, config, error)
  }
}

async function checkHealth(config: LocalBackendConfig, timeoutMs: number): Promise<void> {
  await withTimeout(
    createXiraniteSystemClient(config.baseUrl, { token: config.token }).health(),
    timeoutMs,
    `Local backend health check timed out after ${timeoutMs}ms`,
  )
}

function sameConfig(left: LocalBackendConfig, right: LocalBackendConfig): boolean {
  return left.baseUrl === right.baseUrl && left.token === right.token
}

function unreachable(runtime: RuntimeConnectionInfo, config: LocalBackendConfig, error: unknown): LocalBackendStatus {
  return {
    status: "unreachable",
    runtime,
    config,
    error: error instanceof Error ? error.message : String(error),
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
