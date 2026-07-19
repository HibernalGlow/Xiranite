import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_LAYOUT, DEFAULT_READER_PRESENTATION, ReaderSlideshow } from "@xiranite/node-neoview/ui-core"

import { ReaderViewToolbar } from "./ReaderViewToolbar"

afterEach(cleanup)

describe("ReaderViewToolbar", () => {
  it("[neoview.viewer.toolbar-layout] preserves the legacy layout hierarchy and emits strict session patches", () => {
    const layoutChanged = vi.fn()
    const directionChanged = vi.fn()
    const changed = vi.fn()
    const slideshow = createSlideshow()
    const view = render(<ReaderViewToolbar layout={DEFAULT_READER_LAYOUT} direction="left-to-right" presentation={DEFAULT_READER_PRESENTATION} onChange={changed} onLayoutChange={layoutChanged} onDirectionChange={directionChanged} slideshow={slideshow} onSlideshowChange={vi.fn()} />)

    expectIcon("展开缩放设置", "lucide-maximize")
    expectIcon("全景模式", "lucide-panels-top-left")
    expectIcon("切换横向或纵向布局", "lucide-arrow-left-right")
    expectIcon("单页模式", "lucide-rectangle-vertical")
    expectIcon("切换阅读方向", "lucide-arrow-right")
    expectIcon("展开旋转设置", "lucide-rotate-cw")
    fireEvent.click(screen.getByRole("button", { name: "全景模式" }))
    expect(layoutChanged).toHaveBeenLastCalledWith({ panorama: true })
    fireEvent.click(screen.getByRole("button", { name: "切换横向或纵向布局" }))
    expect(changed).toHaveBeenLastCalledWith({ ...DEFAULT_READER_PRESENTATION, orientation: "vertical" })
    fireEvent.click(screen.getByRole("button", { name: "单页模式" }))
    expect(layoutChanged).toHaveBeenLastCalledWith({ pageMode: "double" })
    fireEvent.click(screen.getByRole("button", { name: "切换阅读方向" }))
    expect(directionChanged).toHaveBeenLastCalledWith("right-to-left")

    fireEvent.click(screen.getByRole("button", { name: "展开缩放设置" }))
    expect(view.container.querySelector('[data-reader-toolbar-panel="zoom"]')).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "首页独立显示" }))
    expect(layoutChanged).toHaveBeenLastCalledWith({ singleFirstPage: false })
    fireEvent.click(screen.getByRole("button", { name: "自动分割横向页" }))
    expect(layoutChanged).toHaveBeenLastCalledWith({ splitWidePages: true })
    fireEvent.click(screen.getByRole("button", { name: "横向页视为双页" }))
    expect(layoutChanged).toHaveBeenLastCalledWith({ treatWidePageAsSingle: false })
    expectIcon("无对齐", "lucide-equal")
    expectIcon("双页高度统一", "lucide-align-vertical-space-around")
    expectIcon("双页宽度统一", "lucide-align-horizontal-space-around")
    fireEvent.click(screen.getByRole("button", { name: "双页高度统一" }))
    expect(changed).toHaveBeenLastCalledWith({ ...DEFAULT_READER_PRESENTATION, widePageStretch: "uniform-height" })
    slideshow.dispose()
  })

  it("[neoview.viewer.toolbar-rotation] exposes all seven legacy automatic rotation choices", () => {
    const changed = vi.fn()
    const slideshow = createSlideshow()
    render(<ReaderViewToolbar layout={DEFAULT_READER_LAYOUT} direction="left-to-right" presentation={DEFAULT_READER_PRESENTATION} onChange={changed} onLayoutChange={vi.fn()} onDirectionChange={vi.fn()} slideshow={slideshow} onSlideshowChange={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "展开旋转设置" }))
    for (const name of ["关闭自动旋转", "纵向页左旋", "纵向页右旋", "横屏左旋 90°", "横屏右旋 90°", "始终左旋 90°", "始终右旋 90°"]) expect(screen.getByRole("button", { name })).toBeTruthy()
    expectIcon("关闭自动旋转", "lucide-ban")
    expectIcon("纵向页左旋", "lucide-rotate-ccw")
    expectIcon("纵向页右旋", "lucide-rotate-cw")
    expectIcon("横屏左旋 90°", "lucide-smartphone")
    expectIcon("始终右旋 90°", "lucide-rotate-cw")
    fireEvent.click(screen.getByRole("button", { name: "横屏右旋 90°" }))
    expect(changed).toHaveBeenLastCalledWith({ ...DEFAULT_READER_PRESENTATION, autoRotation: "horizontal-right" })
    fireEvent.click(screen.getByRole("button", { name: "顺时针旋转 90°" }))
    expect(changed).toHaveBeenLastCalledWith({ ...DEFAULT_READER_PRESENTATION, rotation: 90 })
    slideshow.dispose()
  })

  it("[neoview.viewer.hover-scroll-toolbar] preserves left-click toggle, right-click settings and bounded speed", () => {
    const hoverChanged = vi.fn()
    const slideshow = createSlideshow()
    const view = render(<ReaderViewToolbar layout={DEFAULT_READER_LAYOUT} direction="left-to-right" presentation={DEFAULT_READER_PRESENTATION} onChange={vi.fn()} onLayoutChange={vi.fn()} onDirectionChange={vi.fn()} hoverScrollEnabled hoverScrollSpeed={2} onHoverScrollChange={hoverChanged} slideshow={slideshow} onSlideshowChange={vi.fn()} />)

    const toggle = screen.getByRole("button", { name: "悬停滚动" })
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(toggle)
    expect(hoverChanged).toHaveBeenLastCalledWith({ enabled: false })
    fireEvent.contextMenu(toggle)
    expect(view.container.querySelector('[data-reader-toolbar-panel="hover-scroll"]')).not.toBeNull()
    expect(screen.getByText("2.0x")).toBeTruthy()
    fireEvent.change(screen.getByRole("slider", { name: "悬停滚动倍率" }), { target: { value: "4.5" } })
    fireEvent.pointerUp(screen.getByRole("slider", { name: "悬停滚动倍率" }))
    fireEvent.blur(screen.getByRole("slider", { name: "悬停滚动倍率" }))
    expect(hoverChanged).toHaveBeenLastCalledWith({ speed: 4.5 })
    expect(hoverChanged).toHaveBeenCalledTimes(2)
    slideshow.dispose()
  })
})

function expectIcon(buttonName: string, iconClass: string) {
  expect(screen.getByRole("button", { name: buttonName }).querySelector(`svg.${iconClass}`)).not.toBeNull()
}

function createSlideshow(): ReaderSlideshow {
  return new ReaderSlideshow({ readPosition: () => ({ pageCount: 1, currentPageIndex: 0, atEnd: true }), nextPage: vi.fn(async () => true), goToPage: vi.fn(async () => true) })
}
