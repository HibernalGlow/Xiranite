import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_PRESENTATION } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import { ReaderFrame } from "./ReaderFrame"

vi.mock("./PageMedia", () => ({ PageMedia: ({ page }: { page: ReaderPageDto }) => <img alt={page.name} /> }))
vi.mock("../page-transition/ReaderPageTransitionLayer", () => ({ ReaderPageTransitionLayer: ({ children }: { children: React.ReactNode }) => children }))

afterEach(cleanup)

describe("ReaderFrame", () => {
  it("keeps a vertical double-page frame paired left-to-right while orientation controls browsing", () => {
    render(<div style={{ width: 1600, height: 900 }}><ReaderFrame pages={[page(0), page(1)]} presentation={{ ...DEFAULT_READER_PRESENTATION, orientation: "vertical" }} pageMode="double" totalPages={2} anchorPageIndex={0} sessionId="reader" client={{} as ReaderHttpClient} videoController={{} as ReaderVideoController} onSubtitleConfigChange={vi.fn()} onVideoListEnded={vi.fn()} /></div>)

    const frame = document.querySelector('[data-reader-frame="true"]')
    expect(frame?.className).not.toContain("flex-col")
    expect(frame?.parentElement?.parentElement?.getAttribute("data-reader-orientation")).toBe("vertical")
    expect([...frame!.querySelectorAll("img")].map((image) => image.alt)).toEqual(["000.jpg", "001.jpg"])
  })
})

function page(index: number): ReaderPageDto {
  return { id: `page-${index}`, index, name: `${String(index).padStart(3, "0")}.jpg`, mediaKind: "image", contentVersion: "v1", assetUrl: `https://reader.invalid/${index}.jpg`, dimensions: { width: 1200, height: 1800 } }
}
