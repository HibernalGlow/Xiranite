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
    // Adjacent-book controls stay disabled until the host wires openAdjacentBook.
    expect(screen.getByRole("button", { name: "上一个书籍" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: "下一个书籍" }).hasAttribute("disabled")).toBe(true)
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

  it("[neoview.toolbar.adjacent-book] routes previous/next book actions without touching layout patches", () => {
    const previousBook = vi.fn()
    const nextBook = vi.fn()
    const layoutChanged = vi.fn()
    const slideshow = createSlideshow()
    render(
      <ReaderViewToolbar
        layout={DEFAULT_READER_LAYOUT}
        direction="left-to-right"
        presentation={DEFAULT_READER_PRESENTATION}
        onChange={vi.fn()}
        onLayoutChange={layoutChanged}
        onDirectionChange={vi.fn()}
        slideshow={slideshow}
        onSlideshowChange={vi.fn()}
        onPreviousBook={previousBook}
        onNextBook={nextBook}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "上一个书籍" }))
    fireEvent.click(screen.getByRole("button", { name: "下一个书籍" }))
    expect(previousBook).toHaveBeenCalledOnce()
    expect(nextBook).toHaveBeenCalledOnce()
    expect(layoutChanged).not.toHaveBeenCalled()
    slideshow.dispose()
  })

  it("[neoview.toolbar.reading-direction-lock] preserves the legacy right-click lock and temporary direction switch", () => {
    const directionChanged = vi.fn()
    const lockChanged = vi.fn()
    const slideshow = createSlideshow()
    const props = {
      layout: DEFAULT_READER_LAYOUT,
      direction: "left-to-right" as const,
      presentation: DEFAULT_READER_PRESENTATION,
      onChange: vi.fn(),
      onLayoutChange: vi.fn(),
      onDirectionChange: directionChanged,
      onDirectionLockChange: lockChanged,
      slideshow,
      onSlideshowChange: vi.fn(),
    }
    const view = render(<ReaderViewToolbar {...props} lockedReadingDirection={null} />)
    const direction = view.getByRole("button", { name: "切换阅读方向" })

    fireEvent.contextMenu(direction)
    expect(lockChanged).toHaveBeenLastCalledWith("left-to-right")
    view.rerender(<ReaderViewToolbar {...props} lockedReadingDirection="left-to-right" />)
    expect(direction.className).toContain("bg-primary/20")
    expect(direction.className).toContain("text-primary")
    expect(direction.className).toContain("ring-2")
    expect(direction.getAttribute("title")).toBe("左开模式（已锁定，右键解锁）")
    fireEvent.click(direction)
    expect(directionChanged).toHaveBeenLastCalledWith("right-to-left")
    fireEvent.contextMenu(direction)
    expect(lockChanged).toHaveBeenLastCalledWith(null)
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

  it("[neoview.viewer.magnifier-toolbar] keeps enablement transient while committing bounded lens settings", () => {
    const enabledChanged = vi.fn()
    const configChanged = vi.fn()
    const slideshow = createSlideshow()
    const props = { layout: DEFAULT_READER_LAYOUT, direction: "left-to-right" as const, presentation: DEFAULT_READER_PRESENTATION, onChange: vi.fn(), onLayoutChange: vi.fn(), onDirectionChange: vi.fn(), magnifierZoom: 2, magnifierSize: 200, onMagnifierEnabledChange: enabledChanged, onMagnifierConfigChange: configChanged, slideshow, onSlideshowChange: vi.fn() }
    const view = render(<ReaderViewToolbar {...props} magnifierEnabled={false} />)

    fireEvent.click(screen.getByRole("button", { name: "放大镜" }))
    expect(enabledChanged).toHaveBeenCalledWith(true)
    expect(view.container.querySelector('[data-reader-toolbar-panel="magnifier"]')).not.toBeNull()
    const zoom = screen.getByRole("slider", { name: "放大倍率" })
    fireEvent.change(zoom, { target: { value: "3.4" } })
    fireEvent.pointerUp(zoom)
    fireEvent.blur(zoom)
    expect(configChanged).toHaveBeenCalledWith({ zoom: 3.4 })
    const size = screen.getByRole("slider", { name: "镜片大小" })
    fireEvent.change(size, { target: { value: "320" } })
    fireEvent.pointerUp(size)
    expect(configChanged).toHaveBeenLastCalledWith({ size: 320 })
    expect(configChanged).toHaveBeenCalledTimes(2)
    slideshow.dispose()
  })
})

function expectIcon(buttonName: string, iconClass: string) {
  expect(screen.getByRole("button", { name: buttonName }).querySelector(`svg.${iconClass}`)).not.toBeNull()
}

function createSlideshow(): ReaderSlideshow {
  return new ReaderSlideshow({ readPosition: () => ({ pageCount: 1, currentPageIndex: 0, atEnd: true }), nextPage: vi.fn(async () => true), goToPage: vi.fn(async () => true) })
}
