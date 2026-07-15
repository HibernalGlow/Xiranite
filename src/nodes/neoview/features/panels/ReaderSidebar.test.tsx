import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderShellConfigDto } from "../../adapters/reader-http-client"
import type { ReaderPanelContext } from "./registry"
import { ReaderSidebar } from "./ReaderSidebar"

afterEach(cleanup)

describe("ReaderSidebar layout gestures", () => {
  it("[neoview.shell.sidebar-pin] exposes and commits the legacy pin state from the icon rail", () => {
    const commit = vi.fn()
    const view = render(<ReaderSidebar side="left" context={context()} shell={shell()} onLayoutCommit={commit} />)
    const unpin = screen.getByRole("button", { name: "取消固定左侧栏" })
    expect(unpin.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(unpin)
    expect(commit).toHaveBeenCalledWith({ side: "left", pinned: false })

    const unpinned = shell()
    unpinned.edges.left.pinned = false
    view.rerender(<ReaderSidebar side="left" context={context()} shell={unpinned} onLayoutCommit={commit} />)
    fireEvent.click(screen.getByRole("button", { name: "固定左侧栏" }))
    expect(commit).toHaveBeenLastCalledWith({ side: "left", pinned: true })
  })

  it("[neoview.shell.resize-performance] mutates width outside React and commits once on pointer up", () => {
    const commit = vi.fn()
    render(<ReaderSidebar side="left" context={context()} shell={shell()} onLayoutCommit={commit} />)
    const separator = screen.getByRole("separator", { name: "调整左侧栏宽度" })
    const sidebar = document.querySelector<HTMLElement>('[data-reader-sidebar="left"]')!

    fireEvent.pointerDown(separator, { pointerId: 7, clientX: 320, clientY: 10 })
    for (let index = 1; index <= 100; index += 1) {
      fireEvent.pointerMove(separator, { pointerId: 7, clientX: 320 + index, clientY: 10 })
    }
    expect(commit).not.toHaveBeenCalled()
    expect(sidebar.style.width).toContain("420px")
    fireEvent.pointerUp(separator, { pointerId: 7, clientX: 420, clientY: 10 })
    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith({ side: "left", width: 420 })
  })

  it("[neoview.shell.drag] bounds position and corner size before one persistence commit", () => {
    const commit = vi.fn()
    render(<ReaderSidebar side="left" context={context()} shell={shell("half")} onLayoutCommit={commit} />)
    const move = screen.getByRole("button", { name: "移动左侧栏" })
    fireEvent.pointerDown(move, { pointerId: 8, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(move, { pointerId: 8, clientX: window.innerWidth, clientY: window.innerHeight })
    fireEvent.pointerUp(move, { pointerId: 8, clientX: window.innerWidth, clientY: window.innerHeight })
    expect(commit).toHaveBeenLastCalledWith({ side: "left", horizontalPosition: 100, verticalAlign: 100 })

    const corner = screen.getByRole("button", { name: "调整左侧栏大小" })
    fireEvent.pointerDown(corner, { pointerId: 9, clientX: 320, clientY: 0 })
    fireEvent.pointerMove(corner, { pointerId: 9, clientX: 500, clientY: window.innerHeight })
    expect(commit).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(corner, { pointerId: 9, clientX: 500, clientY: window.innerHeight })
    expect(commit).toHaveBeenLastCalledWith({ side: "left", width: 500, height: "custom", customHeight: 100 })
  })

  it("[neoview.card.collapse] keeps collapsed card content out of the DOM and emits one discrete patch", () => {
    const cardCommit = vi.fn()
    const config = shell()
    config.cardLayout["page-navigation"]!.expanded = false
    render(<ReaderSidebar side="left" context={context()} shell={config} onCardLayoutCommit={cardCommit} />)

    expect(screen.queryByRole("spinbutton", { name: "跳转页码" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "展开页面导航" }))
    expect(cardCommit).toHaveBeenCalledOnce()
    expect(cardCommit).toHaveBeenCalledWith({ cardId: "page-navigation", expanded: true })
  })

  it("[neoview.card.resize-patch] applies stored height and emits one card patch after a drag", () => {
    const cardCommit = vi.fn()
    const config = shell()
    config.cardLayout["page-navigation"]!.height = 180
    render(<ReaderSidebar side="left" context={context()} shell={config} onCardLayoutCommit={cardCommit} />)
    const content = document.querySelector<HTMLElement>('[data-reader-card-content="页面导航"]')!
    const handle = screen.getByRole("button", { name: "调整页面导航高度" })

    expect(content.style.height).toBe("180px")
    fireEvent.pointerDown(handle, { pointerId: 18, clientY: 100 })
    for (let index = 1; index <= 40; index += 1) {
      fireEvent.pointerMove(handle, { pointerId: 18, clientY: 100 + index })
    }
    expect(cardCommit).not.toHaveBeenCalled()
    fireEvent.pointerUp(handle, { pointerId: 18, clientY: 140 })
    expect(cardCommit).toHaveBeenCalledOnce()
    expect(cardCommit).toHaveBeenCalledWith({ cardId: "page-navigation", height: 220 })
  })

  it("[neoview.settings.sessionless-card] exposes only docked setting cards when no book is open", () => {
    const config = shell()
    config.panelLayout.settings = { visible: true, order: 99, position: "left" }
    config.cardLayout["panel-layout-settings"] = { panelId: "settings", visible: true, expanded: false, order: 0 }
    render(<ReaderSidebar side="left" context={context(false)} shell={config} />)

    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "展开面板布局设置" })).toBeTruthy()
    expect(screen.queryByRole("spinbutton", { name: "跳转页码" })).toBeNull()
  })
})

function shell(height: ReaderShellConfigDto["sidebars"]["left"]["height"] = "full"): ReaderShellConfigDto {
  return {
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height, customHeight: 50, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    panelLayout: {
      pageList: { visible: true, order: 3, position: "left" },
      info: { visible: true, order: 0, position: "right" },
    },
    cardLayout: {
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
    },
  }
}

function context(hasSession = true): ReaderPanelContext {
  const session = {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "demo.cbz", pageCount: 1 },
    frame: {
      generation: 0,
      anchorPageIndex: 0,
      direction: "left-to-right" as const,
      layout: { pageMode: "single" as const, panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [],
      pageCount: 1,
      atStart: true,
      atEnd: true,
    },
    visiblePages: [],
  }
  const client: ReaderHttpClient = {
    config: vi.fn(),
    updateSidebarLayout: vi.fn(),
    updateCardLayout: vi.fn(),
    updateBoardLayout: vi.fn(),
    updateViewDefaults: vi.fn(),
    open: vi.fn(),
    listPages: vi.fn(async () => ({ pages: [], total: 1 })),
    navigate: vi.fn(),
    goTo: vi.fn(),
    updateSessionOptions: vi.fn(),
    close: vi.fn(),
  }
  return { client, disabled: false, onGoTo: vi.fn(), ...(hasSession ? { session } : {}) }
}
