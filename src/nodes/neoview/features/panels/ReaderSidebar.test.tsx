import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryPageDto, ReaderHttpClient, ReaderShellConfigDto } from "../../adapters/reader-http-client"
import type { ReaderPanelContext } from "./registry"
import { ReaderSidebar } from "./ReaderSidebar"

afterEach(cleanup)

describe("ReaderSidebar layout gestures", () => {
  it("[neoview.sidebar.panel-icons] uses Lucide icons for panel rail actions", () => {
    render(<ReaderSidebar side="left" context={context()} shell={shell()} />)

    const folder = screen.getByRole("button", { name: "文件夹" })
    expect(folder.querySelector("svg.lucide-folder")).toBeTruthy()
    expect(folder.textContent).not.toContain("📁")
  })

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

  it("uses an overlaid panel bar in a lane without a reserved rail column", () => {
    const selected = vi.fn()
    const panelBarChange = vi.fn()
    render(<ReaderSidebar side="left" presentation="lane" selectedPanelId="pageList" onSelectedPanelChange={selected} onPanelBarChange={panelBarChange} context={context()} shell={shell()} />)

    expect(document.querySelector('[data-reader-sidebar-presentation="lane"]')).toBeTruthy()
    expect(document.querySelector('[data-reader-panel-rail="left"]')).toBeNull()
    expect(document.querySelector('[data-reader-panel-bar="left"]')?.className).toContain("absolute")
    expect(screen.queryByRole("button", { name: "取消固定左侧栏" })).toBeNull()
    expect(screen.queryByRole("separator", { name: "调整左侧栏宽度" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "文件夹" }))
    expect(selected).toHaveBeenCalledWith("folder")
    const barHandle = screen.getByRole("button", { name: "拖动或设置面板操作栏" })
    fireEvent.contextMenu(barHandle)
    expect(screen.getByRole("menu", { name: "面板操作栏设置" })).toBeTruthy()
    fireEvent.contextMenu(barHandle)
    expect(screen.queryByRole("menu", { name: "面板操作栏设置" })).toBeNull()
    fireEvent.contextMenu(barHandle)
    fireEvent.click(screen.getByRole("menuitem", { name: "改为悬浮" }))
    expect(panelBarChange).toHaveBeenCalledWith({ panelBarMode: "floating", panelBarDock: "left" })
    fireEvent.contextMenu(barHandle)
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "限制在本泳道" }))
    expect(panelBarChange).toHaveBeenCalledWith({ panelBarConstrained: false })
  })

  it("combines the panel bar handle style with an independent right-side position", () => {
    const config = shell()
    config.workspace = workspace("top")
    config.workspace.swimlane.barHandleStyle = "groove"
    config.workspace.swimlane.barHandlePosition = "right"
    render(<section data-reader-swimlane="left">
      <header><div data-reader-panel-bar-title-slot="left" /></header>
      <ReaderSidebar side="left" presentation="lane" context={context()} shell={config} />
    </section>)

    const bar = document.querySelector<HTMLElement>('[data-reader-panel-bar="left"]')!
    const handle = screen.getByRole("button", { name: "拖动或设置面板操作栏" })
    expect(handle.dataset.readerBarHandleStyle).toBe("groove")
    expect(handle.dataset.readerBarHandlePosition).toBe("right")
    expect(bar.lastElementChild).toBe(handle)
  })

  it("shows four dock regions while dragging the lane panel bar and pins on drop", () => {
    const panelBarChange = vi.fn()
    render(<ReaderSidebar side="left" presentation="lane" context={context()} shell={shell()} onPanelBarChange={panelBarChange} />)
    const sidebar = document.querySelector<HTMLElement>('[data-reader-sidebar="left"]')!
    const bar = document.querySelector<HTMLElement>('[data-reader-panel-bar="left"]')!
    vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue(rect(0, 0, 320, 600))
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(rect(4, 200, 44, 220))

    fireEvent.pointerDown(screen.getByRole("button", { name: "拖动或设置面板操作栏" }), { pointerId: 21, button: 0, clientX: 20, clientY: 220 })
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 160, clientY: 596 })
    expect(document.querySelectorAll("[data-reader-panel-bar-dropzone]")).toHaveLength(4)
    expect(document.querySelector('[data-reader-panel-bar-dropzone="bottom"]')?.getAttribute("data-active")).toBe("true")
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 160, clientY: 596 })
    expect(panelBarChange).toHaveBeenLastCalledWith({ panelBarMode: "pinned", panelBarDock: "bottom" })
  })

  it("mounts a top-pinned panel bar horizontally in the lane title bar", async () => {
    const config = shell()
    config.workspace = workspace("top")
    render(<section data-reader-swimlane="left">
      <header data-reader-swimlane-header="left">
        <span>左侧面板</span>
        <div data-reader-panel-bar-title-slot="left" />
      </header>
      <ReaderSidebar side="left" presentation="lane" context={context()} shell={config} />
    </section>)

    await waitFor(() => {
      const slot = document.querySelector('[data-reader-panel-bar-title-slot="left"]')!
      const bar = slot.querySelector<HTMLElement>('[data-reader-panel-bar="left"]')
      expect(bar).toBeTruthy()
      expect(bar?.className).toContain("flex-row")
      expect(bar?.className).toContain("bg-transparent")
    })
  })

  it("keeps an unconstrained floating panel bar draggable after each release", () => {
    const panelBarChange = vi.fn()
    const config = shell()
    config.workspace = workspace("left")
    Object.assign(config.workspace.swimlane.lanes.left, {
      panelBarMode: "floating",
      panelBarConstrained: false,
      panelBarPositionX: 50,
      panelBarPositionY: 50,
    })
    render(<section data-reader-swimlane="left">
      <header><div data-reader-panel-bar-title-slot="left" /></header>
      <ReaderSidebar side="left" presentation="lane" context={context()} shell={config} onPanelBarChange={panelBarChange} />
    </section>)

    const sidebar = document.querySelector<HTMLElement>('[data-reader-sidebar="left"]')!
    const bar = document.querySelector<HTMLElement>('[data-reader-panel-bar="left"]')!
    vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue(rect(0, 0, 320, 600))
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(rect(400, 200, 444, 320))
    const handle = screen.getByRole("button", { name: "拖动或设置面板操作栏" })

    for (const pointerId of [31, 32]) {
      fireEvent.pointerDown(handle, { pointerId, button: 0, clientX: 420, clientY: 220 })
      fireEvent.pointerMove(window, { pointerId, clientX: 520, clientY: 360 })
      fireEvent.pointerUp(window, { pointerId, clientX: 520, clientY: 360 })
    }

    expect(panelBarChange).toHaveBeenCalledTimes(2)
    expect(panelBarChange).toHaveBeenLastCalledWith(expect.objectContaining({ panelBarMode: "floating" }))
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

  it("[neoview.shell.portrait-width] keeps rendered and dragged sidebars within half the viewport", () => {
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 })
    try {
      const commit = vi.fn()
      const config = shell()
      config.sidebars.left.width = 600
      render(<ReaderSidebar side="left" context={context()} shell={config} onLayoutCommit={commit} />)

      const sidebar = document.querySelector<HTMLElement>('[data-reader-sidebar="left"]')!
      const separator = sidebar.querySelector<HTMLElement>('[role="separator"]')!
      expect(sidebar.style.maxWidth).toBe("50vw")

      fireEvent.pointerDown(separator, { pointerId: 17, clientX: 600, clientY: 10 })
      fireEvent.pointerMove(separator, { pointerId: 17, clientX: 900, clientY: 10 })
      fireEvent.pointerUp(separator, { pointerId: 17, clientX: 900, clientY: 10 })
      expect(sidebar.style.width).toBe("300px")
      expect(commit).toHaveBeenCalledWith({ side: "left", width: 300 })
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth })
    }
  })

  it("[neoview.shell.drag] bounds position and corner size before one persistence commit", () => {
    const commit = vi.fn()
    const config = shell("half")
    config.sidebarInteraction = { showDragHandle: true, enableBlankAreaCollapse: true, blankAreaCollapseMode: "single" }
    render(<ReaderSidebar side="left" context={context()} shell={config} onLayoutCommit={commit} />)
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
    config.cardLayout["book-information"]!.panelId = "pageList"
    config.cardLayout["page-navigation"]!.expanded = false
    render(<ReaderSidebar side="left" context={context()} shell={config} onCardLayoutCommit={cardCommit} />)
    fireEvent.click(screen.getByRole("button", { name: "页面列表" }))

    expect(screen.queryByRole("spinbutton", { name: "跳转页码" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "展开页面导航" }))
    expect(cardCommit).toHaveBeenCalledOnce()
    expect(cardCommit).toHaveBeenCalledWith({ cardId: "page-navigation", expanded: true })
  })

  it("[neoview.card.resize-patch] applies stored height and emits one card patch after a drag", () => {
    const cardCommit = vi.fn()
    const config = shell()
    config.cardLayout["book-information"]!.panelId = "pageList"
    config.cardLayout["page-navigation"]!.height = 180
    render(<ReaderSidebar side="left" context={context()} shell={config} onCardLayoutCommit={cardCommit} />)
    fireEvent.click(screen.getByRole("button", { name: "页面列表" }))
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

  it("[neoview.folder.panel-keepalive] keeps the File Card session and DOM while another panel is active", async () => {
    const value = context()
    const opened = folderPage()
    const openDirectoryBrowser = vi.fn(async () => opened)
    const closeDirectoryBrowser = vi.fn(async () => undefined)
    const watchSignals: AbortSignal[] = []
    const watchDirectoryBrowser = vi.fn((_sessionId: string, _generation: number, _focusPath?: string, signal?: AbortSignal) => {
      watchSignals.push(signal!)
      return new Promise<undefined>((resolve) => signal?.addEventListener("abort", () => resolve(undefined), { once: true }))
    })
    Object.assign(value.client, { openDirectoryBrowser, closeDirectoryBrowser, watchDirectoryBrowser })
    value.sourcePath = opened.path

    const config = shell()
    const view = render(<ReaderSidebar side="left" context={value} shell={config} />)
    await waitFor(() => expect(document.querySelector('[data-neoview-folder-card="true"]')).toBeTruthy())
    const folderCard = document.querySelector<HTMLElement>('[data-neoview-folder-card="true"]')!
    folderCard.setAttribute("data-folder-card-instance", "stable")
    expect(document.querySelector('[data-reader-panel-cache="folder"] h2')).toBeNull()
    expect(document.querySelector('[data-reader-card="文件浏览"]')?.getAttribute("data-reader-card-chrome")).toBe("none")
    expect(screen.queryByRole("button", { name: "折叠文件浏览" })).toBeNull()
    await waitFor(() => expect(watchDirectoryBrowser).toHaveBeenCalledOnce())
    const folderPanel = document.querySelector<HTMLElement>('[data-reader-panel-cache="folder"]')!

    view.rerender(<ReaderSidebar side="left" context={value} shell={config} active={false} />)
    expect(folderPanel.getAttribute("data-reader-panel-active")).toBe("true")
    expect(folderPanel.getAttribute("data-reader-panel-visible")).toBe("false")
    expect(watchSignals[0]?.aborted).toBe(false)
    view.rerender(<ReaderSidebar side="left" context={value} shell={config} />)

    fireEvent.click(screen.getByRole("button", { name: "页面列表" }))
    await waitFor(() => expect(folderPanel.getAttribute("data-reader-panel-active")).toBe("false"))
    expect(folderPanel.hidden).toBe(false)
    expect(folderPanel.style.contentVisibility).toBe("hidden")
    await waitFor(() => expect(watchSignals[0]?.aborted).toBe(true))
    expect(folderCard.isConnected).toBe(true)
    expect(openDirectoryBrowser).toHaveBeenCalledOnce()
    expect(closeDirectoryBrowser).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "文件夹" }))
    await waitFor(() => expect(folderPanel.getAttribute("data-reader-panel-active")).toBe("true"))
    await waitFor(() => expect(watchDirectoryBrowser).toHaveBeenCalledTimes(2))
    expect(document.querySelector('[data-neoview-folder-card="true"]')?.getAttribute("data-folder-card-instance")).toBe("stable")
    expect(openDirectoryBrowser).toHaveBeenCalledOnce()
    expect(closeDirectoryBrowser).not.toHaveBeenCalled()

    config.cardLayout["page-navigation"]!.panelId = "folder"
    view.rerender(<ReaderSidebar side="left" context={value} shell={config} />)
    expect(document.querySelector('[data-neoview-folder-card="true"]')).toBe(folderCard)
    expect(document.querySelector('[data-reader-panel-cache="folder"] h2')?.textContent).toBe("文件夹")
    expect(document.querySelector('[data-reader-card="文件浏览"]')?.getAttribute("data-reader-card-chrome")).toBe("default")
    expect(screen.getByRole("button", { name: "折叠文件浏览" })).toBeTruthy()
  })

  it("[neoview.card.exclusive-panel] keeps an ordinary single-card panel framed", () => {
    render(<ReaderSidebar side="right" context={context()} shell={shell()} />)

    expect(screen.getByRole("heading", { name: "信息" })).toBeTruthy()
    expect(document.querySelector('[data-reader-card="书籍信息"]')?.getAttribute("data-reader-card-chrome")).toBe("default")
    expect(screen.getByRole("button", { name: "折叠书籍信息" })).toBeTruthy()
  })

  it("[neoview.card.exclusive-content] mounts File and History bodies directly when expanded is omitted", async () => {
    const config = shell()
    config.cardLayout["folder-main"] = { panelId: "folder", visible: true, order: 0 }
    config.cardLayout["history-list"] = { panelId: "history", visible: true, order: 0 }
    const value = context(false)
    const view = render(<ReaderSidebar side="left" selectedPanelId="folder" context={value} shell={config} />)

    await waitFor(() => expect(document.querySelector('[data-neoview-folder-card="true"]')).toBeTruthy())
    expect(document.querySelector('[data-reader-panel="folder"] [data-reader-card-deferred]')).toBeNull()
    expect(document.querySelector('[data-reader-panel="folder"] [data-slot="magic-card"]')).toBeNull()

    view.rerender(<ReaderSidebar side="left" selectedPanelId="history" context={value} shell={config} />)
    await waitFor(() => expect(document.querySelector('[data-neoview-history-card="true"]')).toBeTruthy())
    expect(document.querySelector('[data-reader-panel="history"] [data-reader-card-deferred]')).toBeNull()
    expect(document.querySelector('[data-reader-panel="history"] [data-slot="magic-card"]')).toBeNull()
  })

  it("[neoview.settings.sessionless-card] docks settings as a multi-card panel without exclusive chrome", () => {
    const config = shell()
    config.panelLayout.settings = { visible: true, order: 99, position: "left" }
    render(<ReaderSidebar side="left" context={context(false)} shell={config} />)
    fireEvent.click(screen.getByRole("button", { name: "设置" }))

    // Settings is multi-card, so it keeps the panel title chrome (unlike exclusive folder/history/bookmark).
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy()
    expect(document.querySelector('[data-reader-panel="settings"]')?.className).not.toContain("h-full")
    expect(screen.queryByRole("spinbutton", { name: "跳转页码" })).toBeNull()
  })

  it("[neoview.sidebar.viewport-cards] keeps deferred shells light and mounts near-viewport cards one idle task at a time", () => {
    vi.useFakeTimers()
    const observer = installIntersectionObserver()
    const idleCallbacks: Array<{ callback: IdleRequestCallback; options?: IdleRequestOptions }> = []
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback, options?: IdleRequestOptions) => {
      idleCallbacks.push({ callback, options })
      return idleCallbacks.length
    }))
    vi.stubGlobal("cancelIdleCallback", vi.fn())
    try {
      const config = shell()
      config.panelLayout.settings = { visible: true, order: 99, position: "left" }
      render(<ReaderSidebar side="left" selectedPanelId="settings" context={context(false)} shell={config} />)

      const panel = document.querySelector<HTMLElement>('[data-reader-panel="settings"]')!
      const mountedCards = () => panel.querySelectorAll("[data-reader-card]").length
      expect(mountedCards()).toBe(1)
      expect(panel.querySelectorAll("[data-reader-card-deferred]").length).toBeGreaterThan(2)
      expect(panel.querySelector('[data-slot="magic-card"]')).toBeNull()
      expect(observer.instances).toHaveLength(1)
      expect(observer.instances[0]!.options.root).toBe(panel)

      const targets = observer.instances[0]!.observed
      expect(targets.length).toBeGreaterThan(2)
      act(() => observer.instances[0]!.emit(targets.slice(0, 2), true))
      expect(idleCallbacks).toHaveLength(1)
      expect(idleCallbacks[0]!.options?.timeout).toBe(500)

      act(() => idleCallbacks[0]!.callback({ didTimeout: false, timeRemaining: () => 20 }))
      expect(mountedCards()).toBe(2)
      expect(targets[2]!.getAttribute("data-reader-card-deferred")).toBeTruthy()
      expect(idleCallbacks).toHaveLength(2)

      act(() => idleCallbacks[1]!.callback({ didTimeout: false, timeRemaining: () => 20 }))
      expect(mountedCards()).toBe(3)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it("[neoview.sidebar.viewport-cards] guarantees progress when the idle callback never runs", () => {
    vi.useFakeTimers()
    const observer = installIntersectionObserver()
    const idle = vi.fn((_callback: IdleRequestCallback) => 1)
    vi.stubGlobal("requestIdleCallback", idle)
    vi.stubGlobal("cancelIdleCallback", vi.fn())
    try {
      const config = shell()
      config.panelLayout.settings = { visible: true, order: 99, position: "left" }
      render(<ReaderSidebar side="left" selectedPanelId="settings" context={context(false)} shell={config} />)

      const panel = document.querySelector<HTMLElement>('[data-reader-panel="settings"]')!
      const mountedCards = () => panel.querySelectorAll("[data-reader-card]").length
      act(() => observer.instances[0]!.emit([observer.instances[0]!.observed[0]!], true))
      expect(idle).toHaveBeenCalledOnce()
      expect(mountedCards()).toBe(1)

      act(() => vi.advanceTimersByTime(600))
      expect(mountedCards()).toBe(2)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it("[neoview.sidebar.viewport-cards] cancels queued work when the active panel changes", () => {
    const observer = installIntersectionObserver()
    const idleCallbacks: IdleRequestCallback[] = []
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    }))
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback)
    try {
      const config = shell()
      config.panelLayout.settings = { visible: true, order: 99, position: "left" }
      const view = render(<ReaderSidebar side="left" selectedPanelId="settings" context={context(false)} shell={config} />)
      act(() => observer.instances[0]!.emit([observer.instances[0]!.observed[0]!], true))
      expect(idleCallbacks).toHaveLength(1)

      view.rerender(<ReaderSidebar side="left" selectedPanelId="pageList" context={context(false)} shell={config} />)
      expect(cancelIdleCallback).toHaveBeenCalled()
      act(() => idleCallbacks[0]!({ didTimeout: false, timeRemaining: () => 20 }))
      expect(document.querySelector('[data-reader-panel="pageList"]')?.getAttribute("data-reader-visible-card-count")).toBe("1")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("[neoview.shell.resident-cards] renders stable sessionless Card shells and empty states", () => {
    render(<ReaderSidebar side="left" context={context(false)} shell={shell()} />)
    expect(document.querySelector('[data-reader-panel-cache="pageList"] [data-reader-card-empty="true"]')).toBeTruthy()
    expect(screen.queryByRole("button", { name: "折叠页面导航" })).toBeNull()
  })

  it("[neoview.shell.resident-panel-cache] mounts every visible panel cache before its tab is clicked", () => {
    render(<ReaderSidebar side="left" context={context(false)} shell={shell()} />)

    expect(document.querySelector('[data-reader-panel-cache="folder"]')).toBeTruthy()
    expect(document.querySelector('[data-reader-panel-cache="history"]')).toBeTruthy()
    expect(document.querySelector('[data-reader-panel-cache="bookmark"]')).toBeTruthy()
    expect(document.querySelector('[data-reader-panel-cache="pageList"]')).toBeTruthy()
    // Settings is default-visible on the left rail and mounts with the resident panel cache.
    expect(document.querySelector('[data-reader-panel-cache="settings"]')).toBeTruthy()
  })

  it("[neoview.card.exclusive-fill] exclusive single-card panels fill the sidebar pane", () => {
    render(<ReaderSidebar side="left" context={context()} shell={shell()} />)

    const folderPanel = document.querySelector<HTMLElement>('[data-reader-panel-cache="folder"]')!
    expect(folderPanel.className).toContain("h-full")
    expect(folderPanel.className).toContain("w-full")
    expect(folderPanel.className).toContain("basis-full")
    expect(folderPanel.querySelector('[data-reader-card-chrome="none"]')?.className).toContain("h-full")
    expect(folderPanel.querySelector('[data-reader-card-chrome="none"]')?.className).toContain("w-full")
    expect(folderPanel.querySelector('[data-folder-tab-count]')?.className).toContain("h-full")
    expect(document.querySelector('[data-reader-panel-cache="folder"] h2')).toBeNull()

    for (const [buttonName, panelId] of [["历史记录", "history"], ["书签", "bookmark"], ["页面列表", "pageList"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: buttonName }))
      const panel = document.querySelector<HTMLElement>(`[data-reader-panel="${panelId}"]`)!
      expect(panel.className).toContain("h-full")
      expect(panel.className).toContain("w-full")
      expect(panel.className).toContain("basis-full")
      expect(panel.querySelector('[data-reader-card-chrome="none"]')).toBeTruthy()
      expect(panel.querySelector("h2")).toBeNull()
    }

    const pageListPanel = document.querySelector<HTMLElement>('[data-reader-panel="pageList"]')!
    expect(pageListPanel.querySelector('[data-neoview-page-list="true"]')?.className).toMatch(/h-full/)
    expect(pageListPanel.querySelector('[data-neoview-page-list="true"]')?.className).toMatch(/w-full/)
    expect(screen.queryByRole("button", { name: "折叠页面导航" })).toBeNull()
  })

  it("[neoview.sidebar-height.blank-collapse] collapses only blank sidebar clicks in the configured mode", () => {
    const shellControl = {
      setPinned: vi.fn(),
      requestOpen: vi.fn(),
    }
    const value = context()
    value.shellControl = shellControl as never
    const config = shell()
    config.sidebarInteraction = { showDragHandle: false, enableBlankAreaCollapse: true, blankAreaCollapseMode: "single" }
    render(<ReaderSidebar side="left" context={value} shell={config} />)
    const sidebar = document.querySelector<HTMLElement>('[data-reader-sidebar="left"]')!

    fireEvent.click(screen.getByRole("button", { name: "页面列表" }))
    expect(shellControl.setPinned).not.toHaveBeenCalled()
    fireEvent.click(sidebar)
    expect(shellControl.setPinned).toHaveBeenCalledWith("left", false)
    expect(shellControl.requestOpen).toHaveBeenCalledWith("left", false)
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

function workspace(leftDock: "left" | "right" | "top" | "bottom"): NonNullable<ReaderShellConfigDto["workspace"]> {
  return {
    mode: "swimlane",
    swimlane: {
      laneOrder: ["left", "reader", "right"],
      activeLane: "reader",
      readerSolo: false,
      readerWidthRatio: 0.72,
      edgeRevealDelayMs: 220,
      readerFocusOnHover: false,
      readerFocusHoverDelayMs: 420,
      lanes: {
        left: { width: 320, collapsed: false, panelBarMode: "pinned", panelBarDock: leftDock, panelBarPositionX: 8, panelBarPositionY: 50, panelBarConstrained: true },
        reader: { width: 960, collapsed: false },
        right: { width: 280, collapsed: false, panelBarMode: "pinned", panelBarDock: "right", panelBarPositionX: 92, panelBarPositionY: 50, panelBarConstrained: true },
      },
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
    updateSlideshow: vi.fn(),
    open: vi.fn(),
    listPages: vi.fn(async () => ({ pages: [], total: 1 })),
    navigate: vi.fn(),
    goTo: vi.fn(),
    updateSessionOptions: vi.fn(),
    close: vi.fn(),
  }
  return { client, disabled: false, onGoTo: vi.fn(), ...(hasSession ? { session } : {}) }
}

function folderPage(): ReaderDirectoryPageDto {
  const sort = { field: "name" as const, order: "asc" as const, directoriesFirst: true }
  return {
    sessionId: "browser-keepalive",
    navigationEntryId: 1,
    path: "C:/books",
    parentPath: "C:/",
    entries: [{ name: "only.cbz", path: "C:/books/only.cbz", kind: "file", readerSupported: true }],
    cursor: 0,
    total: 1,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
    sort,
    sortFields: ["name"],
    metadataFields: [],
    metadataCapabilities: [],
    sortSource: "global-default",
    sortTemporary: false,
    globalDefaultSort: sort,
    tabDefaultSort: sort,
    watching: true,
  }
}

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function installIntersectionObserver() {
  const instances: TestIntersectionObserver[] = []
  class TestIntersectionObserver {
    readonly observed: Element[] = []

    constructor(readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) {
      instances.push(this)
    }

    observe(target: Element): void {
      this.observed.push(target)
    }

    unobserve(_target: Element): void {}

    disconnect(): void {}

    takeRecords(): IntersectionObserverEntry[] {
      return []
    }

    emit(targets: readonly Element[], isIntersecting: boolean): void {
      this.callback(
        targets.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry),
        this as unknown as IntersectionObserver,
      )
    }
  }
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver)
  return { instances }
}
