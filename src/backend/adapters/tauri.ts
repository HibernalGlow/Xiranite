import { createWebRuntime } from "./web"
import { readTauriInvoke } from "../tauriChannel"
import type {
  ComponentWindowFrameEvent,
  MainWindowAction,
  NativeTraySpec,
  OpenComponentWindowInput,
  RuntimeInterface,
  TrayCapabilities,
  TrayActionEvent,
  TrayMenuItemSpec,
  TrayRuntime,
  WindowCapabilities,
  WindowCommandResult,
  WindowFrame,
  WindowRuntime,
} from "../runtime/runtime"

/**
 * The Tauri runtime adapter: the native window half of the retired Wails bridge.
 *
 * It is deliberately an *overlay* on the web adapter, not a replacement for it. Only `windows` and
 * `trays` are answered natively here; storage, filesystem, subprocess, events and the node runner keep
 * going through the loopback HTTP channel, which is the whole point of ADR-0065 — the desktop face and the
 * browser face share one transport, and the shell contributes the channel plus the window manager and the
 * status item. A method this host cannot serve says so with `supported: false` rather than pretending
 * (`docs/adr/0063` principle: errors are data).
 *
 * The Tauri surface is read structurally, exactly like `tauriChannel.ts` reads `invoke`: there is no
 * `@tauri-apps/api` in the bundle, and `app.withGlobalTauri` is what makes `window.__TAURI__` exist.
 */

/** The event the host forwards when a component window finishes resizing. */
const COMPONENT_FRAME_EVENT = "component-window-frame"

type TauriEventUnlisten = () => Promise<void>

interface TauriEventApi {
  listen?: (event: string, handler: (message: { payload?: unknown }) => void) => Promise<TauriEventUnlisten>
}

function readTauriEvent(webView: unknown): TauriEventApi | undefined {
  return (webView as { __TAURI__?: { event?: TauriEventApi } } | undefined)?.__TAURI__?.event
}

class TauriWindowRuntime implements WindowRuntime {
  private readonly invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  private readonly webView: unknown

  constructor(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>, webView: unknown) {
    this.invoke = invoke
    this.webView = webView
  }

  async getCapabilities(): Promise<WindowCapabilities> {
    return await this.invoke("xiranite_window_capabilities") as WindowCapabilities
  }

  async controlMain(action: MainWindowAction): Promise<WindowCommandResult> {
    return this.control("main", action)
  }

  async controlComponent(id: string, action: MainWindowAction): Promise<WindowCommandResult> {
    return this.control(id, action)
  }

  async openComponent(input: OpenComponentWindowInput): Promise<WindowCommandResult> {
    return await this.invoke("xiranite_open_component_window", { input }) as WindowCommandResult
  }

  async focus(id: string): Promise<WindowCommandResult> {
    return await this.invoke("xiranite_window_focus", { id }) as WindowCommandResult
  }

  async close(id: string): Promise<WindowCommandResult> {
    return await this.invoke("xiranite_window_close", { id }) as WindowCommandResult
  }

  async openDevTools(id?: string): Promise<WindowCommandResult> {
    return await this.invoke("xiranite_window_open_devtools", { id: id ?? "" }) as WindowCommandResult
  }

  async getFrame(id?: string): Promise<WindowFrame | null> {
    const frame = await this.invoke("xiranite_window_get_frame", { id: id ?? "" })
    return (frame ?? null) as WindowFrame | null
  }

  async setFrame(frame: WindowFrame, id?: string): Promise<WindowCommandResult> {
    return await this.invoke("xiranite_window_set_frame", { frame, id: id ?? "" }) as WindowCommandResult
  }

  /**
   * `-webkit-app-region` is a Chromium/Electron property: a Tauri WebView ignores it, so the drag
   * regions the frames mark with `.xiranite-app-region-drag` have to reach `start_dragging` through a
   * command. See `installNativeWindowDragRegion` for the single listener that does that.
   */
  async startDragging(id?: string): Promise<WindowCommandResult> {
    return await this.invoke("xiranite_window_start_dragging", { id: id ?? "" }) as WindowCommandResult
  }

  async subscribeFrameChanges(handler: (event: ComponentWindowFrameEvent) => void): Promise<() => void> {
    const listen = readTauriEvent(this.webView)?.listen
    if (typeof listen !== "function") return () => {}
    const unlisten = await listen(COMPONENT_FRAME_EVENT, (message) => {
      const payload = message.payload as ComponentWindowFrameEvent | undefined
      if (payload && typeof payload.componentId === "string") handler(payload)
    })
    return () => {
      void unlisten()
    }
  }

