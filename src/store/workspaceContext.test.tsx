// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useWorkspaceActions, useWorkspaceShallowSelector, useWorkspaceStore } from "./workspaceStore"

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
    expect(persisted.state?.bgImageUrl).toBe("D:/Images/background.jpg")
    expect(persisted.state?.bgOpacity).toBe(55)
    expect(persisted.state?.tabDisplayStyle).toBe("boxed")
    expect(persisted.state?.switchDisplayStyle).toBe("filled")
    expect(persisted.state?.workspaces).toBeUndefined()
    expect(persisted.state?.components).toBeUndefined()
    expect(localStorage.getItem("xiranite-bg-mode")).toBeNull()

    await user.click(screen.getByRole("button", { name: "reset persisted prefs" }))
  })

  test("persists inline background images", async () => {
    localStorage.clear()
    const user = userEvent.setup()

    render(<WorkspacePreferenceProbe />)

    await user.click(screen.getByRole("button", { name: "set inline background" }))
    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("xiranite-workspace-ui") ?? "{}") as {
        state?: Record<string, unknown>
      }
      expect(persisted.state?.bgImageUrl).toBe("data:image/png;base64,abc")
    })
  })

  test("switching theme presets preserves user background and chrome settings", async () => {
    const user = userEvent.setup()

    render(<WorkspacePreferenceProbe />)

    await user.click(screen.getByRole("button", { name: "set user overrides then switch preset" }))

    await waitFor(() => {
      expect(screen.getByTestId("prefs").textContent).toBe("endfield/mono/image/55/island/traffic-light/117/underline/outlined")
    })
  })

  test("keeps a preset selected when imported themes hydrate", () => {
    const actions = useWorkspaceStore.getState()

    actions.setTheme("endfield")
    actions.setCustomThemes([
      {
        name: "perpetuity",
        cssVars: {
          light: { primary: "oklch(0.5 0.1 120)" },
          dark: { primary: "oklch(0.7 0.1 120)" },
        },
      },
    ])

    expect(useWorkspaceStore.getState().theme).toBe("endfield")
    expect(useWorkspaceStore.getState().activeCustomThemeName).toBeNull()
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
    chromePosition: state.chromePosition,
    chromeStyle: state.chromeStyle,
    chromeIslandScale: state.chromeIslandScale,
    tabDisplayStyle: state.tabDisplayStyle,
    switchDisplayStyle: state.switchDisplayStyle,
  }))
  const workspaceActions = useWorkspaceActions()

  return (
    <div>
      <output data-testid="prefs">{`${prefs.theme}/${prefs.fontPreset}/${prefs.bgMode}/${prefs.bgOpacity}/${prefs.chromePosition}/${prefs.chromeStyle}/${prefs.chromeIslandScale}/${prefs.tabDisplayStyle}/${prefs.switchDisplayStyle}`}</output>
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
          workspaceActions.setBgImageUrl("D:/Images/background.jpg")
          workspaceActions.setBgOpacity(55)
          workspaceActions.setTabDisplayStyle("boxed")
          workspaceActions.setSwitchDisplayStyle("filled")
        }}
      >
        set persisted prefs
      </button>
      <button
        type="button"
        onClick={() => {
          workspaceActions.setBgMode("image")
          workspaceActions.setBgOpacity(55)
          workspaceActions.setBgBlur(18)
          workspaceActions.setBgCoverTopBar(true)
          workspaceActions.setChromePosition("island")
          workspaceActions.setChromeStyle("traffic-light")
          workspaceActions.setChromeIslandScale(117)
          workspaceActions.setTheme("endfield")
        }}
      >
        set user overrides then switch preset
      </button>
      <button
        type="button"
        onClick={() => {
          workspaceActions.setBgMode("image")
          workspaceActions.setBgImageUrl("data:image/png;base64,abc")
        }}
      >
        set inline background
      </button>
      <button
        type="button"
        onClick={() => {
          workspaceActions.setTheme("spatial")
          workspaceActions.setCustomThemes([])
          workspaceActions.setActiveCustomThemeName(null)
          workspaceActions.setFontPreset("xiranite")
          workspaceActions.setBgMode("dot-grid")
          workspaceActions.setBgImageUrl("")
          workspaceActions.setBgOpacity(30)
          workspaceActions.setBgBlur(5)
          workspaceActions.setBgCoverTopBar(false)
          workspaceActions.setChromePosition("right")
          workspaceActions.setChromeStyle("default")
          workspaceActions.setChromeIslandScale(90)
          workspaceActions.setTabDisplayStyle("underline")
          workspaceActions.setSwitchDisplayStyle("outlined")
        }}
      >
        reset persisted prefs
      </button>
    </div>
  )
}
