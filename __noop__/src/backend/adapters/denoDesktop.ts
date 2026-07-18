import {
  detectDenoDesktop,
  getDenoDesktopBindings,
  type DesktopWindowCommandResult,
} from "../../../desktop/bridge"
import type {
  MainWindowAction,
  OpenComponentWindowInput,
  RuntimeInterface,
  WindowCapabilities,
  WindowCommandResult,
  WindowFrame,
  WindowRuntime,
} from "../runtime/runtime"
import { createWebRuntime } from "./web"

function requireBindings() {
  const bindings = getDenoDesktopBindings()
  if (!bindings) throw new Error("Deno Desktop bindings are unavailable.")
  return bindings
}

function toWindowCommandResult(result: DesktopWindowCommandResult): WindowCommandResult {
  return result
}

class DenoDesktopWindowRuntime implements WindowRuntime {
  async getCapabilities(): Promise<WindowCapabilities> {
    return (await requireBindings().xiraniteDesktopRuntimeInfo()).capabilities
  }

  async controlMain(action: MainWindowAction): Promise<WindowCommandResult> {
    return toWindowCommandResult(await requireBindings().xiraniteDesktopWindowControl(action))
  }

  async openComponent(input: OpenComponentWindowInput): Promise<WindowCommandResult> {
    const result = toWindowCommandResult(await requireBindings().xiraniteDesktopWindowOpen(JSON.stringify(input)))
    if (result.success || result.supported === false || typeof window === "undefined") return result

    const url = new URL(window.location.href)
    url.searchParams.set("floatingComponent", input.componentId)
    url.searchParams.set("moduleId", input.moduleId)
    url.searchParams.set("windowId", input.componentId)
    if (input.title) url.searchParams.set("title", input.title)
    const popup = window.open(
      url.toString(),
      `xiranite-component-${input.componentId}`,
      `popup,width=${input.width ?? 460},height=${input.height ?? 380}`,
    )
    return popup
      ? { success: true, supported: true, id: input.componentId, message: "Opened component in a browser popup." }
      : { success: false, supported: true, message: "Browser blocked the component popup." }
  }

  async focus(id: string): Promise<WindowCommandResult> {
    return toWindowCommandResult(await requireBindings().xiraniteDesktopWindowFocus(id))
  }

  async close(id: string): Promise<WindowCommandResult> {
    return toWindowCommandResult(await requireBindings().xiraniteDesktopWindowClose(id))
  }

  async getFrame(id?: string): Promise<WindowFrame | null> {
    return await requireBindings().xiraniteDesktopWindowGetFrame(id ?? "")
  }

  async setFrame(frame: WindowFrame, id?: string): Promise<WindowCommandResult> {
    return toWindowCommandResult(await requireBindings().xiraniteDesktopWindowSetFrame(id ?? "", JSON.stringify(frame)))
  }
}

export function createDenoDesktopRuntime(): RuntimeInterface {
  const webFallback = createWebRuntime()
  return {
    ...webFallback,
    kind: "deno-desktop",
    windows: new DenoDesktopWindowRuntime(),
  }
}

export { detectDenoDesktop }
