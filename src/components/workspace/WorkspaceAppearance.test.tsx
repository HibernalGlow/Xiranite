// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, waitFor } from "@testing-library/react"
import { useWorkspaceStore } from "@/store/workspaceStore"
import { WorkspaceAppearance } from "./WorkspaceAppearance"

const themeState = vi.hoisted(() => ({ theme: "light" as "light" | "dark" | "system" }))
vi.mock("@/components/use-theme", () => ({ useTheme: () => themeState }))

afterEach(() => {
  cleanup()
  themeState.theme = "light"
  useWorkspaceStore.getState().setCustomThemes([])
  useWorkspaceStore.getState().setTheme("spatial")
  document.documentElement.removeAttribute("style")
  document.documentElement.removeAttribute("data-custom-theme")
})

describe("workspace appearance mode assignments", () => {
  test("applies the shared scrollbar display preference on the document root", async () => {
    useWorkspaceStore.getState().setScrollbarDisplayStyle("rounded")
    render(<WorkspaceAppearance />)
    await waitFor(() => expect(document.documentElement.dataset.scrollbarStyle).toBe("rounded"))
  })

  test("switches the existing theme choice between independent light and dark assignments", async () => {
    const actions = useWorkspaceStore.getState()
    actions.setCustomThemes([{
      name: "Imported dark",
      cssVars: {
        light: { primary: "oklch(0.5 0.1 120)" },
        dark: { primary: "oklch(0.72 0.12 250)" },
      },
    }])
    actions.setThemeSelection("light", { kind: "preset", name: "wuling" })
    actions.setThemeSelection("dark", { kind: "custom", name: "Imported dark" })

    const view = render(<WorkspaceAppearance />)
    await waitFor(() => expect(document.documentElement.dataset.appTheme).toBe("wuling"))
    expect(document.documentElement.dataset.customTheme).toBeUndefined()

    themeState.theme = "dark"
    view.rerender(<WorkspaceAppearance />)
    await waitFor(() => expect(document.documentElement.dataset.customThemeName).toBe("Imported dark"))
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("oklch(0.72 0.12 250)")
  })
})
