import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { DirectoryBannerItem, DirectoryGridItem } from "./FolderGridWorkspace"

afterEach(cleanup)

describe("FolderGridWorkspace banner entries", () => {
  it("[neoview.folder.penetration-item-hint] labels folders when penetration is enabled", () => {
    render(
      <DirectoryBannerItem
        itemId="folder-item-0"
        entry={{ name: "nested", path: "D:/library/nested", kind: "directory", readerSupported: true }}
        index={0}
        disabled={false}
        selected={false}
        focused={false}
        showRating={false}
        showCollectTagCount={false}
        visualMode="mosaic-list"
        hoverPreviewEnabled={false}
        hoverPreviewDelayMs={500}
        penetrationEnabled
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByLabelText("穿透模式：显示内部文件").textContent).toBe("显示内部文件")
  })

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

  it("[neoview.folder.thumbnail-empty] leaves a folder thumbnail area empty when no content preview exists", () => {
    const entry: ReaderDirectoryEntryDto = {
      name: "empty-folder",
      path: "D:/library/empty-folder",
      kind: "directory",
      readerSupported: true,
    }

    render(
      <DirectoryBannerItem
        itemId="folder-item-0"
        entry={entry}
        index={0}
        disabled={false}
        selected={false}
        focused={false}
        showRating={false}
        showCollectTagCount={false}
        visualMode="mosaic-list"
        thumbnailUrl={undefined}
        hoverPreviewEnabled={false}
        hoverPreviewDelayMs={500}
        onSelect={vi.fn()}
      />,
    )

    const thumbnail = screen.getByRole("button").querySelector('[data-folder-thumbnail="true"]')
    expect(thumbnail).toBeTruthy()
    expect(thumbnail?.children).toHaveLength(0)
  })

  it("[neoview.folder.thumbnail-error] hides a failed capability image instead of showing a broken image", () => {
    const entry: ReaderDirectoryEntryDto = {
      name: "missing-preview",
      path: "D:/library/missing-preview",
      kind: "directory",
      readerSupported: true,
    }

    render(
      <DirectoryBannerItem
        itemId="folder-item-0"
        entry={entry}
        index={0}
        disabled={false}
        selected={false}
        focused={false}
        showRating={false}
        showCollectTagCount={false}
        visualMode="mosaic-list"
        thumbnailUrl="/reader/library/t/unavailable"
        hoverPreviewEnabled={false}
        hoverPreviewDelayMs={500}
        onSelect={vi.fn()}
      />,
    )

    const image = screen.getByRole("button").querySelector("img")!
    fireEvent.error(image)
    expect(screen.getByRole("button").querySelector("img")).toBeNull()
  })
})

describe("FolderGridWorkspace cover entries", () => {
  it("[neoview.folder.cover-grid-portrait] reserves a 2:3 portrait thumbnail region above the label", () => {
    const entry: ReaderDirectoryEntryDto = {
      name: "portrait-folder",
      path: "D:/library/portrait-folder",
      kind: "directory",
      readerSupported: true,
    }

    render(
      <DirectoryGridItem
        itemId="folder-item-0"
        entry={entry}
        index={0}
        disabled={false}
        selected={false}
        focused={false}
        showRating={false}
        showCollectTagCount={false}
        visualMode="cover-grid"
        thumbnailUrl="/reader/library/t/portrait"
        thumbnailUrls={["/reader/library/t/one", "/reader/library/t/two", "/reader/library/t/three", "/reader/library/t/four"]}
        hoverPreviewEnabled={false}
        hoverPreviewDelayMs={500}
        onSelect={vi.fn()}
      />,
    )

    const button = screen.getByRole("button")
    const thumbnail = button.querySelector<HTMLElement>('[data-folder-thumbnail-orientation="portrait"]')
    expect(thumbnail?.className).toContain("aspect-[2/3]")
    expect(button.className).not.toContain("h-36")
    expect(thumbnail?.querySelector('[data-thumbnail-grid-count="4"]')).toBeTruthy()
  })
})
