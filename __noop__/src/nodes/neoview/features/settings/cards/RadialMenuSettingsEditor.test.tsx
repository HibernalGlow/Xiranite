import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { DEFAULT_READER_RADIAL_MENU_CONFIG } from "@xiranite/node-neoview/ui-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RadialMenuSettingsEditor } from "./RadialMenuSettingsEditor"

afterEach(cleanup)

describe("RadialMenuSettingsEditor", () => {
  it("[neoview.radial-menu.editor] manages menus and slots through an independent save", async () => {
    const save = vi.fn(async ({ config }: { config?: typeof DEFAULT_READER_RADIAL_MENU_CONFIG }) => config ?? DEFAULT_READER_RADIAL_MENU_CONFIG)
    render(<RadialMenuSettingsEditor value={DEFAULT_READER_RADIAL_MENU_CONFIG} onSave={save as never} />)
    fireEvent.click(screen.getByRole("button", { name: "新增" }))
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "阅读操作" } })
    fireEvent.click(screen.getByRole("button", { name: "添加槽位" }))
    fireEvent.change(screen.getByLabelText("轮盘项目名称"), { target: { value: "下一页" } })
    fireEvent.click(screen.getByRole("button", { name: "保存轮盘" }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    const config = save.mock.calls[0]![0].config!
    expect(config.menus).toHaveLength(2)
    expect(config.menus[1]?.name).toBe("阅读操作")
    expect(config.menus[1]?.layers[0][0]).toMatchObject({ label: "下一页", action: "reader.next-page" })
  })
})
