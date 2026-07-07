// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { OverlayHost } from "./OverlayHost"

const setOverlayMock = vi.hoisted(() => vi.fn())
const overlayState = vi.hoisted(() => ({ value: null as null | "registry" | "settings" | "deployment" | "operations" }))
const moduleLoadCounts = vi.hoisted(() => ({
  registry: vi.fn(),
  settings: vi.fn(),
  deployment: vi.fn(),
  operations: vi.fn(),
}))

vi.mock("@/store/workspaceContext", () => ({
  useWorkspaceActions: () => ({ setOverlay: setOverlayMock }),
  useWorkspaceSelector: (selector: (state: { overlay: typeof overlayState.value }) => unknown) =>
    selector({ overlay: overlayState.value }),
}))

vi.mock("@/components/views/ModuleRegistry", () => {
  moduleLoadCounts.registry()
  return { ModuleRegistry: () => <div data-testid="registry-view">Registry view</div> }
})

vi.mock("@/components/views/ThemeSettings", () => {
  moduleLoadCounts.settings()
  return { ThemeSettings: () => <div data-testid="settings-view">Settings view</div> }
})

vi.mock("@/components/views/DeploymentHub", () => {
  moduleLoadCounts.deployment()
  return { DeploymentHub: () => <div data-testid="deployment-view">Deployment view</div> }
})

vi.mock("@/components/views/NodeOperationMonitor", () => {
  moduleLoadCounts.operations()
  return { NodeOperationMonitor: () => <div data-testid="operations-view">Operations view</div> }
})

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

beforeEach(() => {
  overlayState.value = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("OverlayHost", () => {
  test("keeps overlay views unloaded while the overlay is closed", () => {
    render(<OverlayHost />)

    expect(screen.queryByTestId("registry-view")).toBeNull()
    expect(moduleLoadCounts.registry).not.toHaveBeenCalled()
    expect(moduleLoadCounts.settings).not.toHaveBeenCalled()
    expect(moduleLoadCounts.deployment).not.toHaveBeenCalled()
    expect(moduleLoadCounts.operations).not.toHaveBeenCalled()
  })

  test("loads only the active overlay view", async () => {
    overlayState.value = "registry"

    render(<OverlayHost />)

    expect(await screen.findByTestId("registry-view")).toBeTruthy()
    expect(moduleLoadCounts.registry).toHaveBeenCalledTimes(1)
    expect(moduleLoadCounts.settings).not.toHaveBeenCalled()
    expect(moduleLoadCounts.deployment).not.toHaveBeenCalled()
    expect(moduleLoadCounts.operations).not.toHaveBeenCalled()
  })
})
