import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { DEFAULT_READER_RADIAL_MENU_CONFIG } from "@xiranite/node-neoview/ui-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RadialMenuSettingsEditor } from "./RadialMenuSettingsEditor"

afterEach(cleanup)

describe("RadialMenuSettingsEditor", () => {
  it("[neoview.radial-menu.editor] manages menus and slots through an independent save", async () => {
    const save = vi.fn(async ({ config }: { config?: typeof DEFAULT_READER_RADIAL_MENU_CONFIG }) => config ?? DEFAULT_READER_RADIAL_MENU_CONFIG)
    render(<RadialMenuSettingsEditor value={DEFAULT_READER_RADIAL_MENU_CONFIG} onSave={save as never} />)

    fireEvent.click(screen.getByRole("button", { name: "新轮盘" }))
    const menuSelect = screen.getByRole("combobox", { name: "活动轮盘" }) as HTMLSelectElement
    expect(menuSelect.value).not.toBe("default")
    fireEvent.change(screen.getByRole("textbox", { name: "当前轮盘名" }), { target: { value: "阅读操作" } })

    // Click an empty first-layer slot in the ring preview.
    fireEvent.click(screen.getByRole("button", { name: "添加一级槽位 0" }))
    fireEvent.change(screen.getByRole("textbox", { name: "轮盘项目名称" }), { target: { value: "下一页" } })

    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    const config = save.mock.calls[0]![0].config!
    expect(config.menus).toHaveLength(2)
    const menu = config.menus.find((candidate) => candidate.name === "阅读操作") ?? config.menus[1]
    expect(menu?.name).toBe("阅读操作")
    expect(menu?.layers[0][0]).toMatchObject({ label: "下一页", action: "reader.next-page" })
  })

  it("[neoview.radial-menu.editor] renders ring preview slots for the active layer count", () => {
    render(<RadialMenuSettingsEditor value={DEFAULT_READER_RADIAL_MENU_CONFIG} onSave={vi.fn() as never} />)
    expect(screen.getByRole("img", { name: "轮盘槽位编辑器" })).toBeTruthy()
    // Default layerCount=3 with empty layers still shows at least 8 empty first-layer slots.
    expect(screen.getAllByRole("button", { name: /添加一级槽位/ }).length).toBeGreaterThanOrEqual(8)
  })
})
