// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FlowView } from "./FlowView"
import { XIRANITE_MODULE_MIME } from "@/lib/moduleDragDrop"
import type { ComponentInstance } from "@/types/workspace"

const setOverlayMock = vi.hoisted(() => vi.fn())
const deployComponentMock = vi.hoisted(() => vi.fn())
const visibleComponentsMock = vi.hoisted(() => vi.fn<() => ComponentInstance[]>(() => []))

vi.mock("@/store/workspaceContext", () => ({
  useWorkspaceActions: () => ({ setOverlay: setOverlayMock, deployComponent: deployComponentMock }),
  useWorkspaceVisibleComponents: visibleComponentsMock,
}))

vi.mock("./FlowCanvasView", () => ({
  FlowCanvasView: () => <div data-testid="mock-flow-canvas">Mock flow canvas</div>,
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "view:flow.empty") return "// flow canvas is empty"
      if (key === "view:flow.openRegistry") return "OPEN MODULE REGISTRY"
      if (key === "view:flow.loadCanvas") return "Open flow canvas"
      if (key === "view:flow.loadingCanvas") return "Loading flow canvas"
      if (key === "registry:dropHint") return "Drop to deploy here"
      return key
    },
  }),
}))

type IdleTestWindow = Window & {
  requestIdleCallback?: unknown
  cancelIdleCallback?: unknown
}

const idleWindow = window as IdleTestWindow
const originalRequestIdleCallback = idleWindow.requestIdleCallback
const originalCancelIdleCallback = idleWindow.cancelIdleCallback

const flowComponent = {
  id: "comp-flow-test",
  moduleId: "scratch",
  workspaceId: "ws-flow-test",
  data: {},
  state: "docked",
  hiddenIn: { flow: false },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
} as ComponentInstance

beforeEach(() => {
  visibleComponentsMock.mockReturnValue([])
  Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: undefined })
  Object.defineProperty(window, "cancelIdleCallback", { configurable: true, value: undefined })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: originalRequestIdleCallback })
  Object.defineProperty(window, "cancelIdleCallback", { configurable: true, value: originalCancelIdleCallback })
  vi.clearAllMocks()
})

describe("FlowView", () => {
  test("renders the empty state without loading the tldraw canvas", () => {
    render(<FlowView />)

    expect(screen.getByText("// flow canvas is empty")).toBeTruthy()
    expect(screen.getByRole("button", { name: "OPEN MODULE REGISTRY" })).toBeTruthy()
    expect(screen.queryByTestId("mock-flow-canvas")).toBeNull()
  })

  test("renders a lightweight shell before loading the flow canvas on idle", async () => {
    visibleComponentsMock.mockReturnValue([flowComponent])

    render(<FlowView />)

    expect(screen.queryByTestId("mock-flow-canvas")).toBeNull()
    expect(screen.getByRole("button", { name: "Open flow canvas" })).toBeTruthy()

    expect(await screen.findByTestId("mock-flow-canvas")).toBeTruthy()
  })

  test("loads the flow canvas immediately when the shell is activated", async () => {
    const user = userEvent.setup()
    visibleComponentsMock.mockReturnValue([flowComponent])

    render(<FlowView />)

    await user.click(screen.getByRole("button", { name: "Open flow canvas" }))

    expect(await screen.findByTestId("mock-flow-canvas")).toBeTruthy()
  })

  test("deploys a dropped module into the flow view near the pointer", () => {
    render(<FlowView />)

    const target = screen.getByTestId("flow-drop-target")
    target.getBoundingClientRect = vi.fn(() => ({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 810,
      bottom: 620,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    } as DOMRect))

    const dataTransfer = createDataTransfer("scratch")

    fireEvent.dragEnter(target, { dataTransfer })
    expect(screen.getByText("Drop to deploy here")).toBeTruthy()
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, "dataTransfer", { value: dataTransfer })
    Object.defineProperty(dropEvent, "clientX", { value: 402 })
    Object.defineProperty(dropEvent, "clientY", { value: 260 })
    fireEvent(target, dropEvent)

    expect(deployComponentMock).toHaveBeenCalledWith("scratch", {
      viewMode: "flow",
      flowPosition: { x: 200, y: 80 },
    })
  })

  test("deploys through the temporary drop shield over the canvas", () => {
    render(<FlowView />)

    const target = screen.getByTestId("flow-drop-target")
    const rect = {
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 810,
      bottom: 620,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    } as DOMRect
    target.getBoundingClientRect = vi.fn(() => rect)

    const dataTransfer = createDataTransfer("enginev")
    fireEvent.dragEnter(target, { dataTransfer })

    const shield = screen.getByTestId("flow-drop-shield")
    shield.getBoundingClientRect = vi.fn(() => rect)

    const dropEvent = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, "dataTransfer", { value: dataTransfer })
    Object.defineProperty(dropEvent, "clientX", { value: 600 })
    Object.defineProperty(dropEvent, "clientY", { value: 420 })
    fireEvent(shield, dropEvent)

    expect(deployComponentMock).toHaveBeenCalledTimes(1)
    expect(deployComponentMock).toHaveBeenCalledWith("enginev", {
      viewMode: "flow",
      flowPosition: { x: 398, y: 240 },
    })
  })
})

function createDataTransfer(moduleId: string) {
  return {
    types: [XIRANITE_MODULE_MIME],
    dropEffect: "copy",
    effectAllowed: "copy",
    getData: vi.fn((type: string) => {
      if (type === XIRANITE_MODULE_MIME) return JSON.stringify({ moduleId })
      if (type === "text/plain") return moduleId
      return ""
    }),
    setData: vi.fn(),
  }
}
