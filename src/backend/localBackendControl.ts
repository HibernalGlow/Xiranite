import { createXiraniteSystemClient, type LocalBackendRestartResult as ApiRestartResult } from "@xiranite/api/client"
import { getDenoDesktopBindings } from "../../desktop/bridge"
import { resolveLocalBackendConfig, setLocalBackendConfig } from "./localBackendConfig"

const PKG = "main.XiraniteService"

export type LocalBackendRestartSource = "http" | "deno-desktop" | "wails" | "none"

export interface LocalBackendControlRestartResult extends ApiRestartResult {
  source: LocalBackendRestartSource
}

export interface NodeSourceHotReloadState {
  supported: boolean
  enabled: boolean
}

export async function getNodeSourceHotReload(): Promise<NodeSourceHotReloadState> {
  const config = resolveLocalBackendConfig()
  return await createXiraniteSystemClient(config.baseUrl, { token: config.token }).getNodeSourceHotReload()
}

export async function setNodeSourceHotReload(enabled: boolean): Promise<NodeSourceHotReloadState> {
  const config = resolveLocalBackendConfig()
  return await createXiraniteSystemClient(config.baseUrl, { token: config.token }).setNodeSourceHotReload(enabled)
}

declare global {
  interface Window {
    _wails?: unknown
  }
}

export async function restartLocalBackend(): Promise<LocalBackendControlRestartResult> {
  const httpResult = await restartLocalBackendViaHttp().catch((error) => ({
    restarted: false,
    supported: false,
    source: "http" as const,
    message: error instanceof Error ? error.message : String(error),
  }))

  if (httpResult.supported) return applyRestartResult(httpResult, "http")

  const denoBindings = getDenoDesktopBindings()
  if (denoBindings) {
    const denoResult = await denoBindings.xiraniteDesktopBackendRestart().catch((error) => ({
      restarted: false,
      supported: false,
      source: "deno-desktop" as const,
      message: error instanceof Error ? error.message : String(error),
    }))
    return applyRestartResult({ ...denoResult, source: "deno-desktop" }, "deno-desktop")
  }

  if (canUseWailsBridge()) {
    const wailsResult = await restartLocalBackendViaWails().catch((error) => ({
      restarted: false,
      supported: false,
      source: "wails" as const,
      message: error instanceof Error ? error.message : String(error),
    }))
    return applyRestartResult(wailsResult, "wails")
  }

  return httpResult
}

async function restartLocalBackendViaHttp(): Promise<LocalBackendControlRestartResult> {
  const config = resolveLocalBackendConfig()
  const result = await createXiraniteSystemClient(config.baseUrl, { token: config.token }).restartBackend()
  return { ...result, source: "http" }
}

async function restartLocalBackendViaWails(): Promise<LocalBackendControlRestartResult> {
  const runtime = await import("@wailsio/runtime")
  const result = await runtime.Call.ByName(`${PKG}.RestartLocalBackend`) as ApiRestartResult
  return { ...result, source: "wails" }
}

function applyRestartResult(
  result: LocalBackendControlRestartResult,
  source: LocalBackendRestartSource,
): LocalBackendControlRestartResult {
  if (result.config?.baseUrl) setLocalBackendConfig(result.config)
  return { ...result, source }
}

function canUseWailsBridge(): boolean {
  return typeof window !== "undefined" && Boolean(window._wails)
}
