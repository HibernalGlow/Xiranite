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
    return toWindowCommandResult(await requireBindings().xiraniteDesktopWindowOpen(JSON.stringify(input)))
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
