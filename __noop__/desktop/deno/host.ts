import type {
  DesktopRuntimeInfo,
  DesktopWindowCommandResult,
} from "../bridge.ts"
import { DENO_DESKTOP_BINDING_NAMES } from "../bridge.ts"
import { BackendSupervisor } from "./backend-supervisor.ts"
import type { DesktopBridge } from "./static-server.ts"

const runtimeInfo: DesktopRuntimeInfo = {
  kind: "deno-desktop",
  version: 1,
  capabilities: {
    supported: true,
    nativeWindowControls: false,
    frameless: false,
    componentWindows: "browser-popup",
    message: "Windows WebView uses Deno.serve's automatic main window. Native child windows are disabled until Laufey BrowserWindow is stable.",
  },
}

export class XiraniteDesktopHost implements DesktopBridge {
  constructor(private readonly backend: BackendSupervisor) {}

  createMainWindow(): void {
    // Deno.serve owns the initial WebView window. Creating BrowserWindow on
    // Windows currently stalls Laufey, so the main surface must be automatic.
  }

  async dispatch(name: string, args: unknown[]): Promise<unknown> {
    switch (name) {
      case DENO_DESKTOP_BINDING_NAMES.runtimeInfo:
        return runtimeInfo
      case DENO_DESKTOP_BINDING_NAMES.backendConfig:
        return this.backend.config ?? null
      case DENO_DESKTOP_BINDING_NAMES.backendRestart:
        return await this.backend.restart()
      case DENO_DESKTOP_BINDING_NAMES.windowControl:
        return unsupportedWindowCommand(String(args[0] ?? ""), "Main window controls are unavailable for Deno's automatic WebView window.")
      case DENO_DESKTOP_BINDING_NAMES.windowOpen:
        return {
          success: false,
          supported: true,
          message: "Use the browser-popup component fallback for Deno Desktop on Windows.",
        } satisfies DesktopWindowCommandResult
      case DENO_DESKTOP_BINDING_NAMES.windowFocus:
      case DENO_DESKTOP_BINDING_NAMES.windowClose:
      case DENO_DESKTOP_BINDING_NAMES.windowSetFrame:
        return unsupportedWindowCommand(String(args[0] ?? ""), "Native child-window control is unavailable for Deno Desktop on Windows.")
      case DENO_DESKTOP_BINDING_NAMES.windowGetFrame:
        return null
      default:
        throw new Error(`Unknown Deno Desktop bridge binding: ${name}`)
    }
  }

}

function unsupportedWindowCommand(id: string, message: string): DesktopWindowCommandResult {
  return { success: false, supported: false, id: id || undefined, message }
}
