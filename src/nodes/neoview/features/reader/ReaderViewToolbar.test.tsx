import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_PRESENTATION, ReaderSlideshow } from "@xiranite/node-neoview/ui-core"

import { ReaderViewToolbar } from "./ReaderViewToolbar"

afterEach(cleanup)

describe("ReaderViewToolbar", () => {
  it("[neoview.viewer.toolbar] emits bounded zoom, fit, rotation and reset states", () => {
    const changed = vi.fn()
    const pageModeChanged = vi.fn()
    const slideshow = createSlideshow()
    const slideshowChanged = vi.fn()
    const view = render(<ReaderViewToolbar pageMode="single" presentation={DEFAULT_READER_PRESENTATION} onChange={changed} onPageModeChange={pageModeChanged} slideshow={slideshow} onSlideshowChange={slideshowChanged} />)

    expect(view.container.querySelector('[data-reader-toolbar-row="expanded"]')).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "展开缩放设置" }))
    expect(view.container.querySelector('[data-reader-toolbar-panel="zoom"]')).not.toBeNull()
    fireEvent.change(screen.getByRole("combobox", { name: "缩放模式" }), { target: { value: "original" } })
    expect(changed).toHaveBeenLastCalledWith({ fitMode: "original", manualScale: 1, rotation: 0 })
    fireEvent.click(screen.getByRole("button", { name: "放大" }))
    expect(changed).toHaveBeenLastCalledWith({ fitMode: "fit", manualScale: 1.1, rotation: 0 })
    fireEvent.click(screen.getByRole("button", { name: "展开旋转设置" }))
    expect(view.container.querySelector('[data-reader-toolbar-panel="zoom"]')).toBeNull()
    expect(view.container.querySelector('[data-reader-toolbar-panel="rotate"]')).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "顺时针" }))
    expect(changed).toHaveBeenLastCalledWith({ fitMode: "fit", manualScale: 1, rotation: 90 })

    fireEvent.click(screen.getByRole("button", { name: "双页模式" }))
    expect(pageModeChanged).toHaveBeenCalledWith("double")

    view.rerender(<ReaderViewToolbar pageMode="double" presentation={{ fitMode: "original", manualScale: 2, rotation: 180 }} onChange={changed} onPageModeChange={pageModeChanged} slideshow={slideshow} onSlideshowChange={slideshowChanged} />)
    expect(screen.getByRole("button", { name: "双页模式" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "展开缩放设置" }))
    fireEvent.click(screen.getByRole("button", { name: "重置视图" }))
    expect(changed).toHaveBeenLastCalledWith(DEFAULT_READER_PRESENTATION)
    slideshow.dispose()
  })
})

function createSlideshow(): ReaderSlideshow {
  return new ReaderSlideshow({
    readPosition: () => ({ pageCount: 1, currentPageIndex: 0, atEnd: true }),
    nextPage: vi.fn(async () => true),
    goToPage: vi.fn(async () => true),
  })
}
