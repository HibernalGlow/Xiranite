import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import { ReaderViewerToggleStore } from "../viewer/ReaderViewerToggleStore"
import { ThumbnailStrip } from "./ThumbnailStrip"

describe("ThumbnailStrip", () => {
  it("[neoview.thumbnail.react-list] pages in bounded batches and virtualizes a large book", async () => {
    const listPages = vi.fn(async (_sessionId: string, cursor: number, limit: number) => ({
      pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)),
      nextCursor: cursor + limit < 1_000 ? cursor + limit : undefined,
      total: 1_000,
    }))
    const client = clientWith({ listPages })
    const onSelect = vi.fn()
    const onPinnedChange = vi.fn()
    const view = render(
      <ThumbnailStrip
        sessionId="reader-1"
        totalPages={1_000}
        activePageIndex={0}
        currentPages={[page(0)]}
        client={client}
        compact={false}
        pinned={false}
        onPinnedChange={onPinnedChange}
        onSelect={onSelect}
      />,
    )

    await waitFor(() => expect(listPages).toHaveBeenCalledWith("reader-1", 0, 64, expect.any(AbortSignal)))
    await screen.findByRole("button", { name: "转到第 5 页：005.jpg" })
    const renderedTiles = screen.getAllByRole("button", { name: /转到第/ })
    expect(renderedTiles.length).toBeLessThanOrEqual(24)
    expect(view.container.querySelectorAll("img").length).toBeLessThanOrEqual(24)
    fireEvent.click(screen.getByRole("button", { name: "转到第 5 页：005.jpg" }))
    expect(onSelect).toHaveBeenCalledWith(4)
    fireEvent.click(screen.getByRole("button", { name: "钉住底栏" }))
    expect(onPinnedChange).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole("button", { name: "显示页码" }))
    expect(view.container.querySelectorAll("button span.absolute")).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "显示区域参考线" }))
    expect(view.container.querySelector('[data-reader-area-guide="true"]')).not.toBeNull()
    fireEvent.change(screen.getByRole("slider", { name: "阅读进度" }), { target: { value: "8" } })
    expect(onSelect).toHaveBeenCalledWith(8)
  })

  it("[neoview.thumbnail.react-list] falls back without creating a second image transport", async () => {
    const first = page(0)
    const client = clientWith({
      listPages: vi.fn(async () => ({ pages: [first], total: 1 })),
    })
    const view = render(
      <ThumbnailStrip
        sessionId="reader-1"
        totalPages={1}
        activePageIndex={0}
        currentPages={[first]}
        client={client}
        compact
        onSelect={() => undefined}
      />,
    )
    const image = view.container.querySelector("img")!
    expect(image.getAttribute("src")).toBe(first.thumbnailUrl)
    fireEvent.error(image)
    expect(view.container.querySelector("img")).toBeNull()
    expect(document.querySelector("canvas")).toBeNull()
  })

  it("[neoview.bindings.viewer-toggle-react] follows the shared page-info provider", async () => {
    const first = page(0)
    const viewerToggles = new ReaderViewerToggleStore()
    const view = render(
      <ThumbnailStrip
        sessionId="reader-1"
        totalPages={1}
        activePageIndex={0}
        currentPages={[first]}
        client={clientWith({ listPages: vi.fn(async () => ({ pages: [first], total: 1 })) })}
        compact
        viewerToggles={viewerToggles}
        onSelect={() => undefined}
      />,
    )

    await waitFor(() => expect(view.container.querySelector("button[aria-label='转到第 1 页：001.jpg']")).not.toBeNull())
    expect(view.container.querySelectorAll("button span.absolute")).toHaveLength(1)
    viewerToggles.togglePageInfo()
    await waitFor(() => expect(view.container.querySelectorAll("button span.absolute")).toHaveLength(0))
    viewerToggles.togglePageInfo()
    await waitFor(() => expect(view.container.querySelectorAll("button span.absolute")).toHaveLength(1))
  })
})

function clientWith(overrides: Partial<ReaderHttpClient>): ReaderHttpClient {
  return {
    config: vi.fn(),
    updateSidebarLayout: vi.fn(),
    updateCardLayout: vi.fn(),
    updateBoardLayout: vi.fn(),
    updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(),
    open: vi.fn(),
    listPages: vi.fn(),
    navigate: vi.fn(),
    goTo: vi.fn(),
    updateSessionOptions: vi.fn(),
    close: vi.fn(),
    ...overrides,
  }
}

function page(index: number): ReaderPageDto {
  const number = String(index + 1).padStart(3, "0")
  return {
    id: `page-${index}`,
    index,
    name: `${number}.jpg`,
    mediaKind: "image",
    mimeType: "image/jpeg",
    contentVersion: "v1",
    assetUrl: `http://127.0.0.1:41000/reader/page-${index}`,
    thumbnailUrl: `http://127.0.0.1:41000/reader/thumbnail-${index}`,
  }
}
