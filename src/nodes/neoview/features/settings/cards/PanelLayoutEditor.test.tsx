import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import PanelLayoutEditor, { createPanelBoardPatch, createPanelLayoutColumns, movePanelLayoutCard } from "./PanelLayoutEditor"

afterEach(cleanup)

describe("PanelLayoutEditor", () => {
  it("[neoview.panel-editor.batch] keeps a local draft and saves the complete board once", async () => {
    const save = vi.fn(async () => undefined)
    render(<PanelLayoutEditor shell={shell()} onSave={save} />)
    expect(screen.getByRole("button", { name: "拖动页面导航" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "拖动书籍信息" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "保存面板布局" }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 0,
      board: {
        cards: expect.arrayContaining([
          { cardId: "page-navigation", panelId: "pageList", visible: true, order: 0 },
          { cardId: "book-information", panelId: "info", visible: true, order: 0 },
          { cardId: "panel-layout-settings", panelId: "settings", visible: false, order: 1 },
        ]),
      },
    })
  })

  it("[neoview.settings.card-docking] exposes every registered panel and enables the destination when a hidden card is docked", () => {
    const current = shell()
    const columns = createPanelLayoutColumns(current)
    expect(Object.keys(columns)).toEqual(expect.arrayContaining(["__hidden__", "folder", "pageList", "settings", "info"]))

    const moved = movePanelLayoutCard(columns, "panel-layout-settings", "settings")
    const patch = createPanelBoardPatch(current, moved)
    expect(patch.board.cards).toContainEqual({ cardId: "panel-layout-settings", panelId: "settings", visible: true, order: 0 })
    expect(patch.board.panels).toContainEqual({ id: "settings", visible: true, order: 99, position: "left" })
  })

  it("[neoview.settings.card-policy] rejects hiding fixed cards and unsupported floating destinations", () => {
    const columns = createPanelLayoutColumns(shell())
    render(<PanelLayoutEditor shell={shell()} onSave={vi.fn()} />)
    const destinations = Array.from(screen.getByRole("combobox", { name: "移动页面导航到" }).querySelectorAll("option"), (option) => option.value)
    expect(destinations).not.toContain("__hidden__")
    expect(destinations).not.toContain("cardwindow")
    expect(movePanelLayoutCard(columns, "page-navigation", "__hidden__")).toBe(columns)
    expect(movePanelLayoutCard(columns, "book-information", "cardwindow")).toBe(columns)
  })

  it("[neoview.sidebar.panel-dnd-settings] reflects a panel side change from the shared shell", () => {
    const current = shell()
    const view = render(<PanelLayoutEditor shell={current} onSave={vi.fn()} />)
    expect(document.querySelector('[data-panel-layout-column="pageList"]')?.textContent).toContain("左侧栏")

    const updated = { ...current, panelLayout: { ...current.panelLayout, pageList: { ...current.panelLayout.pageList!, position: "right" as const } } }
    view.rerender(<PanelLayoutEditor shell={updated} onSave={vi.fn()} />)
    expect(document.querySelector('[data-panel-layout-column="pageList"]')?.textContent).toContain("右侧栏")
  })

  it("surfaces save failures and retries with the preserved local draft", async () => {
    let rejectFirstSave!: (reason?: unknown) => void
    const firstSave = new Promise<void>((_, reject) => { rejectFirstSave = reject })
    const save = vi.fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(undefined)
    render(<PanelLayoutEditor shell={shell()} onSave={save} />)

    const saveButton = screen.getByRole("button", { name: "保存面板布局" })
    const getDragHandle = () => screen.getByRole("button", { name: "拖动页面导航" }) as HTMLButtonElement
    const getMoveControl = () => screen.getByRole("combobox", { name: "移动页面导航到" }) as HTMLSelectElement
    fireEvent.change(getMoveControl(), { target: { value: "info" } })
    fireEvent.click(saveButton)
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect((saveButton as HTMLButtonElement).disabled).toBe(true)
    expect(getDragHandle().disabled).toBe(true)
    expect(getMoveControl().disabled).toBe(true)

    rejectFirstSave(new Error("board write failed"))
    expect((await screen.findByRole("alert")).textContent).toContain("board write failed")
    await waitFor(() => expect((saveButton as HTMLButtonElement).disabled).toBe(false))
    expect(save.mock.calls[0]?.[0].board.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "page-navigation", panelId: "info", visible: true }),
    ]))

    fireEvent.change(getMoveControl(), { target: { value: "pageList" } })
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(saveButton)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1]?.[0].board.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "page-navigation", panelId: "pageList", visible: true }),
    ]))
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
      pageList: { visible: true, order: 0, position: "left" },
      info: { visible: true, order: 0, position: "right" },
    },
    cardLayout: {
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
    },
  }
}
