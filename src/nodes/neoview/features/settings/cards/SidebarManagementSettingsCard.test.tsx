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
  it("[neoview.settings.sidebar-management-icons] renders the shared Lucide panel icon", () => {
    render(<SidebarManagementSettingsCard shell={shell()} onSave={vi.fn()} />)

    expect(document.querySelector('[data-sidebar-panel-draft="folder"] svg.lucide-folder')).toBeTruthy()
  })

  it("[neoview.settings.sidebar-management] keeps edits local and persists the complete panel draft once", async () => {
    const save = vi.fn(async () => undefined)
    render(<SidebarManagementSettingsCard shell={shell()} onSave={save} />)

    fireEvent.change(screen.getByRole("combobox", { name: "历史记录位置" }), { target: { value: "right" } })
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "保存边栏布局" }))

    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0]?.[0].expectedRevision).toBe(0)
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

  it("[neoview.sidebar.panel-dnd-settings] refreshes its draft from an optimistic shell move", async () => {
    const current = shell()
    const view = render(<SidebarManagementSettingsCard shell={current} onSave={vi.fn()} />)
    expect((screen.getByRole("combobox", { name: "历史记录位置" }) as HTMLSelectElement).value).toBe("left")

    const updated = { ...current, panelLayout: { ...current.panelLayout, history: { ...current.panelLayout.history!, position: "right" as const, order: 0 } } }
    view.rerender(<SidebarManagementSettingsCard shell={updated} onSave={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole("combobox", { name: "历史记录位置" }) as HTMLSelectElement).value).toBe("right"))
  })
  it("surfaces save failures, disables controls while saving, and retries after a draft edit", async () => {
    let rejectFirst!: (reason?: unknown) => void
    const firstSave = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const save = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce(undefined)
    render(<SidebarManagementSettingsCard shell={shell()} onSave={save} />)

    const saveButton = screen.getByRole("button", { name: "保存边栏布局" }) as HTMLButtonElement
    const resetButton = screen.getByRole("button", { name: "重置" }) as HTMLButtonElement
    const position = screen.getByRole("combobox", { name: "历史记录位置" }) as HTMLSelectElement
    fireEvent.change(position, { target: { value: "right" } })
    fireEvent.click(saveButton)

    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(saveButton.disabled).toBe(true)
    expect(resetButton.disabled).toBe(true)
    expect(position.disabled).toBe(true)

    rejectFirst(new Error("sidebar write failed"))
    expect((await screen.findByRole("alert")).textContent).toContain("sidebar write failed")
    await waitFor(() => expect(saveButton.disabled).toBe(false))
    expect(position.value).toBe("right")

    fireEvent.change(position, { target: { value: "left" } })
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(saveButton)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole("alert")).toBeNull()
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
