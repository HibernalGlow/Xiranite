import { getDenoDesktopBindings } from "../../desktop/bridge"

export interface LocalBackendConfig {
  baseUrl: string
  token?: string
}

declare global {
  interface Window {
    __XIRANITE_BACKEND__?: Partial<LocalBackendConfig>
    _wails?: unknown
  }
}

const PKG = "main.XiraniteService"
const DEV_BACKEND_MANIFEST_URL = "/.well-known/xiranite/backend.json"
const CONFIG_HYDRATE_TIMEOUT_MS = 1_500

let hydrateWarningLogged = false

export function resolveLocalBackendConfig(): LocalBackendConfig {
  const injected = typeof window !== "undefined" ? window.__XIRANITE_BACKEND__ : undefined
  const baseUrl = injected?.baseUrl ?? import.meta.env.VITE_XIRANITE_BACKEND_URL
  const token = injected?.token ?? import.meta.env.VITE_XIRANITE_BACKEND_TOKEN

  if (!baseUrl) {
    throw new Error("Xiranite local backend is not configured. Set window.__XIRANITE_BACKEND__ or VITE_XIRANITE_BACKEND_URL.")
  }

  return { baseUrl, token }
}

export function setLocalBackendConfig(config: Partial<LocalBackendConfig> | null | undefined): LocalBackendConfig | undefined {
  if (typeof window === "undefined") return undefined
  const normalizedConfig = normalizeLocalBackendConfig(config)
  if (!normalizedConfig) {
    delete window.__XIRANITE_BACKEND__
    return undefined
  }
  window.__XIRANITE_BACKEND__ = normalizedConfig
  return normalizedConfig
}

export async function hydrateLocalBackendConfig(): Promise<LocalBackendConfig | undefined> {
  if (typeof window === "undefined") return undefined

  const manifestConfig = await loadDevBackendManifest()
  if (manifestConfig) {
    window.__XIRANITE_BACKEND__ = manifestConfig
    return manifestConfig
  }

  const existingConfig = normalizeLocalBackendConfig(window.__XIRANITE_BACKEND__)
  if (existingConfig) return existingConfig

  return await hydrateLocalBackendConfigFromDenoDesktop()
    ?? await hydrateLocalBackendConfigFromWails()
}

export async function hydrateLocalBackendConfigFromDenoDesktop(): Promise<LocalBackendConfig | undefined> {
  const bindings = getDenoDesktopBindings()
  if (!bindings) return undefined

  try {
    const config = await withTimeout(
      bindings.xiraniteDesktopBackendConfig(),
      CONFIG_HYDRATE_TIMEOUT_MS,
      `Timed out reading Deno Desktop local backend config after ${CONFIG_HYDRATE_TIMEOUT_MS}ms`,
    )
    const normalizedConfig = normalizeLocalBackendConfig(config)
    if (!normalizedConfig) return undefined
    window.__XIRANITE_BACKEND__ = normalizedConfig
    return normalizedConfig
  } catch (error) {
    warnHydrateFailure(error)
    return undefined
  }
}

export async function hydrateLocalBackendConfigFromWails(): Promise<LocalBackendConfig | undefined> {
  if (typeof window === "undefined" || !window._wails) return undefined

  try {
    const runtime = await import("@wailsio/runtime")
    const config = await withTimeout(
      runtime.Call.ByName(`${PKG}.LocalBackendConfig`) as Promise<LocalBackendConfig | null>,
      CONFIG_HYDRATE_TIMEOUT_MS,
      `Timed out reading Wails local backend config after ${CONFIG_HYDRATE_TIMEOUT_MS}ms`,
    )
    const normalizedConfig = normalizeLocalBackendConfig(config)
    if (!normalizedConfig) return undefined
    window.__XIRANITE_BACKEND__ = normalizedConfig
    return normalizedConfig
  } catch (error) {
    warnHydrateFailure(error)
    return undefined
  }
}

async function loadDevBackendManifest(): Promise<LocalBackendConfig | undefined> {
  if (!import.meta.env.DEV) return undefined

  try {
    const response = await withTimeout(
      fetch(`${DEV_BACKEND_MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" }),
      CONFIG_HYDRATE_TIMEOUT_MS,
      `Timed out reading dev backend manifest after ${CONFIG_HYDRATE_TIMEOUT_MS}ms`,
    )
    if (!response.ok) return undefined
    const config = await response.json() as Partial<LocalBackendConfig>
    return normalizeLocalBackendConfig(config)
  } catch (error) {
    warnHydrateFailure(error)
    return undefined
  }
}

function normalizeLocalBackendConfig(config: Partial<LocalBackendConfig> | null | undefined): LocalBackendConfig | undefined {
  if (!config?.baseUrl) return undefined
  return {
    baseUrl: config.baseUrl,
    token: config.token,
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

function warnHydrateFailure(error: unknown): void {
  if (hydrateWarningLogged) return
  hydrateWarningLogged = true
  console.warn("[backend] local backend config hydrate failed:", error)
}

export function localBackendFileUrl(path: string): string {
  const config = resolveLocalBackendConfig()
  const url = new URL("/local-files", config.baseUrl)
  url.searchParams.set("path", path)
  if (config.token) url.searchParams.set("token", config.token)
  return url.href
}
