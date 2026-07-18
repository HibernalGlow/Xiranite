import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import FolderNavigationSettings from "./FolderNavigationSettings"

describe("FolderNavigationSettings", () => {
  it("[neoview.folder.blank-action-settings] exposes the three legacy actions and footer toggle", async () => {
    const onChange = vi.fn()
    render(
      <FolderNavigationSettings
        value={{ singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false }}
        disabled={false}
        onChange={onChange}
      />,
    )

    fireEvent.pointerDown(screen.getByRole("button", { name: "空白区域操作" }))
    fireEvent.click(await screen.findByText("显示底部返回按钮"))
    expect(onChange).toHaveBeenCalledWith({ showBackButton: true })

    fireEvent.pointerDown(screen.getByRole("button", { name: "空白区域操作" }))
    fireEvent.pointerMove(await screen.findByText("单击空白"), { pointerType: "mouse" })
    expect(await screen.findByText("无操作")).toBeTruthy()
    expect(await screen.findByText("返回上级")).toBeTruthy()
    expect(await screen.findByText("后退")).toBeTruthy()
  })
})
