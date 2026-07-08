// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useWorkspaceActions, useWorkspaceShallowSelector } from "./workspaceContext"

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("workspace UI preference persistence", () => {
  test("persists only UI preferences through Zustand persist", async () => {
    localStorage.clear()
    const user = userEvent.setup()

    render(<WorkspacePreferenceProbe />)

    await user.click(screen.getByRole("button", { name: "set persisted prefs" }))
    await waitFor(() => expect(screen.getByTestId("prefs").textContent).toContain("endfield/aestivus/image"))

    const persisted = JSON.parse(localStorage.getItem("xiranite-workspace-ui") ?? "{}") as {
      state?: Record<string, unknown>
    }

    expect(persisted.state?.theme).toBe("endfield")
    expect(persisted.state?.customThemes).toEqual([
      {
        name: "Imported",
        cssVars: {
          light: { primary: "oklch(0.5 0.1 120)" },
          dark: { primary: "oklch(0.7 0.1 120)" },
        },
      },
    ])
    expect(persisted.state?.activeCustomThemeName).toBe("Imported")
    expect(persisted.state?.fontPreset).toBe("aestivus")
    expect(persisted.state?.bgMode).toBe("image")
    expect(persisted.state?.bgOpacity).toBe(55)
    expect(persisted.state?.workspaces).toBeUndefined()
    expect(persisted.state?.components).toBeUndefined()
    expect(localStorage.getItem("xiranite-bg-mode")).toBeNull()

    await user.click(screen.getByRole("button", { name: "reset persisted prefs" }))
  })
})

function WorkspacePreferenceProbe() {
  const prefs = useWorkspaceShallowSelector((state) => ({
    theme: state.theme,
    customThemes: state.customThemes,
    activeCustomThemeName: state.activeCustomThemeName,
    fontPreset: state.fontPreset,
    bgMode: state.bgMode,
    bgOpacity: state.bgOpacity,
  }))
  const workspaceActions = useWorkspaceActions()

  return (
    <div>
      <output data-testid="prefs">{`${prefs.theme}/${prefs.fontPreset}/${prefs.bgMode}/${prefs.bgOpacity}`}</output>
      <button
        type="button"
        onClick={() => {
          workspaceActions.setTheme("endfield")
          workspaceActions.setCustomThemes([
            {
              name: "Imported",
              cssVars: {
                light: { primary: "oklch(0.5 0.1 120)" },
                dark: { primary: "oklch(0.7 0.1 120)" },
              },
            },
          ])
          workspaceActions.setActiveCustomThemeName("Imported")
          workspaceActions.setFontPreset("aestivus")
          workspaceActions.setBgMode("image")
          workspaceActions.setBgOpacity(55)
        }}
      >
        set persisted prefs
      </button>
      <button
        type="button"
        onClick={() => {
          workspaceActions.setTheme("spatial")
          workspaceActions.setCustomThemes([])
          workspaceActions.setActiveCustomThemeName(null)
          workspaceActions.setFontPreset("xiranite")
          workspaceActions.setBgMode("dot-grid")
          workspaceActions.setBgOpacity(30)
        }}
      >
        reset persisted prefs
      </button>
    </div>
  )
}
