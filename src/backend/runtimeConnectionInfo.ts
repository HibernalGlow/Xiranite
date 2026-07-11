import type { LocalBackendConfig } from "./localBackendConfig"
import { detectDenoDesktop } from "../../desktop/bridge"

export type HostRuntimeKind = "deno-desktop" | "wails" | "web"
export type FrontendSourceKind = "vite-dev" | "packaged"

export interface RuntimeConnectionInfo {
  hostRuntime: HostRuntimeKind
  frontendSource: FrontendSourceKind
  frontendOrigin: string
  frontendDevUrl?: string
  backendUrl?: string
  backendTokenConfigured: boolean
  devAttachCommand: string
  devStartCommand: string
  hotSwitchSupported: false
}

declare global {
  interface Window {
    __XIRANITE_BACKEND__?: Partial<LocalBackendConfig>
    _wails?: unknown
  }
}

function clean(value: string | undefined): string | undefined {
  const next = value?.trim()
  return next ? next : undefined
}

export function getRuntimeConnectionInfo(): RuntimeConnectionInfo {
  const injected = typeof window !== "undefined" ? window.__XIRANITE_BACKEND__ : undefined
  const frontendDevUrl = clean(import.meta.env.VITE_XIRANITE_FRONTEND_DEV_URL)
  const backendUrl = clean(injected?.baseUrl) ?? clean(import.meta.env.VITE_XIRANITE_BACKEND_URL)
  const backendToken = clean(injected?.token) ?? clean(import.meta.env.VITE_XIRANITE_BACKEND_TOKEN)
  const frontendOrigin = typeof window !== "undefined" ? window.location.origin : ""
  const hostRuntime: HostRuntimeKind = detectDenoDesktop()
    ? "deno-desktop"
    : typeof window !== "undefined" && window._wails ? "wails" : "web"

  return {
    hostRuntime,
    frontendSource: import.meta.env.DEV || frontendDevUrl ? "vite-dev" : "packaged",
    frontendOrigin,
    frontendDevUrl,
    backendUrl,
    backendTokenConfigured: Boolean(backendToken),
    devAttachCommand: "bun run dev:desktop:attach",
    devStartCommand: "bun run dev:desktop",
    hotSwitchSupported: false,
  }
}
