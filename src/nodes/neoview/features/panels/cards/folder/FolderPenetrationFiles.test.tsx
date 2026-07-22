import { cleanup, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { DirectoryListItem } from "./FolderBrowserPane"
import { DirectoryBannerItem, DirectoryGridItem } from "./FolderGridWorkspace"
import { DirectoryMosaicItem } from "./FolderMosaicWorkspace"
import { folderViewShowsPenetrationFiles } from "./FolderPenetrationFileNames"

const entry = { name: "container", path: "D:/library/container", kind: "directory" as const, readerSupported: true }
const penetrationFiles = [
  { name: "First Book", path: "D:/library/container/First Book.cbz" },
  { name: "Second.Book", path: "D:/library/container/Second.Book.zip" },
]

describe("Folder Card penetration file names", () => {
  it("enables every item view except details and respects the display switch", () => {
    for (const viewMode of ["compact", "cover-list", "mosaic-list", "cover-grid", "mosaic-grid"] as const) {
      expect(folderViewShowsPenetrationFiles(viewMode, true, true)).toBe(true)
    }
    expect(folderViewShowsPenetrationFiles("details", true, true)).toBe(false)
    expect(folderViewShowsPenetrationFiles("cover-grid", true, false)).toBe(false)
    expect(folderViewShowsPenetrationFiles("cover-grid", false, true)).toBe(false)
  })

  it.each(["compact", "cover-list"] as const)("[neoview.folder.penetration-item-names] renders real names in %s view", (visualMode) => {
    render(<DirectoryListItem
      itemId="folder-item-0"
      entry={entry}
      index={0}
      disabled={false}
      selected={false}
      focused={false}
      showRating={false}
      showCollectTagCount={false}
      visualMode={visualMode}
      contentWidthPercent={35}
      hoverPreviewEnabled={false}
      hoverPreviewDelayMs={500}
      penetrationFiles={penetrationFiles}
      deleteMode={false}
      deleteStrategy="trash"
      confirmDelete
      onSelect={vi.fn()}
    />)

    const list = screen.getByRole("button").querySelector('[data-folder-penetration-files="true"]')
    expect(list?.textContent).toContain("First Book")
    expect(list?.textContent).toContain("Second.Book")
    expect(list?.textContent).not.toContain("显示内部文件")
    cleanup()
  })

  it.each(["mosaic-list", "cover-grid", "mosaic-grid"] as const)("renders real names in %s view", (visualMode) => {
    const common = {
      itemId: "folder-item-0",
      entry,
      index: 0,
      disabled: false,
      selected: false,
      focused: false,
      showRating: false,
      showCollectTagCount: false,
      thumbnailUrl: undefined,
      hoverPreviewEnabled: false,
      hoverPreviewDelayMs: 500,
      penetrationFiles,
      onSelect: vi.fn(),
    }
    if (visualMode === "mosaic-list") render(<DirectoryBannerItem {...common} visualMode={visualMode} />)
    else if (visualMode === "cover-grid") render(<DirectoryGridItem {...common} visualMode={visualMode} />)
    else render(<DirectoryMosaicItem {...common} span="square" previewReady={false} columnCount={4} deleteMode={false} deleteStrategy="trash" confirmDelete onDimensions={vi.fn()} />)

    expect(screen.getByText("First Book")).toBeTruthy()
    expect(screen.getByText("Second.Book")).toBeTruthy()
    cleanup()
  })
})
