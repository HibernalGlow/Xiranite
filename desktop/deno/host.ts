import type {
  DesktopMainWindowAction,
  DesktopOpenComponentWindowInput,
  DesktopRuntimeInfo,
  DesktopWindowCommandResult,
  DesktopWindowFrame,
} from "../bridge.ts"
import { BackendSupervisor } from "./backend-supervisor.ts"

const runtimeInfo: DesktopRuntimeInfo = {
  kind: "deno-desktop",
  version: 1,
  capabilities: {
    supported: true,
    nativeWindowControls: false,
    frameless: false,
    componentWindows: "native",
    message: "Deno Desktop 2.9 uses system title bars until native minimize/maximize and drag-region APIs are available.",
  },
}

export class XiraniteDesktopHost {
  #windows = new Map<string, Deno.BrowserWindow>()
  #ids = new Map<number, string>()
  #nextWindowID = 0

  constructor(
    private readonly backend: BackendSupervisor,
    private readonly frontendBaseUrl: string,
    private readonly onAllWindowsClosed: () => void,
  ) {}

  createMainWindow(): Deno.BrowserWindow {
    const window = new Deno.BrowserWindow({
      title: "Xiranite",
      width: 1280,
      height: 820,
      resizable: true,
      frameless: false,
    })
    this.#register("main", window)
    window.navigate(new URL("/", ensureTrailingSlash(this.frontendBaseUrl)).href)
    window.show()
    window.focus()
    return window
  }

  #register(id: string, window: Deno.BrowserWindow): void {
    this.#windows.set(id, window)
    this.#ids.set(window.windowId, id)
    this.#installBindings(window)
    window.addEventListener("close", () => {
      this.#windows.delete(id)
      this.#ids.delete(window.windowId)
      queueMicrotask(() => {
        if (this.#windows.size === 0) this.onAllWindowsClosed()
      })
    })
  }

  #installBindings(window: Deno.BrowserWindow): void {
    window.bind("xiraniteDesktopRuntimeInfo", async () => bridgeValue(runtimeInfo))
    window.bind("xiraniteDesktopWindowControl", async (action) => {
      return bridgeValue(this.#controlWindow(window, String(action) as DesktopMainWindowAction))
    })
    window.bind("xiraniteDesktopWindowOpen", async (inputJSON) => {
      return bridgeValue(this.#openComponent(parseJSON<DesktopOpenComponentWindowInput>(inputJSON, "component window input")))
    })
    window.bind("xiraniteDesktopWindowFocus", async (id) => bridgeValue(this.#focus(String(id))))
    window.bind("xiraniteDesktopWindowClose", async (id) => bridgeValue(this.#close(String(id))))
    window.bind("xiraniteDesktopWindowGetFrame", async (id) => {
      return bridgeValue(this.#getFrame(String(id), window))
    })
    window.bind("xiraniteDesktopWindowSetFrame", async (id, frameJSON) => {
      const frame = parseJSON<DesktopWindowFrame>(frameJSON, "window frame")
      return bridgeValue(this.#setFrame(String(id), frame, window))
    })
    window.bind("xiraniteDesktopBackendConfig", async () => bridgeValue(this.backend.config ?? null))
    window.bind("xiraniteDesktopBackendRestart", async () => bridgeValue(await this.backend.restart()))
  }

  #controlWindow(window: Deno.BrowserWindow, action: DesktopMainWindowAction): DesktopWindowCommandResult {
    if (action === "close") {
      window.close()
      return { success: true, supported: true, message: "Window closed.", state: "closed" }
    }
    return {
      success: false,
      supported: false,
      message: `Deno Desktop 2.9 does not expose a native ${action} window API. Use the system title bar.`,
    }
  }

  #openComponent(input: DesktopOpenComponentWindowInput): DesktopWindowCommandResult {
    if (!input.componentId || !input.moduleId) {
      return { success: false, supported: true, message: "componentId and moduleId are required." }
    }

    const id = `component-${Date.now()}-${++this.#nextWindowID}`
    const title = input.title?.trim() || input.moduleId
    const target = new URL("/", ensureTrailingSlash(this.frontendBaseUrl))
    target.searchParams.set("floatingComponent", input.componentId)
    target.searchParams.set("moduleId", input.moduleId)
    target.searchParams.set("title", title)
    target.searchParams.set("windowId", id)

    const window = new Deno.BrowserWindow({
      title,
      width: positiveOr(input.width, 460),
      height: positiveOr(input.height, 380),
      resizable: true,
      frameless: false,
    })
    this.#register(id, window)
    window.navigate(target.href)

    return { success: true, supported: true, id, message: "Opened component in a Deno Desktop native window." }
  }

  #focus(id: string): DesktopWindowCommandResult {
    const window = this.#windows.get(id)
    if (!window) return missingWindow(id)
    window.show()
    window.focus()
    return { success: true, supported: true, id, message: "Window focused." }
  }

  #close(id: string): DesktopWindowCommandResult {
    const window = this.#windows.get(id)
    if (!window) return missingWindow(id)
    window.close()
    return { success: true, supported: true, id, message: "Window closed.", state: "closed" }
  }

  #getFrame(id: string, caller: Deno.BrowserWindow): DesktopWindowFrame | null {
    const window = id ? this.#windows.get(id) : caller
    if (!window) return null
    const [x, y] = window.getPosition()
    const [width, height] = window.getSize()
    return { x, y, width, height }
  }

  #setFrame(id: string, frame: DesktopWindowFrame, caller: Deno.BrowserWindow): DesktopWindowCommandResult {
    const window = id ? this.#windows.get(id) : caller
    const windowID = id || this.#ids.get(caller.windowId)
    if (!window) return missingWindow(id)
    if (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) || frame.width <= 0 || frame.height <= 0) {
      return { success: false, supported: true, id: windowID, message: "Window frame is invalid." }
    }
    window.setPosition(Math.round(frame.x), Math.round(frame.y))
    window.setSize(Math.round(frame.width), Math.round(frame.height))
    return { success: true, supported: true, id: windowID, message: "Window frame updated." }
  }
}

function bridgeValue(value: unknown): any {
  return value
}

function parseJSON<T>(value: unknown, label: string): T {
  if (typeof value !== "string") throw new TypeError(`${label} must be encoded as JSON.`)
  try {
    return JSON.parse(value) as T
  } catch (error) {
    throw new TypeError(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function missingWindow(id: string): DesktopWindowCommandResult {
  return { success: false, supported: true, id, message: "Window is not tracked." }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}
