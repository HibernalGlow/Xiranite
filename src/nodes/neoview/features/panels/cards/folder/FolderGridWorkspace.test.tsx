import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { DirectoryBannerItem } from "./FolderGridWorkspace"

afterEach(cleanup)

describe("FolderGridWorkspace banner entries", () => {
  it("[neoview.folder.banner-density] keeps the legacy two-line name and date-size layout", () => {
    const entry: ReaderDirectoryEntryDto = {
      name: "cover.cbz",
      path: "D:/library/series/cover.cbz",
      kind: "file",
      readerSupported: true,
      modifiedAt: 1_700_000_000_000,
      size: 12 * 1024 * 1024,
      rating: 4.8,
      collectTagCount: 3,
      tags: ["artist:alice", "manual:favorite"],
    }

    render(
      <DirectoryBannerItem
        itemId="folder-item-0"
        entry={entry}
        index={0}
        disabled={false}
        selected={false}
        focused={false}
        showRating
        showCollectTagCount
        visualMode="mosaic-list"
        thumbnailUrl={undefined}
        hoverPreviewEnabled={false}
        hoverPreviewDelayMs={500}
        onSelect={vi.fn()}
      />,
    )

    const button = screen.getByRole("button")
    expect(button.getAttribute("title")).toBe(entry.path)
    const info = button.querySelector('[data-folder-entry-info="two-line"]')
    expect(info).toBeTruthy()
    expect(info?.querySelector('[data-folder-entry-line="name"]')?.textContent).toBe(entry.name)
    expect(info?.children).toHaveLength(2)
    expect(info?.children[1]?.textContent).toContain("12.0 MiB")
    expect(info?.querySelector('[title^="评分"]')).toBeTruthy()
    expect(info?.querySelector('[title^="收藏标签"]')).toBeTruthy()
    expect(info?.querySelector('[data-folder-entry-metadata="tags"]')?.getAttribute("title")).toBe("标签 artist:alice / manual:favorite")
    expect(info?.textContent).not.toContain(entry.path)
  })
})
