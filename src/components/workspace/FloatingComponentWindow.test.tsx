import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { FloatingComponentWindow } from "./FloatingComponentWindow"

const mocks = vi.hoisted(() => ({
  nativeWindowControls: false,
  ensureComponent: vi.fn(),
  controlMain: vi.fn().mockResolvedValue({ success: true, supported: true }),
  closeComponent: vi.fn().mockResolvedValue({ success: true, supported: true }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/hooks/useWindowControls", () => ({
  useWindowControls: () => ({
    capabilities: {
      supported: true,
      nativeWindowControls: mocks.nativeWindowControls,
      frameless: mocks.nativeWindowControls,
      componentWindows: mocks.nativeWindowControls ? "native" : "browser-popup",
    },
    controlMain: mocks.controlMain,
    controlMainPending: false,
    closeComponent: mocks.closeComponent,
  }),
}))

vi.mock("@/store/workspaceStore", () => ({
  useWorkspaceActions: () => ({ ensureComponent: mocks.ensureComponent }),
  useWorkspaceComponent: () => ({
    id: "component-1",
    moduleId: "scratch",
    state: "floating",
  }),
  useWorkspaceShallowSelector: (selector: (state: Record<string, unknown>) => unknown) => selector({
    activeCustomThemeName: null,
    activeWorkspaceId: "workspace-1",
    theme: "spatial",
    zCounter: 1,
  }),
}))

vi.mock("@/components/modules/nodeWindowPreferences", () => ({
  loadNodeMaximizeAction: vi.fn().mockResolvedValue("maximize"),
}))

vi.mock("@/components/modules/ModuleRenderer", async () => {
  const { FloatingWindowCaptionControls } = await import("./FloatingWindowFrame")
  return {
    ModuleRenderer: () => (
      <div data-testid="module-renderer">
        <FloatingWindowCaptionControls integrated />
      </div>
    ),
  }
})

afterEach(() => {
  cleanup()
  mocks.nativeWindowControls = false
})

describe("FloatingComponentWindow", () => {
  test("uses browser chrome without rendering internal window controls on the web", () => {
    render(<FloatingComponentWindow compId="component-1" />)

    expect(screen.getByTestId("module-renderer")).toBeTruthy()
    expect(screen.queryByTestId("floating-window-integrated-controls")).toBeNull()
    expect(screen.queryByTestId("floating-window-fallback-controls")).toBeNull()
    expect(screen.queryByTestId("floating-window-fallback-drag-region")).toBeNull()
  })

  test("provides integrated window controls to native frameless windows", async () => {
    mocks.nativeWindowControls = true

    render(<FloatingComponentWindow compId="component-1" />)

    expect(await screen.findByTestId("floating-window-integrated-controls")).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId("floating-window-fallback-controls")).toBeNull())
  })
})
