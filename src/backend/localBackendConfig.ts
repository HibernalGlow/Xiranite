import { getDenoDesktopBindings } from "../../desktop/bridge"
import { appendUrlPath } from "@xiranite/shared"
import { resolveBackendEndpoint, type BackendEndpoint } from "@/lib/xiraniteApiClient"
import { hydrateLocalBackendConfigFromTauri } from "./tauriChannel"
import { createLogger } from "@/lib/logger"

const logger = createLogger("backend.config")

/**
 * The endpoint the host injected. Reading it is shared with the node UI seam (`@/lib/xiraniteApiClient`) so
 * both sides resolve one URL and token; hydrating it (Tauri channel, Wails, Deno, env) stays shell-only.
 */
export type LocalBackendConfig = BackendEndpoint

/**
 * Identifies a particular local backend process. Consumers that own
 * backend-derived state must reset when a replacement process takes over the
 * same endpoint.
 */
export function localBackendConnectionKey(config: LocalBackendConfig | undefined): string {
  if (!config) return ""
  return `${config.baseUrl}\0${config.token ?? ""}\0${config.instanceId ?? ""}`
}

declare global {
  interface Window {
    __XIRANITE_BACKEND__?: Partial<LocalBackendConfig>
    _wails?: unknown
  }
}

const PKG = "main.XiraniteService"
const CONFIG_HYDRATE_TIMEOUT_MS = 1_500

let hydrateWarningLogged = false

export function resolveLocalBackendConfig(): LocalBackendConfig {
  return resolveBackendEndpoint()
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

export async function hydrateLocalBackendConfig(options: { refresh?: boolean } = {}): Promise<LocalBackendConfig | undefined> {
  if (typeof window === "undefined") return undefined

  const existingConfig = normalizeLocalBackendConfig(window.__XIRANITE_BACKEND__)
  if (existingConfig && !options.refresh) return existingConfig

  if (existingConfig) return existingConfig

  const environmentConfig = normalizeLocalBackendConfig({
    baseUrl: import.meta.env.VITE_XIRANITE_BACKEND_URL,
    token: import.meta.env.VITE_XIRANITE_BACKEND_TOKEN,
  })
  if (environmentConfig) {
    window.__XIRANITE_BACKEND__ = environmentConfig
    return environmentConfig
  }

  return await hydrateFromTauriChannel()
    ?? await hydrateLocalBackendConfigFromDenoDesktop()
    ?? await hydrateLocalBackendConfigFromWails()
}

/**
 * The Tauri channel is the target transport (ADR-0065), so it is tried first and then cached the same way
 * the retiring Wails/Deno paths cache theirs — every consumer reads `window.__XIRANITE_BACKEND__`.
 */
async function hydrateFromTauriChannel(): Promise<LocalBackendConfig | undefined> {
  try {
    const config = normalizeLocalBackendConfig(await withTimeout(
      hydrateLocalBackendConfigFromTauri(),
      CONFIG_HYDRATE_TIMEOUT_MS,
      `Timed out reading the Tauri xiranite_bootstrap channel after ${CONFIG_HYDRATE_TIMEOUT_MS}ms`,
    ))
    if (!config) return undefined
    window.__XIRANITE_BACKEND__ = config
    return config
  } catch (error) {
    warnHydrateFailure(error)
    return undefined
  }
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

// Exported because localBackendStatus.test.ts covers the browser-runtime guard; it was unexported, so the
// import resolved to undefined and that test has been failing at HEAD.
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

/**
 * Reads the host's own reason for having no local backend. A system-Bun release
 * started without Bun on PATH has nothing to run, and the packaged GUI build has
 * no console, so the frontend needs this to name the missing runtime instead of
 * showing a generic "not configured" dead end.
 */
export async function readHostLocalBackendStartupError(): Promise<string> {
  if (typeof window === "undefined" || !window._wails) return ""

  try {
    const runtime = await import("@wailsio/runtime")
    const reason = await withTimeout(
      runtime.Call.ByName(`${PKG}.LocalBackendStartupError`) as Promise<string | null>,
      CONFIG_HYDRATE_TIMEOUT_MS,
      "Timed out reading the Wails local backend startup error",
    )
    return typeof reason === "string" ? reason.trim() : ""
  } catch {
    return ""
  }
}

function normalizeLocalBackendConfig(config: Partial<LocalBackendConfig> | null | undefined): LocalBackendConfig | undefined {
  if (!config?.baseUrl) return undefined
  return {
    baseUrl: config.baseUrl,
    token: config.token,
    instanceId: config.instanceId,
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
  logger.warn("Local backend config hydrate failed", error)
}

export function localBackendFileUrl(path: string): string {
  const config = resolveLocalBackendConfig()
  const url = localBackendUrl("/local-files", config)
  url.searchParams.set("path", path)
  if (config.token) url.searchParams.set("token", config.token)
  return url.href
}

export function localBackendUrl(path: string, config: LocalBackendConfig = resolveLocalBackendConfig()): URL {
  return appendUrlPath(config.baseUrl, path)
}
