import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_PRESENTATION, type FramePage } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import { ReaderFrame } from "./ReaderFrame"

vi.mock("./PageMedia", () => ({ PageMedia: ({ page, scale, imageTrim, imageTrimDetectionActive, presentationCropInsets, onCommittedPage }: { page: ReaderPageDto; scale?: number; imageTrim?: ReaderImageTrimPort; imageTrimDetectionActive?: boolean; presentationCropInsets?: { top: number; right: number; bottom: number; left: number }; onCommittedPage?: (page: ReaderPageDto) => void }) => <img alt={page.name} data-scale={scale} data-image-trim={imageTrim ? "true" : "false"} data-image-trim-detection-active={imageTrimDetectionActive ? "true" : "false"} data-presentation-crop={presentationCropInsets ? JSON.stringify(presentationCropInsets) : undefined} onClick={() => onCommittedPage?.(page)} /> }))
vi.mock("../page-transition/ReaderPageTransitionLayer", () => ({ ReaderPageTransitionLayer: ({ children }: { children: React.ReactNode }) => <div data-reader-page-transition-layer="true">{children}</div> }))

afterEach(cleanup)

describe("ReaderFrame", () => {
  it("keeps a vertical double-page frame paired left-to-right while orientation controls browsing", () => {
    render(<div style={{ width: 1600, height: 900 }}><ReaderFrame pages={[page(0), page(1)]} presentation={{ ...DEFAULT_READER_PRESENTATION, orientation: "vertical" }} pageMode="double" totalPages={2} anchorPageIndex={0} sessionId="reader" client={{} as ReaderHttpClient} videoController={{} as ReaderVideoController} onSubtitleConfigChange={vi.fn()} onVideoListEnded={vi.fn()} /></div>)

    const frame = document.querySelector('[data-reader-frame="true"]')
    expect(frame?.className).not.toContain("flex-col")
    expect(document.querySelector('[data-reader-frame-viewport="true"]')?.getAttribute("data-reader-orientation")).toBe("vertical")
    expect([...frame!.querySelectorAll("img")].map((image) => image.alt)).toEqual(["000.jpg", "001.jpg"])
  })

  it("[neoview.reader.double-page-gap] defaults to no gap and supports negative overlap without remounting media", () => {
    const props = { pages: [page(0), page(1)], presentation: DEFAULT_READER_PRESENTATION, pageMode: "double" as const, totalPages: 2, anchorPageIndex: 0, sessionId: "reader", client: {} as ReaderHttpClient, videoController: {} as ReaderVideoController, onSubtitleConfigChange: vi.fn(), onVideoListEnded: vi.fn() }
    const view = render(<ReaderFrame {...props} />)
    const firstImage = view.container.querySelector<HTMLImageElement>('img[alt="000.jpg"]')
    const secondSlot = view.container.querySelector<HTMLElement>('[data-reader-page-slot="1"]')!

    expect(view.container.querySelector('[data-reader-frame]')?.getAttribute("data-reader-double-page-gap")).toBe("0")
    expect(secondSlot.style.marginInlineStart).toBe("0")

    view.rerender(<ReaderFrame {...props} doublePageGap={-18} />)
    expect(view.container.querySelector('[data-reader-frame]')?.getAttribute("data-reader-double-page-gap")).toBe("-18")
    expect(view.container.querySelector<HTMLElement>('[data-reader-page-slot="1"]')?.style.marginInlineStart).toBe("-18px")
    expect(view.container.querySelector<HTMLImageElement>('img[alt="000.jpg"]')).toBe(firstImage)
  })

  it("[neoview.image-trim.double-page] shares trim rendering while only the anchor physical page owns detection", () => {
    const imageTrim = {} as ReaderImageTrimPort
    render(<div style={{ width: 1600, height: 900 }}><ReaderFrame pages={[page(1), page(0)]} presentation={{ ...DEFAULT_READER_PRESENTATION, rotation: 90 }} pageMode="double" direction="right-to-left" totalPages={2} anchorPageIndex={0} imageTrim={imageTrim} sessionId="reader" client={{} as ReaderHttpClient} videoController={{} as ReaderVideoController} onSubtitleConfigChange={vi.fn()} onVideoListEnded={vi.fn()} /></div>)

    const images = [...document.querySelectorAll<HTMLImageElement>('[data-image-trim="true"]')]
    expect(images.map((image) => image.alt)).toEqual(["001.jpg", "000.jpg"])
    expect(images.map((image) => image.dataset.imageTrimDetectionActive)).toEqual(["false", "true"])
    expect(document.querySelector('[data-reader-page-transition-layer="true"]')).toBeTruthy()
    expect(document.querySelector('[data-reader-frame-viewport="true"]')?.getAttribute("data-reader-rotation")).toBe("90")
  })

  it("[neoview.reader.split-wide-pages] reuses one media element while switching typed physical-half crops", () => {
    const source = page(0, { width: 1600, height: 900 })
    const left = framePage(0, 0, { top: 0, right: 50, bottom: 0, left: 0 })
    const right = framePage(0, 1, { top: 0, right: 0, bottom: 0, left: 50 })
    const props = { pages: [source], presentation: DEFAULT_READER_PRESENTATION, pageMode: "single" as const, totalPages: 1, anchorPageIndex: 0, sessionId: "reader", client: {} as ReaderHttpClient, videoController: {} as ReaderVideoController, onSubtitleConfigChange: vi.fn(), onVideoListEnded: vi.fn() }
    const view = render(<ReaderFrame {...props} framePages={[left]} />)
    const media = view.container.querySelector<HTMLImageElement>("img")!
    expect(media.dataset.presentationCrop).toBe(JSON.stringify(left.cropInsets))

    view.rerender(<ReaderFrame {...props} framePages={[right]} />)
    expect(view.container.querySelector("img")).toBe(media)
    expect(media.dataset.presentationCrop).toBe(JSON.stringify(right.cropInsets))
  })

  it("[neoview.viewer.atomic-layout-commit] keeps the old frame scale until the next high-resolution image commits", () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000)
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800)
    try {
      const source = page(0, { width: 6240, height: 4160 })
      const target = page(1, { width: 4160, height: 6240 })
      const props = { presentation: DEFAULT_READER_PRESENTATION, pageMode: "single" as const, totalPages: 2, sessionId: "reader", client: {} as ReaderHttpClient, videoController: {} as ReaderVideoController, onSubtitleConfigChange: vi.fn(), onVideoListEnded: vi.fn() }
      const view = render(<ReaderFrame {...props} pages={[source]} anchorPageIndex={0} />)
      const initialScale = document.querySelector('[data-reader-frame-viewport="true"]')?.getAttribute("data-reader-effective-scale")

      view.rerender(<ReaderFrame {...props} pages={[target]} anchorPageIndex={1} />)
      expect(document.querySelector('[data-reader-frame-viewport="true"]')?.getAttribute("data-reader-effective-scale")).toBe(initialScale)

      fireEvent.click(view.container.querySelector("img")!)
      expect(document.querySelector('[data-reader-frame-viewport="true"]')?.getAttribute("data-reader-effective-scale")).not.toBe(initialScale)
    } finally {
      width.mockRestore()
      height.mockRestore()
    }
  })
})

function page(index: number, dimensions = { width: 1200, height: 1800 }): ReaderPageDto {
  return { id: `page-${index}`, index, name: `${String(index).padStart(3, "0")}.jpg`, mediaKind: "image", contentVersion: "v1", assetUrl: `https://reader.invalid/${index}.jpg`, dimensions }
}

function framePage(index: number, part: 0 | 1, cropInsets: NonNullable<FramePage["cropInsets"]>): FramePage {
  return { pageId: `page-${index}`, pageIndex: index, side: "single", part, cropInsets }
}
