import { createXiraniteConfigClient } from "@xiranite/api/client"
import type { XiraniteConfigClient } from "@xiranite/api/client"
import { resolveLocalBackendConfig } from "./localBackendConfig"

let configClient: XiraniteConfigClient | null = null

export function getConfigClient(): XiraniteConfigClient {
  if (configClient) return configClient

  const config = resolveLocalBackendConfig()
  configClient = createXiraniteConfigClient(config.baseUrl, { token: config.token })
  return configClient
}

export async function getNodeConfigFromBackend<T = unknown>(
  nodeId: string,
): Promise<{ config: T | undefined; path: string }> {
  return getConfigClient().getNodeConfig<T>(nodeId)
}

export async function saveNodeConfigToBackend<T = unknown>(
  nodeId: string,
  config: T,
): Promise<void> {
  await getConfigClient().updateNodeConfig<T>(nodeId, config)
}

export async function getConfigFilePath(): Promise<string> {
  return getConfigClient().getConfigPath()
}

export async function openConfigFileWithBackend(): Promise<string> {
  const result = await getConfigClient().openConfigFile()
  return result.path
}
