import { expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { DirectoryListItem } from "./FolderDirectoryListItem"
import { DirectoryBannerItem, DirectoryGridItem } from "./FolderGridWorkspace"
import { DirectoryMosaicItem } from "./FolderMosaicWorkspace"

const emptyDirectory: ReaderDirectoryEntryDto = {
  name: "empty-folder",
  path: "C:/books/empty-folder",
  kind: "directory",
  readerSupported: true,
  directoryEmpty: true,
}

test("[neoview.folder.empty-directory-icon-gui] replaces cached and unloaded folder previews with the empty icon", async () => {
  await render(
    <div>
      <DirectoryListItem
        itemId="list-empty"
        entry={emptyDirectory}
        index={0}
        disabled={false}
        selected={false}
        focused={false}
        showRating={false}
        showCollectTagCount={false}
        visualMode="cover-list"
        thumbnailUrl="/reader/library/t/stale-list"
        contentWidthPercent={32}
        hoverPreviewEnabled
        hoverPreviewDelayMs={200}
        deleteMode={false}
        deleteStrategy="trash"
        confirmDelete
        onSelect={vi.fn()}
      />
      <DirectoryBannerItem
        itemId="banner-empty"
        entry={emptyDirectory}
        index={1}
        disabled={false}
        selected={false}
        focused={false}
        showRating={false}
        showCollectTagCount={false}
        visualMode="mosaic-list"
        thumbnailUrl="/reader/library/t/stale-banner"
        hoverPreviewEnabled
        hoverPreviewDelayMs={200}
        onSelect={vi.fn()}
      />
      <DirectoryGridItem
        itemId="grid-empty"
        entry={emptyDirectory}
        index={2}
        disabled={false}
        selected={false}
        focused={false}
        showRating={false}
        showCollectTagCount={false}
        visualMode="cover-grid"
        hoverPreviewEnabled
        hoverPreviewDelayMs={200}
        onSelect={vi.fn()}
      />
      <DirectoryMosaicItem
        itemId="mosaic-empty"
        entry={emptyDirectory}
        index={3}
        span="square"
        previewReady={false}
        columnCount={3}
        disabled={false}
        selected={false}
        focused={false}
        showRating={false}
        showCollectTagCount={false}
        thumbnailUrl="/reader/library/t/stale-mosaic"
        hoverPreviewEnabled
        hoverPreviewDelayMs={200}
        deleteMode={false}
        deleteStrategy="trash"
        confirmDelete
        onDimensions={vi.fn()}
        onSelect={vi.fn()}
      />
    </div>,
  )

  const cards = [...document.querySelectorAll<HTMLElement>('[data-folder-entry="true"]')]
  expect(cards).toHaveLength(4)
  for (const card of cards) {
    expect(card.dataset.folderEmptyDirectory).toBe("true")
    expect(card.querySelector('[data-folder-empty-icon="true"]')).not.toBeNull()
    expect(card.querySelector('[data-reader-thumbnail-surface="true"]')).toBeNull()
    expect(card.querySelector("img")).toBeNull()
  }
})
