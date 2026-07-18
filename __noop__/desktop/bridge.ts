export const DENO_DESKTOP_BINDING_NAMES = {
  runtimeInfo: "xiraniteDesktopRuntimeInfo",
  windowControl: "xiraniteDesktopWindowControl",
  windowOpen: "xiraniteDesktopWindowOpen",
  windowFocus: "xiraniteDesktopWindowFocus",
  windowClose: "xiraniteDesktopWindowClose",
  windowGetFrame: "xiraniteDesktopWindowGetFrame",
  windowSetFrame: "xiraniteDesktopWindowSetFrame",
  backendConfig: "xiraniteDesktopBackendConfig",
  backendRestart: "xiraniteDesktopBackendRestart",
} as const

export type DesktopHostKind = "deno-desktop"
export type DesktopMainWindowAction = "minimize" | "maximize" | "restore" | "close"

export interface DesktopBackendConfig {
  baseUrl: string
  token?: string
}

export interface DesktopWindowCapabilities {
  supported: boolean
  nativeWindowControls: boolean
  frameless: boolean
  componentWindows: "native" | "browser-fallback" | "browser-popup" | "unsupported"
  message?: string
}

export interface DesktopRuntimeInfo {
  kind: DesktopHostKind
  version: 1
  capabilities: DesktopWindowCapabilities
}

export interface DesktopWindowCommandResult {
  success: boolean
  supported: boolean
  id?: string
  message: string
  state?: "normal" | "maximized" | "minimized" | "closed"
}

export interface DesktopWindowFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopOpenComponentWindowInput {
  componentId: string
  moduleId: string
  title?: string
  width?: number
  height?: number
}

export interface DesktopBackendRestartResult {
  restarted: boolean
  supported: boolean
  message: string
  config?: DesktopBackendConfig
}

export interface XiraniteDesktopBindings {
  xiraniteDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo>
  xiraniteDesktopWindowControl(action: DesktopMainWindowAction): Promise<DesktopWindowCommandResult>
  xiraniteDesktopWindowOpen(inputJSON: string): Promise<DesktopWindowCommandResult>
  xiraniteDesktopWindowFocus(id: string): Promise<DesktopWindowCommandResult>
  xiraniteDesktopWindowClose(id: string): Promise<DesktopWindowCommandResult>
  xiraniteDesktopWindowGetFrame(id: string): Promise<DesktopWindowFrame | null>
  xiraniteDesktopWindowSetFrame(id: string, frameJSON: string): Promise<DesktopWindowCommandResult>
  xiraniteDesktopBackendConfig(): Promise<DesktopBackendConfig | null>
  xiraniteDesktopBackendRestart(): Promise<DesktopBackendRestartResult>
}

declare global {
  interface Window {
    bindings?: Partial<XiraniteDesktopBindings>
    __XIRANITE_DESKTOP__?: {
      kind?: string
      version?: number
      bridgeUrl?: string
    }
  }
}

export function getDenoDesktopBindings(): XiraniteDesktopBindings | undefined {
  if (typeof window === "undefined") return undefined
  const candidate = window.bindings
  if (typeof candidate?.xiraniteDesktopRuntimeInfo === "function") {
    return candidate as XiraniteDesktopBindings
  }

  const bridgeUrl = window.__XIRANITE_DESKTOP__?.kind === "deno-desktop"
    ? window.__XIRANITE_DESKTOP__.bridgeUrl
    : new URLSearchParams(window.location.search).get("__xiranite_desktop_bridge") ?? undefined
  return bridgeUrl ? createHttpBindings(bridgeUrl) : undefined
}

function createHttpBindings(bridgeUrl: string): XiraniteDesktopBindings {
  const call = async <T>(name: string, args: unknown[] = []): Promise<T> => {
    const response = await fetch(bridgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, args }),
    })
    const payload = await response.json() as { ok?: boolean; value?: T; error?: string }
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Deno Desktop bridge request failed (${response.status}).`)
    return payload.value as T
  }

  return {
    xiraniteDesktopRuntimeInfo: () => call(DENO_DESKTOP_BINDING_NAMES.runtimeInfo),
    xiraniteDesktopWindowControl: (action) => call(DENO_DESKTOP_BINDING_NAMES.windowControl, [action]),
    xiraniteDesktopWindowOpen: (inputJSON) => call(DENO_DESKTOP_BINDING_NAMES.windowOpen, [inputJSON]),
    xiraniteDesktopWindowFocus: (id) => call(DENO_DESKTOP_BINDING_NAMES.windowFocus, [id]),
    xiraniteDesktopWindowClose: (id) => call(DENO_DESKTOP_BINDING_NAMES.windowClose, [id]),
    xiraniteDesktopWindowGetFrame: (id) => call(DENO_DESKTOP_BINDING_NAMES.windowGetFrame, [id]),
    xiraniteDesktopWindowSetFrame: (id, frameJSON) => call(DENO_DESKTOP_BINDING_NAMES.windowSetFrame, [id, frameJSON]),
    xiraniteDesktopBackendConfig: () => call(DENO_DESKTOP_BINDING_NAMES.backendConfig),
    xiraniteDesktopBackendRestart: () => call(DENO_DESKTOP_BINDING_NAMES.backendRestart),
  }
}

export function detectDenoDesktop(): boolean {
  return getDenoDesktopBindings() !== undefined
}
