import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import FolderTypeFilterPanel, { FolderTypeFilterBar, folderTypeFilterMeta } from "./FolderTypeFilterBar"

describe("FolderTypeFilterPanel", () => {
  it("[neoview.folder.filter-ui] groups scope and kind filters with hierarchical controls", () => {
    const onChange = vi.fn()
    render(
      <FolderTypeFilterPanel
        value="archive"
        options={["library", "all", "archive", "directory", "video", "image", "other"]}
        disabled={false}
        onChange={onChange}
      />,
    )

    expect(screen.getByText("范围")).toBeTruthy()
    expect(screen.getByText("按类型")).toBeTruthy()
    expect(screen.getByRole("button", { name: /压缩包/ }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: /可读内容/ }))
    expect(onChange).toHaveBeenCalledWith("library")
    fireEvent.click(screen.getByRole("button", { name: /其它文件/ }))
    expect(onChange).toHaveBeenCalledWith("other")
  })

  it("exposes label metadata for toolbar badges", () => {
    expect(folderTypeFilterMeta("library").label).toBe("可读内容")
    expect(folderTypeFilterMeta("image").hint).toContain("jpg")
  })

  it("keeps the legacy strip wrapper for compatibility", () => {
    render(
      <FolderTypeFilterBar
        value="directory"
        options={["all", "directory"]}
        disabled={false}
        onChange={vi.fn()}
      />,
    )
    expect(document.querySelector('[data-folder-type-filter-bar="true"]')).toBeTruthy()
  })
})
