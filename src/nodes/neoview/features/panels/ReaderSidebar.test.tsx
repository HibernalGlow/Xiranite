import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderShellConfigDto } from "../../adapters/reader-http-client"
import type { ReaderPanelContext } from "./registry"
import { ReaderSidebar } from "./ReaderSidebar"

afterEach(cleanup)

describe("ReaderSidebar layout gestures", () => {
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
  }
}

function context(): ReaderPanelContext {
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
    open: vi.fn(),
    listPages: vi.fn(async () => ({ pages: [], total: 1 })),
    navigate: vi.fn(),
    goTo: vi.fn(),
    close: vi.fn(),
  }
  return { session, client, disabled: false, onGoTo: vi.fn() }
}
