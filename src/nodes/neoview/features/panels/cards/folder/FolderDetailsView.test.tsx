import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { DirectoryCatalog } from "./DirectoryCatalog"
import FolderDetailsView, { folderDetailsContextAttributes, folderDetailsRowSelection } from "./FolderDetailsView"
import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS } from "../../../../adapters/reader-http-client"

afterEach(cleanup)

describe("FolderDetailsView", () => {
  it("[neoview.folder.details-niko-sparse] renders complete columns and reports transient scroll without materializing the remote directory", async () => {
    const onRangeChange = vi.fn()
    const onScrollTopChange = vi.fn()
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
          columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
        }}
        onRangeChange={onRangeChange}
        onScrollTopChange={onScrollTopChange}
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
    const book = catalog().pages.get(0)![0]!
    expect(folderDetailsContextAttributes({ index: 0, entry: book })).toMatchObject({
      "data-context-menu": "neoview-folder-entry",
      "data-folder-path": "C:/books/book.cbz",
      "data-folder-index": 0,
    })
    expect(folderDetailsRowSelection(
      [...catalog().pages.values()].flat().map((entry) => ({ entry })),
      new Set(["C:/books/book.cbz"]),
    )).toEqual({ "C:/books/book.cbz": true })
    const scrollHost = tableHost.querySelector<HTMLElement>('[data-slot="table-container"]')!
    Object.defineProperty(scrollHost, "scrollTop", { configurable: true, value: 640 })
    fireEvent.scroll(scrollHost)
    await waitFor(() => expect(onScrollTopChange).toHaveBeenCalledWith(640))
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
          columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
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

  it("[neoview.folder.details-column-width] applies persisted TanStack widths and resets one column on double click", async () => {
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
          columnWidths: { ...READER_FOLDER_DETAIL_DEFAULT_WIDTHS, name: 320 },
        }}
        onRangeChange={vi.fn()}
        onSelect={vi.fn()}
        onActivate={vi.fn()}
        onLayoutChange={onLayoutChange}
      />,
    )

    const handle = screen.getByRole("separator", { name: "调整 name 列宽" })
    expect(handle.getAttribute("aria-valuenow")).toBe("320")
    expect(handle.closest("th")?.style.width).toBe("320px")
    fireEvent.doubleClick(handle)
    await waitFor(() => expect(onLayoutChange).toHaveBeenCalledTimes(1))
    expect(onLayoutChange).toHaveBeenCalledWith({
      columnWidths: { ...READER_FOLDER_DETAIL_DEFAULT_WIDTHS, name: 220 },
    })
  })
})

function catalog(): DirectoryCatalog {
  return {
    sessionId: "browser-1",
    navigationEntryId: 1,
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
