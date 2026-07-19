import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_PRESENTATION } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import { ReaderFrame } from "./ReaderFrame"

vi.mock("./PageMedia", () => ({ PageMedia: ({ page, imageTrim, imageTrimDetectionActive }: { page: ReaderPageDto; imageTrim?: ReaderImageTrimPort; imageTrimDetectionActive?: boolean }) => <img alt={page.name} data-image-trim={imageTrim ? "true" : "false"} data-image-trim-detection-active={imageTrimDetectionActive ? "true" : "false"} /> }))
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
})

function page(index: number): ReaderPageDto {
  return { id: `page-${index}`, index, name: `${String(index).padStart(3, "0")}.jpg`, mediaKind: "image", contentVersion: "v1", assetUrl: `https://reader.invalid/${index}.jpg`, dimensions: { width: 1200, height: 1800 } }
}
