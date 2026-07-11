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
  }
}

export function getDenoDesktopBindings(): XiraniteDesktopBindings | undefined {
  if (typeof window === "undefined") return undefined
  const candidate = window.bindings
  return typeof candidate?.xiraniteDesktopRuntimeInfo === "function"
    ? candidate as XiraniteDesktopBindings
    : undefined
}

export function detectDenoDesktop(): boolean {
  return getDenoDesktopBindings() !== undefined
}
