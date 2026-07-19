import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_PRESENTATION, type FramePage } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import { ReaderFrame } from "./ReaderFrame"

vi.mock("./PageMedia", () => ({ PageMedia: ({ page, imageTrim, imageTrimDetectionActive, presentationCropInsets }: { page: ReaderPageDto; imageTrim?: ReaderImageTrimPort; imageTrimDetectionActive?: boolean; presentationCropInsets?: { top: number; right: number; bottom: number; left: number } }) => <img alt={page.name} data-image-trim={imageTrim ? "true" : "false"} data-image-trim-detection-active={imageTrimDetectionActive ? "true" : "false"} data-presentation-crop={presentationCropInsets ? JSON.stringify(presentationCropInsets) : undefined} /> }))
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
})

function page(index: number, dimensions = { width: 1200, height: 1800 }): ReaderPageDto {
  return { id: `page-${index}`, index, name: `${String(index).padStart(3, "0")}.jpg`, mediaKind: "image", contentVersion: "v1", assetUrl: `https://reader.invalid/${index}.jpg`, dimensions }
}

function framePage(index: number, part: 0 | 1, cropInsets: NonNullable<FramePage["cropInsets"]>): FramePage {
  return { pageId: `page-${index}`, pageIndex: index, side: "single", part, cropInsets }
}
