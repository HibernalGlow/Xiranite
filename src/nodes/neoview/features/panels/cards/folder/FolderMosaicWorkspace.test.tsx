import { createRef } from "react"
import { VirtuosoMockContext, type VirtuosoHandle } from "react-virtuoso"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryEntryDto, ReaderDirectoryPageDto } from "../../../../adapters/reader-http-client"
import { createDirectoryCatalog } from "./DirectoryCatalog"
import FolderMosaicWorkspace, { folderMosaicGeometry, folderMosaicSpan } from "./FolderMosaicWorkspace"

afterEach(cleanup)

describe("FolderMosaicWorkspace", () => {
  it("classifies landscape and portrait previews into stable bento spans", () => {
    expect(folderMosaicSpan(1600, 900)).toBe("wide")
    expect(folderMosaicSpan(900, 1600)).toBe("tall")
    expect(folderMosaicSpan(416, 312)).toBe("wide")
    expect(folderMosaicSpan(337, 416)).toBe("tall")
    expect(folderMosaicSpan(1000, 1000)).toBe("square")
    expect(folderMosaicSpan()).toBe("square")
    expect(folderMosaicGeometry("wide", true, 4)).toEqual({ columns: 2, rows: 1 })
    expect(folderMosaicGeometry("tall", true, 4)).toEqual({ columns: 1, rows: 2 })
    expect(folderMosaicGeometry("tall", false, 4)).toEqual({ columns: 1, rows: 1 })
  })

  it("virtualizes bounded groups and corrects an unknown tile from loaded image dimensions", async () => {
    const entries: ReaderDirectoryEntryDto[] = [
      entry("wide.cbz", 1600, 900),
      entry("tall.cbz", 900, 1600),
      entry("square.cbz", 1000, 1000),
      entry("measured.cbz"),
    ]
    const catalog = createDirectoryCatalog(page(entries))
    const onRangeChange = vi.fn()
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 420 }}>
        <FolderMosaicWorkspace
          virtualKey="mosaic:1"
          mosaicRef={createRef<VirtuosoHandle>()}
          catalog={catalog}
          disabled={false}
          selectedPaths={new Set()}
          itemIdPrefix="mosaic"
          thumbnailUrls={new Map([[entries[3]!.path, "/thumb/measured"]])}
          tileSize={96}
          hoverPreviewEnabled={false}
          hoverPreviewDelayMs={500}
          showReturnFooter={false}
          returnFooterContext={{ disabled: false, onReturn: vi.fn() }}
          onRangeChange={onRangeChange}
          onScrollTopChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </VirtuosoMockContext.Provider>,
    )

    await waitFor(() => expect(view.container.querySelectorAll('[data-folder-entry="true"]')).toHaveLength(4))
    expect(view.container.querySelector('[data-folder-name="wide.cbz"]')?.getAttribute("data-folder-mosaic-span")).toBe("square")
    expect(view.container.querySelector('[data-folder-name="tall.cbz"]')?.getAttribute("data-folder-mosaic-span")).toBe("square")
    expect(view.container.querySelector('[data-folder-name="square.cbz"]')?.getAttribute("data-folder-mosaic-span")).toBe("square")
    expect(view.container.querySelectorAll('[data-folder-mosaic-ready="true"]')).toHaveLength(0)
    expect(onRangeChange).toHaveBeenCalledWith({ startIndex: 0, endIndex: 3 })

    const measured = view.container.querySelector('[data-folder-name="measured.cbz"]')!
    const image = measured.querySelector("img")!
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 800 },
      naturalHeight: { configurable: true, value: 1600 },
    })
    fireEvent.load(image)
    await waitFor(() => expect(measured.getAttribute("data-folder-mosaic-span")).toBe("tall"))
    expect(measured.getAttribute("data-folder-mosaic-ready")).toBe("true")
    expect((measured as HTMLElement).style.gridColumn).toBe("span 1")
    expect((measured as HTMLElement).style.gridRow).toBe("span 2")
    expect(image.className).toContain("object-contain")
  })

  it("keeps a 100K directory bounded to visible bento groups", async () => {
    const entries = Array.from({ length: 128 }, (_, index) => entry(`item-${index}.cbz`, 1000, 1000))
    const catalog = createDirectoryCatalog(page(entries, 100_000))
    const view = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 720, itemHeight: 420 }}>
        <FolderMosaicWorkspace
          virtualKey="mosaic:100k"
          mosaicRef={createRef<VirtuosoHandle>()}
          catalog={catalog}
          disabled={false}
          selectedPaths={new Set()}
          itemIdPrefix="mosaic"
          thumbnailUrls={new Map()}
          tileSize={96}
          hoverPreviewEnabled={false}
          hoverPreviewDelayMs={500}
          showReturnFooter={false}
          returnFooterContext={{ disabled: false, onReturn: vi.fn() }}
          onRangeChange={vi.fn()}
          onScrollTopChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </VirtuosoMockContext.Provider>,
    )

    await waitFor(() => expect(view.container.querySelectorAll('[data-folder-entry="true"]').length).toBeGreaterThan(0))
    expect(view.container.querySelectorAll('[data-folder-entry="true"]').length).toBeLessThan(128)
    expect(view.container.querySelectorAll("[data-folder-mosaic-group]").length).toBeLessThan(16)
  })
})

function entry(name: string, width?: number, height?: number): ReaderDirectoryEntryDto {
  return {
    name,
    path: `D:/library/${name}`,
    kind: "file",
    readerSupported: true,
    width,
    height,
  }
}

function page(entries: readonly ReaderDirectoryEntryDto[], total = entries.length): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-1",
    navigationEntryId: 1,
    path: "D:/library",
    total,
    cursor: 0,
    entries,
    generation: 1,
    canGoBack: false,
    canGoForward: false,
    filter: "all",
    filterOptions: ["all"],
    sort: { field: "name", order: "asc" },
    sortFields: ["name"],
    metadataFields: ["dimensions"],
    metadataCapabilities: ["dimensions"],
    sortSource: "global-default",
    sortTemporary: false,
    globalDefaultSort: { field: "name", order: "asc" },
    tabDefaultSort: { field: "name", order: "asc" },
    watching: false,
  }
}
