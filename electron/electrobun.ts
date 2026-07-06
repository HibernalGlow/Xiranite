import { BrowserWindow } from "electrobun"
import type {
  MainWindowDragInput,
  MainWindowAction,
  OpenComponentWindowInput,
  WindowCommandResult,
  WindowFrame,
  WindowHost,
} from "./runtimeBridge.ts"
import { startRuntimeBridge, stopRuntimeBridge } from "./runtimeBridge.ts"

type XiraniteWindow = {
  id: number
  close(): unknown
  activate(): unknown
  minimize(): unknown
  maximize(): unknown
  unmaximize(): unknown
  isMaximized(): boolean
  getFrame(): WindowFrame
  setFrame(x: number, y: number, width: number, height: number): unknown
}

const componentWindows = new Map<string, XiraniteWindow>()
const DEFAULT_MAIN_FRAME: WindowFrame = { x: 96, y: 72, width: 1280, height: 820 }
let mainWindow: XiraniteWindow | null = null
let lastNormalMainFrame: WindowFrame = { ...DEFAULT_MAIN_FRAME }
let makeAppUrl: (params?: Record<string, string>) => string = () => {
  throw new Error("Runtime bridge is not ready.")
}

function commandResult(
  success: boolean,
  supported: boolean,
  message: string,
  id?: string,
  state?: WindowCommandResult["state"],
): WindowCommandResult {
  return { success, supported, message, id, state }
}

function openWindow(title: string, url: string, width: number, height: number): XiraniteWindow {
  return new BrowserWindow({
    title,
    frame: { x: 96, y: 72, width, height },
    url,
    titleBarStyle: "hiddenInset",
    transparent: false,
    hidden: false,
    activate: true,
    renderer: "native",
    sandbox: false,
  }) as XiraniteWindow
}

function safeGetFrame(win: XiraniteWindow): WindowFrame | null {
  try {
    return win.getFrame()
  } catch {
    return null
  }
}

function sanitizeFrame(frame: WindowFrame | null): WindowFrame {
  if (!frame) return { ...DEFAULT_MAIN_FRAME }
  const width = Number.isFinite(frame.width) && frame.width >= 480 ? frame.width : DEFAULT_MAIN_FRAME.width
  const height = Number.isFinite(frame.height) && frame.height >= 320 ? frame.height : DEFAULT_MAIN_FRAME.height
  const x = Number.isFinite(frame.x) ? frame.x : DEFAULT_MAIN_FRAME.x
  const y = Number.isFinite(frame.y) ? frame.y : DEFAULT_MAIN_FRAME.y
  return { x, y, width, height }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function controlMainWindow(action: MainWindowAction): WindowCommandResult {
  if (!mainWindow) return commandResult(false, true, "Main window is not ready.")

  if (action === "minimize") {
    mainWindow.minimize()
    return commandResult(true, true, "Main window minimized.", undefined, "minimized")
  }
  if (action === "maximize") {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
      return commandResult(true, true, "Main window restored.", undefined, "normal")
    }
    lastNormalMainFrame = sanitizeFrame(safeGetFrame(mainWindow))
    mainWindow.maximize()
    return commandResult(true, true, "Main window maximized.", undefined, "maximized")
  }
  if (action === "restore") {
    mainWindow.unmaximize()
    return commandResult(true, true, "Main window restored.", undefined, "normal")
  }
  if (action === "close") {
    mainWindow.close()
    stopRuntimeBridge()
    setTimeout(() => process.exit(0), 50)
    return commandResult(true, true, "Main window closed.", undefined, "closed")
  }

  return commandResult(false, false, `Unknown main window action "${action}".`)
}

function restoreMainForDrag(input: MainWindowDragInput): WindowCommandResult {
  if (!mainWindow) return commandResult(false, true, "Main window is not ready.")
  if (!mainWindow.isMaximized()) return commandResult(true, true, "Main window is already restored.", undefined, "normal")

  const restoreFrame = sanitizeFrame(lastNormalMainFrame)
  const maximizedFrame = sanitizeFrame(safeGetFrame(mainWindow))
  const currentWidth = input.windowWidth > 0 ? input.windowWidth : maximizedFrame.width
  const cursorRatioX = clamp(input.clientX / Math.max(1, currentWidth), 0.08, 0.92)
  const titlebarOffsetY = clamp(input.clientY, 8, 44)
  const x = Math.round(input.screenX - restoreFrame.width * cursorRatioX)
  const y = Math.max(0, Math.round(input.screenY - titlebarOffsetY))

  mainWindow.unmaximize()
  mainWindow.setFrame(x, y, Math.round(restoreFrame.width), Math.round(restoreFrame.height))
  return commandResult(true, true, "Main window restored for title-bar drag.", undefined, "normal")
}

function getTrackedWindow(id?: string): XiraniteWindow | null {
  if (!id || id === "main") return mainWindow
  return componentWindows.get(id) ?? null
}

function openComponentWindow(input: OpenComponentWindowInput): WindowCommandResult {
  if (!input.componentId || !input.moduleId) {
    return commandResult(false, true, "componentId and moduleId are required.")
  }

  const title = input.title || input.moduleId
  const id = `component-${input.componentId}-${Date.now()}-${Math.round(Math.random() * 1000)}`
  const url = makeAppUrl({
    floatingComponent: input.componentId,
    moduleId: input.moduleId,
    title,
    windowId: id,
    width: String(input.width ?? 460),
    height: String(input.height ?? 380),
  })
  const win = openWindow(title, url, input.width ?? 460, input.height ?? 380)
  componentWindows.set(id, win)
  return commandResult(true, true, `Opened ${input.moduleId} component window.`, id)
}

const nativeWindowHost: WindowHost = {
  getCapabilities: () => ({
    supported: true,
    nativeWindowControls: true,
    frameless: true,
    componentWindows: "native",
    message: "Electrobun native window host is active.",
  }),
  controlMain: controlMainWindow,
  restoreMainForDrag,
  openComponent: openComponentWindow,
  focus: (id) => {
    const win = componentWindows.get(id)
    if (!win) return commandResult(false, false, "Component window is not tracked.", id)
    win.activate()
    return commandResult(true, true, "Component window focused.", id)
  },
  close: (id) => {
    const win = componentWindows.get(id)
    if (!win) return commandResult(false, false, "Component window is not tracked.", id)
    win.close()
    componentWindows.delete(id)
    return commandResult(true, true, "Component window closed.", id)
  },
  getFrame: (id) => getTrackedWindow(id)?.getFrame() ?? null,
  setFrame: (id, frame) => {
    const win = getTrackedWindow(id)
    if (!win) return commandResult(false, false, "Window is not tracked.", id)
    win.setFrame(Math.round(frame.x), Math.round(frame.y), Math.round(frame.width), Math.round(frame.height))
    return commandResult(true, true, "Window frame updated.", id)
  },
}

const bridge = await startRuntimeBridge({
  windowHost: nativeWindowHost,
  autoOpen: false,
})

makeAppUrl = bridge.buildAppUrl
mainWindow = openWindow("Xiranite", bridge.buildAppUrl(), DEFAULT_MAIN_FRAME.width, DEFAULT_MAIN_FRAME.height)
lastNormalMainFrame = { ...DEFAULT_MAIN_FRAME }

process.on("SIGINT", () => {
  stopRuntimeBridge()
  process.exit(0)
})

process.on("SIGTERM", () => {
  stopRuntimeBridge()
  process.exit(0)
})
