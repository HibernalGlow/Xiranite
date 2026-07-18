import { createXiraniteConfigClient } from "@xiranite/api/client"
import type { XiraniteConfigClient } from "@xiranite/api/client"
import type { Webview2Config } from "@xiranite/api/client"
import { resolveLocalBackendConfig, type LocalBackendConfig } from "./localBackendConfig"

let configClient: XiraniteConfigClient | null = null
let configClientKey: string | null = null

export function getConfigClient(): XiraniteConfigClient {
  const config = resolveLocalBackendConfig()
  const key = backendConfigCacheKey(config)
  if (configClient && configClientKey === key) return configClient

  configClient = createXiraniteConfigClient(config.baseUrl, { token: config.token })
  configClientKey = key
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
  const current = await getNodeConfigFromBackend<Record<string, unknown>>(nodeId)
  const nextConfig = isRecord(current.config) && isRecord(config)
    ? { ...current.config, ...config }
    : config
  await getConfigClient().updateNodeConfig(nodeId, nextConfig)
}

export async function getNodePresetsFromBackend<TValues extends Record<string, unknown> = Record<string, unknown>>(nodeId: string) {
  return getConfigClient().getNodePresets<TValues>(nodeId)
}

export async function createNodePresetOnBackend<TValues extends Record<string, unknown> = Record<string, unknown>>(nodeId: string, input: { name: string; values: TValues }) {
  return getConfigClient().createNodePreset(nodeId, input)
}

export async function updateNodePresetOnBackend<TValues extends Record<string, unknown> = Record<string, unknown>>(nodeId: string, presetId: string, input: { name?: string; values?: TValues }) {
  return getConfigClient().updateNodePreset(nodeId, presetId, input)
}

export async function deleteNodePresetOnBackend(nodeId: string, presetId: string) {
  return getConfigClient().deleteNodePreset(nodeId, presetId)
}

export async function getNodeUiConfigFromBackend<T = unknown>(
  nodeId: string,
): Promise<{ config: T | undefined; path: string }> {
  const result = await getNodeConfigFromBackend<Record<string, unknown>>(nodeId)
  const uiConfig = isRecord(result.config?.ui) ? result.config.ui as T : undefined
  return { config: uiConfig, path: result.path }
}

export async function saveNodeUiConfigToBackend<T = unknown>(
  nodeId: string,
  config: T,
): Promise<void> {
  const current = await getNodeConfigFromBackend<Record<string, unknown>>(nodeId)
  const currentNodeConfig = isRecord(current.config) ? current.config : {}
  const currentUi = isRecord(currentNodeConfig.ui) ? currentNodeConfig.ui : {}
  const nextUi = { ...currentUi }
  if (isRecord(config)) {
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) delete nextUi[key]
      else nextUi[key] = value
    }
  }
  await saveNodeConfigToBackend(nodeId, {
    ...currentNodeConfig,
    ui: nextUi,
  })
}

export async function getAppConfigFromBackend<T = unknown>(
  section: string,
): Promise<{ config: T | undefined; path: string }> {
  return getConfigClient().getAppConfig<T>(section)
}

export async function saveAppConfigToBackend<T = unknown>(
  section: string,
  config: T,
): Promise<void> {
  await getConfigClient().updateAppConfig<T>(section, config)
}

export async function getWebview2ConfigFromBackend(): Promise<{ config: Webview2Config | undefined; path: string }> {
  return getConfigClient().getWebview2Config()
}

export async function saveWebview2ConfigToBackend(config: Webview2Config): Promise<{ config: Webview2Config; path: string }> {
  return getConfigClient().updateWebview2Config(config)
}

export async function getCustomThemesFromBackend<T = unknown>(): Promise<{ themes: T[]; path: string }> {
  return getConfigClient().getCustomThemes() as Promise<{ themes: T[]; path: string }>
}

export async function saveCustomThemesToBackend<T = unknown>(themes: T[]): Promise<void> {
  await getConfigClient().saveCustomThemes(themes)
}

export async function getBackgroundImageFromBackend(): Promise<{ url: string | null; path: string }> {
  return getConfigClient().getBackgroundImage()
}

export async function saveBackgroundImageToBackend(url: string | null): Promise<void> {
  await getConfigClient().saveBackgroundImage(url)
}

export async function getConfigFilePath(): Promise<string> {
  return getConfigClient().getConfigPath()
}

export async function openConfigFileWithBackend(): Promise<string> {
  const result = await getConfigClient().openConfigFile()
  return result.path
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function backendConfigCacheKey(config: LocalBackendConfig): string {
  return `${config.baseUrl}\n${config.token ?? ""}`
}
