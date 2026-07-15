import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import {
  assignSidebarPanel,
  createSidebarBoardPatch,
  createSidebarPanelDraft,
  moveSidebarPanel,
  resetSidebarPanelDraft,
  SidebarManagementSettingsCard,
} from "./SidebarManagementSettingsCard"

afterEach(cleanup)

describe("SidebarManagementSettingsCard", () => {
  it("[neoview.settings.sidebar-management] keeps edits local and persists the complete panel draft once", async () => {
    const save = vi.fn(async () => undefined)
    render(<SidebarManagementSettingsCard shell={shell()} onSave={save} />)

    fireEvent.change(screen.getByRole("combobox", { name: "历史记录位置" }), { target: { value: "right" } })
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "保存边栏布局" }))

    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0]?.[0].board.panels).toContainEqual({ id: "history", visible: true, order: 41, position: "right" })
    expect(save.mock.calls[0]?.[0].board.cards).toEqual(expect.arrayContaining([
      { cardId: "future-card", panelId: "future-panel", visible: false, order: 7 },
    ]))
  })

  it("[neoview.settings.sidebar-management] preserves unknown panels and supports ordering, hiding and reset", () => {
    const current = shell()
    const draft = createSidebarPanelDraft(current)
    expect(draft.find((panel) => panel.id === "future-panel")).toMatchObject({ title: "future-panel", visible: true, position: "right" })

    const hidden = assignSidebarPanel(draft, "history", "hidden")
    expect(hidden.find((panel) => panel.id === "history")?.visible).toBe(false)
    const moved = moveSidebarPanel(draft, "history", -1)
    expect(moved.find((panel) => panel.id === "history")?.order).toBeLessThan(moved.find((panel) => panel.id === "folder")?.order ?? 0)

    const reset = resetSidebarPanelDraft(moved)
    expect(reset.find((panel) => panel.id === "history")).toMatchObject({ visible: true, position: "left", order: 1 })
    expect(createSidebarBoardPatch(current, reset).board.panels).toContainEqual({ id: "future-panel", visible: true, position: "right", order: 40 })
  })
})

function shell(): ReaderShellConfigDto {
  return {
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {} as ReaderShellConfigDto["edges"],
    sidebars: {} as ReaderShellConfigDto["sidebars"],
    panelLayout: {
      folder: { visible: true, order: 0, position: "left" },
      history: { visible: true, order: 1, position: "left" },
      future: { visible: false, order: 20, position: "left" },
      "future-panel": { visible: true, order: 40, position: "right" },
    },
    cardLayout: {
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      "future-card": { panelId: "future-panel", visible: false, expanded: true, order: 7 },
    },
  }
}
