import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { VirtuosoMockContext } from "react-virtuoso"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_PRESENTATION } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import { ReaderPanoramaFrame } from "./ReaderPanoramaFrame"

vi.mock("./PageMedia", () => ({ PageMedia: ({ page, imageTrim, imageTrimDetectionActive }: { page: ReaderPageDto; imageTrim?: ReaderImageTrimPort; imageTrimDetectionActive?: boolean }) => <img alt={page.name} src={page.assetUrl} data-image-trim={imageTrim ? "true" : "false"} data-image-trim-detection-active={imageTrimDetectionActive ? "true" : "false"} /> }))

afterEach(cleanup)

describe("ReaderPanoramaFrame", () => {
  it("[neoview.viewer.panorama-sparse] [neoview.image-trim.layout-contract] applies trim to a sparse single-page panorama without expanding the virtual window", async () => {
    const current = page(0)
    const imageTrim = {} as ReaderImageTrimPort
    const listPages = vi.fn(async (_sessionId: string, cursor: number, limit: number) => ({
      pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)),
      total: 100_000,
    }))
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 1080, itemHeight: 800 }}>
        <div style={{ height: 1080, width: 1920 }}>
          <ReaderPanoramaFrame sessionId="reader-1" totalPages={100_000} anchorPageIndex={0} currentPages={[current]} pageMode="single" direction="left-to-right" presentation={{ ...DEFAULT_READER_PRESENTATION, orientation: "vertical" }} imageTrim={imageTrim} videoController={{} as ReaderVideoController} client={{ listPages } as ReaderHttpClient} onSubtitleConfigChange={vi.fn()} onVideoListEnded={vi.fn()} />
        </div>
      </VirtuosoMockContext.Provider>,
    )
    expect(await screen.findByRole("img", { name: "000.jpg" })).toBeTruthy()
    await waitFor(() => expect(listPages).toHaveBeenCalled())
    expect(listPages.mock.calls.length).toBeLessThanOrEqual(3)
    expect(document.querySelectorAll("[data-panorama-page]").length).toBeLessThan(10)
    expect(document.querySelector('[data-reader-panorama="true"]')?.getAttribute("data-reader-orientation")).toBe("vertical")
    expect(document.querySelector('[data-panorama-unit-wrapper]')?.className).toContain("justify-center")
    expect(document.querySelector('[alt="000.jpg"]')?.getAttribute("data-image-trim")).toBe("true")
    expect(document.querySelector('[alt="000.jpg"]')?.getAttribute("data-image-trim-detection-active")).toBe("true")
  })

  it("[neoview.image-trim.layout-contract] groups double-page panorama units, preserves RTL order and syncs the visible physical page", async () => {
    const visible = vi.fn()
    const imageTrim = {} as ReaderImageTrimPort
    const listPages = vi.fn(async (_sessionId: string, cursor: number, limit: number) => ({
      pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)),
      total: 8,
    }))
    const frameWindow = vi.fn(async () => ({
      frames: [{ generation: 1, anchorPageIndex: 0, direction: "right-to-left" as const, layout: { pageMode: "double" as const, panorama: true, singleFirstPage: false, singleLastPage: false, treatWidePageAsSingle: true }, pages: [{ pageId: "page-1", pageIndex: 1, side: "left" as const }, { pageId: "page-0", pageIndex: 0, side: "right" as const }], pageCount: 8, atStart: true, atEnd: false }],
      centerIndex: 0,
      radius: 4,
      visiblePages: [page(0), page(1)],
    }))
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 900, itemHeight: 600 }}>
        <div style={{ height: 900, width: 1600 }}>
          <ReaderPanoramaFrame sessionId="reader-2" totalPages={8} anchorPageIndex={0} currentPages={[page(1), page(0)]} pageMode="double" direction="right-to-left" presentation={{ ...DEFAULT_READER_PRESENTATION, orientation: "horizontal" }} imageTrim={imageTrim} videoController={{} as ReaderVideoController} client={{ listPages, frameWindow } as ReaderHttpClient} onSubtitleConfigChange={vi.fn()} onVideoListEnded={vi.fn()} onVisiblePageChange={visible} />
        </div>
      </VirtuosoMockContext.Provider>,
    )
    expect(document.querySelector('[data-reader-panorama="true"]')?.getAttribute("dir")).toBe("rtl")
    expect(document.querySelector('[data-reader-panorama="true"]')?.getAttribute("data-reader-page-mode")).toBe("double")
    await waitFor(() => {
      const unit = document.querySelector<HTMLElement>('[data-panorama-unit="0"]')
      expect([...unit!.querySelectorAll("img")].map((image) => image.alt)).toEqual(["001.jpg", "000.jpg"])
      expect([...unit!.querySelectorAll("img")].map((image) => image.getAttribute("data-image-trim"))).toEqual(["true", "true"])
      expect([...unit!.querySelectorAll("img")].map((image) => image.getAttribute("data-image-trim-detection-active"))).toEqual(["false", "true"])
      expect(unit?.style.flexDirection).toBe("row")
    })
    expect(frameWindow).toHaveBeenCalled()
    expect(listPages).not.toHaveBeenCalled()
  })
})

function page(index: number): ReaderPageDto {
  return { id: `page-${index}`, index, name: `${String(index).padStart(3, "0")}.jpg`, mediaKind: "image", contentVersion: "v1", assetUrl: `https://reader.invalid/${index}.jpg`, dimensions: { width: 1200, height: 1800 } }
}
