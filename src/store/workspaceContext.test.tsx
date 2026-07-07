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
    await waitFor(() => expect(screen.getByTestId("prefs").textContent).toContain("endfield/image"))

    const persisted = JSON.parse(localStorage.getItem("xiranite-workspace-ui") ?? "{}") as {
      state?: Record<string, unknown>
    }

    expect(persisted.state?.theme).toBe("endfield")
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
    bgMode: state.bgMode,
    bgOpacity: state.bgOpacity,
  }))
  const workspaceActions = useWorkspaceActions()

  return (
    <div>
      <output data-testid="prefs">{`${prefs.theme}/${prefs.bgMode}/${prefs.bgOpacity}`}</output>
      <button
        type="button"
        onClick={() => {
          workspaceActions.setTheme("endfield")
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
          workspaceActions.setBgMode("dot-grid")
          workspaceActions.setBgOpacity(30)
        }}
      >
        reset persisted prefs
      </button>
    </div>
  )
}
