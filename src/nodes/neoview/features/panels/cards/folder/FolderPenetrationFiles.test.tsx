import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { DirectoryListItem } from "./FolderBrowserPane"

describe("Folder Card penetration file names", () => {
  it("[neoview.folder.penetration-item-names] renders real internal archive names in content view", () => {
    render(<DirectoryListItem
      itemId="folder-item-0"
      entry={{ name: "container", path: "D:/library/container", kind: "directory", readerSupported: true }}
      index={0}
      disabled={false}
      selected={false}
      focused={false}
      showRating={false}
      showCollectTagCount={false}
      visualMode="content"
      contentWidthPercent={35}
      hoverPreviewEnabled={false}
      hoverPreviewDelayMs={500}
      penetrationFiles={[
        { name: "First Book", path: "D:/library/container/First Book.cbz" },
        { name: "Second.Book", path: "D:/library/container/Second.Book.zip" },
      ]}
      deleteMode={false}
      deleteStrategy="trash"
      confirmDelete
      onSelect={vi.fn()}
    />)

    const list = screen.getByRole("button").querySelector('[data-folder-penetration-files="true"]')
    expect(list?.textContent).toContain("First Book")
    expect(list?.textContent).toContain("Second.Book")
    expect(list?.textContent).not.toContain("显示内部文件")
  })
})
