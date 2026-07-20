import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import FolderTagDisplayMenu from "./FolderTagDisplayMenu"

afterEach(cleanup)

describe("FolderTagDisplayMenu", () => {
  it("[neoview.folder.tag-display-menu] exposes File Card display settings from the More menu", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>更多</DropdownMenuTrigger>
        <DropdownMenuContent><FolderTagDisplayMenu value={{ tagMode: "collect", showRating: true, showCollectTagCount: true, showTags: true, maxTags: 3, showTooltips: true }} onChange={onChange} /></DropdownMenuContent>
      </DropdownMenu>,
    )
    await user.click(screen.getByRole("button", { name: "更多" }))
    await user.hover(screen.getByText("文件信息显示"))
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "显示评分" }))
    expect(onChange).toHaveBeenCalledWith({ showRating: false })
  })

  it("[neoview.folder.tag-display-mode] preserves the legacy all, collect and none modes", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>更多</DropdownMenuTrigger>
        <DropdownMenuContent><FolderTagDisplayMenu value={{ tagMode: "collect", showRating: true, showCollectTagCount: true, showTags: true, maxTags: 3, showTooltips: true }} onChange={onChange} /></DropdownMenuContent>
      </DropdownMenu>,
    )
    await user.click(screen.getByRole("button", { name: "更多" }))
    await user.hover(screen.getByText("文件信息显示"))
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "全部标签" }))
    expect(onChange).toHaveBeenCalledWith({ tagMode: "all" })
  })
})