  private async control(id: string, action: MainWindowAction): Promise<WindowCommandResult> {
    return await this.invoke("xiranite_window_control", { id, action }) as WindowCommandResult
  }
}

/** Event the host emits when a tray menu item is clicked (`tray.rs`'s `TRAY_ACTION_EVENT`). */
const TRAY_ACTION_EVENT = "tray-action"

/**
 * The wire shape `crates/xiranite-desktop/src/tray.rs` deserializes: the coordinator's `icon` becomes
 * `iconDataUrl`, because only the WebView can resolve a bundled asset URL and the host has no HTTP
 * route to the dev server's assets.
 */
interface WireTraySpec {
  id: string
  kind: string
  tooltip: string
  iconDataUrl?: string
  items: WireTrayItem[]
}

interface WireTrayItem {
  id: string
  label: string
  type?: string
  enabled?: boolean
  checked?: boolean
  children?: WireTrayItem[]
}

async function toIconDataUrl(icon: string | undefined): Promise<string | undefined> {
  if (!icon) return undefined
  if (icon.startsWith("data:")) return icon
  const response = await fetch(icon)
  if (!response.ok) throw new Error(`tray icon could not be fetched: ${response.status}`)
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("tray icon could not be read"))
    reader.readAsDataURL(blob)
  })
}

function toWireItem(item: TrayMenuItemSpec): WireTrayItem {
  return {
    id: item.id,
    label: item.label,
    ...(item.type ? { type: item.type } : {}),
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    ...(item.checked === undefined ? {} : { checked: item.checked }),
    ...(item.children ? { children: item.children.map(toWireItem) } : {}),
  }
}

/**
 * The tray half of the retired Wails bridge: the shell owns the NS/status-item, this only describes it.
 * `sync` rejects on a bad spec list (empty/duplicate id, undecodable icon) because the coordinator awaits
 * it and logs — a swallowed error would leave a module believing its tray was installed.
 */
class TauriTrayRuntime implements TrayRuntime {
  private readonly invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  private readonly webView: unknown

  constructor(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>, webView: unknown) {
    this.invoke = invoke
    this.webView = webView
  }

  async getCapabilities(): Promise<TrayCapabilities> {
    return await this.invoke("xiranite_tray_capabilities") as TrayCapabilities
  }

  async setMainEnabled(enabled: boolean): Promise<void> {
    await this.invoke("xiranite_tray_set_main_enabled", { enabled })
  }

  async sync(specs: NativeTraySpec[]): Promise<void> {
    const wire: WireTraySpec[] = []
    for (const spec of specs) {
      const iconDataUrl = await toIconDataUrl(spec.icon)
      wire.push({
        id: spec.id,
        kind: spec.kind,
        tooltip: spec.tooltip,
        ...(iconDataUrl ? { iconDataUrl } : {}),
        items: spec.items.map(toWireItem),
      })
    }
    await this.invoke("xiranite_tray_sync", { specs: wire })
  }

  async subscribe(handler: (event: TrayActionEvent) => void): Promise<() => void> {
    const listen = readTauriEvent(this.webView)?.listen
    if (typeof listen !== "function") return () => {}
    const unlisten = await listen(TRAY_ACTION_EVENT, (message) => {
      const payload = message.payload as TrayActionEvent | undefined
      if (payload && typeof payload.trayId === "string" && typeof payload.itemId === "string") handler(payload)
    })
    return () => {
      void unlisten()
    }
  }
}

/** True when this document is running inside a Tauri host rather than a plain browser tab. */
export function detectTauriRuntime(webView: unknown = typeof window === "undefined" ? undefined : window): boolean {
  return readTauriInvoke(webView) !== undefined
}

export function createTauriRuntime(webView: unknown = typeof window === "undefined" ? undefined : window): RuntimeInterface {
  const invoke = readTauriInvoke(webView)
  if (!invoke) throw new Error("createTauriRuntime requires window.__TAURI__.core.invoke")

  const web = createWebRuntime()
  return {
    ...web,
    // The channel is still HTTP; the native surface is the window manager and the tray. `kind` is what
    // makes `client.ts` ask for capabilities, so it must not stay "web".
    kind: "tauri",
    windows: new TauriWindowRuntime(invoke, webView),
    trays: new TauriTrayRuntime(invoke, webView),
  }
}
