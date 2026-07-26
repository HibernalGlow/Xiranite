import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { ReactNode } from "react"

const mocks = vi.hoisted(() => ({
  moduleId: "melodeck",
  ensureComponent: vi.fn(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/hooks/useWindowControls", () => ({
  useWindowControls: () => ({
    capabilities: { nativeWindowControls: false },
    controlMain: vi.fn().mockResolvedValue({ success: true, supported: true }),
    controlMainPending: false,
    closeComponent: vi.fn().mockResolvedValue({ success: true, supported: true }),
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

vi.mock("./WorkspaceMelodeck", () => ({
  WorkspaceMelodeckProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="workspace-melodeck-provider">{children}</div>
  ),
}))

import { FloatingComponentWindow } from "./FloatingComponentWindow"

afterEach(() => {
  cleanup()
  mocks.moduleId = "melodeck"
  mocks.ensureComponent.mockClear()
})

test("wraps a floating Melo deck node in the shared player provider", async () => {
  await render(<FloatingComponentWindow compId="component-1" />)

  const provider = page.getByTestId("workspace-melodeck-provider")
  const node = page.getByTestId("floating-module-renderer")
  await expect.element(provider).toBeVisible()
  await expect.element(node).toBeVisible()
  expect(provider.element().contains(node.element())).toBe(true)
})

test("does not load the Melo deck provider for unrelated floating nodes", async () => {
  mocks.moduleId = "scratch"
  await render(<FloatingComponentWindow compId="component-1" />)

  await expect.element(page.getByTestId("floating-module-renderer")).toBeVisible()
  expect(document.querySelector('[data-testid="workspace-melodeck-provider"]')).toBeNull()
})
