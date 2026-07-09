// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { OverlayHost } from "./OverlayHost"

const setOverlayMock = vi.hoisted(() => vi.fn())
const setOverlayModeMock = vi.hoisted(() => vi.fn())
const setOverlayWidthMock = vi.hoisted(() => vi.fn())
const overlayState = vi.hoisted(() => ({
  value: null as null | "registry" | "settings" | "operations" | "history",
  mode: "docked" as "docked" | "floating",
  width: 440,
}))
const moduleLoadCounts = vi.hoisted(() => ({
  registry: vi.fn(),
  settings: vi.fn(),
  operations: vi.fn(),
  history: vi.fn(),
}))

vi.mock("@/store/workspaceContext", () => ({
  useWorkspaceActions: () => ({
    setOverlay: setOverlayMock,
    setOverlayMode: setOverlayModeMock,
    setOverlayWidth: setOverlayWidthMock,
  }),
  useWorkspaceSelector: (selector: (state: {
    overlay: typeof overlayState.value
    overlayMode: typeof overlayState.mode
    overlayWidth: typeof overlayState.width
  }) => unknown) =>
    selector({
      overlay: overlayState.value,
      overlayMode: overlayState.mode,
      overlayWidth: overlayState.width,
    }),
}))

vi.mock("@/components/views/ModuleRegistry", () => {
  moduleLoadCounts.registry()
  return { ModuleRegistry: () => <div data-testid="registry-view">Registry view</div> }
})

vi.mock("@/components/views/ThemeSettings", () => {
  moduleLoadCounts.settings()
  return { ThemeSettings: () => <div data-testid="settings-view">Settings view</div> }
})

vi.mock("@/components/views/NodeOperationMonitor", () => {
  moduleLoadCounts.operations()
  return { NodeOperationMonitor: () => <div data-testid="operations-view">Operations view</div> }
})

vi.mock("@/components/views/NodeRunHistoryView", () => {
  moduleLoadCounts.history()
  return { NodeRunHistoryView: () => <div data-testid="history-view">History view</div> }
})

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

beforeEach(() => {
  overlayState.value = null
  overlayState.mode = "docked"
  overlayState.width = 440
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("OverlayHost", () => {
  test("keeps overlay views unloaded while the overlay is closed", () => {
    render(<OverlayHost />)

    expect(screen.queryByTestId("workspace-push-panel")).toBeNull()
    expect(screen.queryByTestId("registry-view")).toBeNull()
    expect(moduleLoadCounts.registry).not.toHaveBeenCalled()
    expect(moduleLoadCounts.settings).not.toHaveBeenCalled()
    expect(moduleLoadCounts.operations).not.toHaveBeenCalled()
    expect(moduleLoadCounts.history).not.toHaveBeenCalled()
  })

  test("loads only the active overlay view", async () => {
    overlayState.value = "registry"

    render(<OverlayHost />)

    expect(await screen.findByTestId("registry-view")).toBeTruthy()
    expect(screen.getByTestId("workspace-push-panel")).toBeTruthy()
    expect(screen.getByTestId("workspace-push-panel").getAttribute("data-overlay-mode")).toBe("docked")
    expect(moduleLoadCounts.registry).toHaveBeenCalledTimes(1)
    expect(moduleLoadCounts.settings).not.toHaveBeenCalled()
    expect(moduleLoadCounts.operations).not.toHaveBeenCalled()
    expect(moduleLoadCounts.history).not.toHaveBeenCalled()
  })

  test("renders floating mode and custom width from the store", async () => {
    overlayState.value = "registry"
    overlayState.mode = "floating"
    overlayState.width = 560

    render(<OverlayHost />)

    const panel = await screen.findByTestId("workspace-push-panel")
    expect(panel.getAttribute("data-overlay-mode")).toBe("floating")
    expect(panel.style.width).toBe("560px")
    expect(screen.getByTestId("workspace-overlay-backdrop")).toBeTruthy()
  })
})
