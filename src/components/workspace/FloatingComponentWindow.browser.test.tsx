import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"

const mocks = vi.hoisted(() => ({
  moduleId: "scratch",
  nativeWindowControls: false,
  controlMain: vi.fn(),
  controlComponent: vi.fn().mockResolvedValue({ success: true, supported: true }),
  closeComponent: vi.fn().mockResolvedValue({ success: true, supported: true }),
  ensureComponent: vi.fn(),
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
    controlComponent: mocks.controlComponent,
    controlComponentPending: false,
    closeComponent: mocks.closeComponent,
  }),
}))

vi.mock("@/store/workspaceStore", () => ({
  useWorkspaceActions: () => ({ ensureComponent: mocks.ensureComponent }),
  useWorkspaceComponent: () => ({
    id: "component-1",
    moduleId: mocks.moduleId,
    state: "floating",
  }),
  useWorkspaceShallowSelector: (selector: (state: Record<string, unknown>) => unknown) => selector({
    activeCustomThemeName: null,
    activeWorkspaceId: "workspace-1",
    floatingWindowCaptionAutoCollapse: true,
    floatingWindowCaptionPosition: "right",
    floatingWindowCaptionStyle: "windows",
    theme: "spatial",
    zCounter: 1,
  }),
}))

vi.mock("@/components/modules/nodeWindowPreferences", () => ({
  loadNodeMaximizeAction: vi.fn().mockResolvedValue("maximize"),
}))

vi.mock("@/components/modules/ModuleRenderer", () => ({
  ModuleRenderer: () => <div data-testid="floating-module-renderer">Rendered node</div>,
}))

import { FloatingComponentWindow } from "./FloatingComponentWindow"

afterEach(() => {
  cleanup()
  mocks.moduleId = "scratch"
  mocks.nativeWindowControls = false
  mocks.controlMain.mockClear()
  mocks.controlComponent.mockClear()
  mocks.closeComponent.mockClear()
  mocks.ensureComponent.mockClear()
})

test("minimizes and closes the owning component window without invoking main controls", async () => {
  mocks.moduleId = "scratch"
  mocks.nativeWindowControls = true
  await render(<FloatingComponentWindow compId="component-1" windowId="component-component-1" />)

  const minimize = document.querySelector<HTMLElement>('[data-window-control-action="minimize"]')
  const close = document.querySelector<HTMLElement>('[data-window-control-action="close"]')
  expect(minimize).not.toBeNull()
  expect(close).not.toBeNull()

  await page.elementLocator(minimize!).click()
  await page.elementLocator(close!).click()

  await expect.poll(() => mocks.controlComponent.mock.calls).toEqual([
    ["component-component-1", "minimize"],
    ["component-component-1", "close"],
  ])
  expect(mocks.controlMain).not.toHaveBeenCalled()
  expect(mocks.closeComponent).not.toHaveBeenCalled()
})
