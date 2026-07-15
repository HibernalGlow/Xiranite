import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { DirectoryCatalog } from "./DirectoryCatalog"
import FolderDetailsView from "./FolderDetailsView"

describe("FolderDetailsView", () => {
  it("[neoview.folder.details-niko-sparse] renders complete columns without materializing the remote directory", async () => {
    const onRangeChange = vi.fn()
    const onSelect = vi.fn()
    const onActivate = vi.fn()
    const view = render(
      <FolderDetailsView
        catalog={catalog()}
        disabled={false}
        selectedPaths={new Set(["C:/books/book.cbz"])}
        layout={{
          columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
          hiddenColumns: [],
          pinnedLeft: ["name"],
          pinnedRight: [],
        }}
        onRangeChange={onRangeChange}
        onSelect={onSelect}
        onActivate={onActivate}
        onLayoutChange={vi.fn()}
      />,
    )

    const tableHost = screen.getByTestId("folder-details-host")
    expect(tableHost.getAttribute("data-table-engine")).toBe("niko-sparse")
    for (const heading of ["名称", "路径", "类型", "扩展名", "大小", "修改时间", "尺寸", "页数", "评分", "标签"]) {
      expect(within(tableHost).getByText(heading)).toBeTruthy()
    }
    expect(tableHost.getAttribute("data-loaded-rows")).toBe("2")
    expect(tableHost.getAttribute("data-total-rows")).toBe("10000")
    expect(tableHost.querySelectorAll("tbody tr").length).toBeLessThan(80)
    view.unmount()
  })

  it("[neoview.folder.details-columns] reuses Niko column controls and emits one canonical visibility change", async () => {
    const onLayoutChange = vi.fn()
    render(
      <FolderDetailsView
        catalog={catalog()}
        disabled={false}
        selectedPaths={new Set()}
        layout={{
          columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
          hiddenColumns: [],
          pinnedLeft: ["name"],
          pinnedRight: [],
        }}
        onRangeChange={vi.fn()}
        onSelect={vi.fn()}
        onActivate={vi.fn()}
        onLayoutChange={onLayoutChange}
      />,
    )
    fireEvent.click(screen.getByRole("combobox", { name: "管理详细信息列" }))
    const tagMenuItem = (await screen.findAllByText("标签")).find((element) => element.closest("[cmdk-item]"))
    expect(tagMenuItem).toBeTruthy()
    fireEvent.click(tagMenuItem!)
    await waitFor(() => expect(onLayoutChange).toHaveBeenCalledTimes(1))
    expect(onLayoutChange).toHaveBeenCalledWith({ hiddenColumns: ["tags"] })
  })
})

function catalog(): DirectoryCatalog {
  return {
    sessionId: "browser-1",
    path: "C:/books",
    total: 10_000,
    generation: 1,
    canGoBack: false,
    canGoForward: false,
    sort: { field: "name", order: "asc", directoriesFirst: true },
    sortFields: ["name", "date", "size", "type", "random", "rating", "path", "collectTagCount"],
    metadataFields: ["date", "size", "rating", "collectTagCount"],
    sortSource: "global-default",
    sortTemporary: false,
    globalDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    tabDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    pages: new Map([[0, [
      {
        name: "book.cbz",
        path: "C:/books/book.cbz",
        kind: "file",
        readerSupported: true,
        modifiedAt: 1_700_000_000_000,
        size: 12 * 1024 * 1024,
        width: 1920,
        height: 1080,
        pageCount: 48,
        rating: 4.8,
        collectTagCount: 2,
        tags: ["artist:a", "favorite"],
      },
      { name: "folder", path: "C:/books/folder", kind: "directory", readerSupported: true },
    ]]]),
  }
}
