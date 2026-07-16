import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS, type ReaderHttpClient, type ReaderRuntimeConfigDto, type ReaderSessionDto, type ReaderShellConfigDto, type ReaderSlideshowPatch, type ReaderViewDefaultsPatch } from "../adapters/reader-http-client"
import { ReaderApp } from "./ReaderApp"

afterEach(cleanup)

describe("ReaderApp", () => {
  it("[neoview.react.smoke] opens and navigates with DOM img elements over asset URLs", async () => {
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    const client: ReaderHttpClient = {
      config: vi.fn(async () => runtimeConfig()),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({ pages: opened.visiblePages, total: 2 })),
      navigate: vi.fn(async () => ({
        frame: { ...opened.frame, anchorPageIndex: 1, pages: [{ pageId: "page-2", pageIndex: 1, side: "single" }], atStart: false, atEnd: true },
        visiblePages: [{ ...opened.visiblePages[0]!, id: "page-2", index: 1, name: "002.jpg", assetUrl: "http://127.0.0.1:41000/reader/page-2" }],
      })),
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    const committed = vi.fn()
    const view = render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} onPathCommitted={committed} />)

    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    const firstImage = await screen.findByRole("img", { name: "001.jpg" })
    expect(firstImage.tagName).toBe("IMG")
    expect(firstImage.getAttribute("src")).toContain("page-1")
    expect(document.querySelector("canvas")).toBeNull()
    expect(committed).toHaveBeenCalledWith("D:/books/demo.cbz")

    fireEvent.keyDown(screen.getByRole("textbox", { name: "漫画、图片或目录路径" }), { key: "ArrowRight" })
    expect(client.navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "下一页" }))
    const secondImage = await screen.findByRole("img", { name: "002.jpg" })
    expect(secondImage.getAttribute("src")).toContain("page-2")
    expect(screen.getByText("2 / 2")).toBeTruthy()

    view.unmount()
    await waitFor(() => expect(client.close).toHaveBeenCalledWith("reader-1"))
  })

  it("[neoview.react.lifecycle] aborts superseded work and reports backend errors", async () => {
    let rejectOpen!: (error: Error) => void
    const client: ReaderHttpClient = {
      config: vi.fn(async () => runtimeConfig()),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn((_path, signal) => new Promise((_resolve, reject) => {
        rejectOpen = reject
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
      })),
      listPages: vi.fn(),
      navigate: vi.fn(),
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    const view = render(<ReaderApp initialPath="D:/books/missing.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    view.unmount()
    await act(async () => rejectOpen(new Error("missing")))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("[neoview.viewer.defaults-react] applies persisted fit mode and updates current/default page mode", async () => {
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    const secondPage = { ...opened.visiblePages[0]!, id: "page-2", index: 1, name: "002.jpg", assetUrl: "http://127.0.0.1:41000/reader/page-2" }
    const updateViewDefaults = vi.fn(async (patch) => ({ fitMode: "fit-height" as const, pageMode: "single" as const, ...patch.viewDefaults }))
    const updateSessionOptions = vi.fn(async () => ({
      frame: {
        ...opened.frame,
        layout: { ...opened.frame.layout, pageMode: "double" as const },
        pages: [
          { pageId: "page-1", pageIndex: 0, side: "left" as const },
          { pageId: "page-2", pageIndex: 1, side: "right" as const },
        ],
      },
      visiblePages: [opened.visiblePages[0]!, secondPage],
    }))
    const client: ReaderHttpClient = {
      config: vi.fn(async () => ({ ...runtimeConfig(), viewDefaults: { fitMode: "fit-height", pageMode: "single" } })),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults,
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({ pages: [opened.visiblePages[0]!, secondPage], total: 2 })),
      navigate: vi.fn(),
      goTo: vi.fn(),
      updateSessionOptions,
      close: vi.fn(async () => undefined),
    }
    render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    expect((await screen.findByRole("combobox", { name: "缩放模式" }) as HTMLSelectElement).value).toBe("fit-height")

    fireEvent.change(screen.getByRole("combobox", { name: "缩放模式" }), { target: { value: "original" } })
    await waitFor(() => expect(updateViewDefaults).toHaveBeenCalledWith({ viewDefaults: { fitMode: "original" } }))
    fireEvent.click(screen.getByRole("button", { name: "双页模式" }))
    await waitFor(() => expect(updateSessionOptions).toHaveBeenCalledWith(
      "reader-1",
      { layout: { pageMode: "double" } },
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(updateViewDefaults).toHaveBeenCalledWith({ viewDefaults: { pageMode: "double" } }))
    expect(document.querySelectorAll("[data-reader-page-image]")).toHaveLength(2)
  })

  it("[neoview.viewer.defaults-write-queue] serializes defaults written from independent controls", async () => {
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    let finishFirstWrite!: (value: { fitMode: "original"; pageMode: "single" }) => void
    const updateViewDefaults = vi.fn((patch: ReaderViewDefaultsPatch) => updateViewDefaults.mock.calls.length === 1
      ? new Promise<{ fitMode: "original"; pageMode: "single" }>((resolve) => { finishFirstWrite = resolve })
      : Promise.resolve({ fitMode: "original" as const, pageMode: patch.viewDefaults.pageMode ?? "single" as const }))
    const client: ReaderHttpClient = {
      config: vi.fn(async () => runtimeConfig()),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults,
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({ pages: opened.visiblePages, total: 1 })),
      navigate: vi.fn(),
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(async () => ({
        frame: { ...opened.frame, layout: { ...opened.frame.layout, pageMode: "double" as const } },
        visiblePages: opened.visiblePages,
      })),
      close: vi.fn(async () => undefined),
    }

    render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    fireEvent.change(await screen.findByRole("combobox", { name: "缩放模式" }), { target: { value: "original" } })
    await waitFor(() => expect(updateViewDefaults).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "双页模式" }))
    await waitFor(() => expect(client.updateSessionOptions).toHaveBeenCalledTimes(1))
    expect(updateViewDefaults).toHaveBeenCalledTimes(1)

    await act(async () => finishFirstWrite({ fitMode: "original", pageMode: "single" }))
    await waitFor(() => expect(updateViewDefaults).toHaveBeenCalledTimes(2))
    expect(updateViewDefaults.mock.calls[1]?.[0]).toEqual({ viewDefaults: { pageMode: "double" } })
  })

  it("[neoview.slideshow.config-react] loads and serializes slideshow settings", async () => {
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    let finishFirstWrite!: (value: ReaderRuntimeConfigDto["slideshow"]) => void
    const updateSlideshow = vi.fn((patch: ReaderSlideshowPatch) => updateSlideshow.mock.calls.length === 1
      ? new Promise<ReaderRuntimeConfigDto["slideshow"]>((resolve) => { finishFirstWrite = resolve })
      : Promise.resolve({ intervalSeconds: 10, loop: patch.slideshow.loop ?? false, random: false, fadeTransition: true }))
    const client: ReaderHttpClient = {
      config: vi.fn(async () => ({ ...runtimeConfig(), slideshow: { intervalSeconds: 9, loop: false, random: false, fadeTransition: true } })),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow,
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({ pages: opened.visiblePages, total: 1 })),
      navigate: vi.fn(),
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }

    render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    const interval = await screen.findByRole("spinbutton", { name: "幻灯片间隔" }) as HTMLInputElement
    await waitFor(() => expect(interval.value).toBe("9"))
    fireEvent.change(interval, { target: { value: "10" } })
    await waitFor(() => expect(updateSlideshow).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "循环播放" }))
    expect(updateSlideshow).toHaveBeenCalledTimes(1)

    await act(async () => finishFirstWrite({ intervalSeconds: 10, loop: false, random: false, fadeTransition: true }))
    await waitFor(() => expect(updateSlideshow).toHaveBeenCalledTimes(2))
    expect(updateSlideshow.mock.calls[1]?.[0]).toEqual({ slideshow: { loop: true } })
    await waitFor(() => expect(screen.getByRole("button", { name: "循环播放" }).getAttribute("aria-pressed")).toBe("true"))
    fireEvent.change(interval, { target: { value: "" } })
    await waitFor(() => expect(updateSlideshow).toHaveBeenCalledTimes(3))
    expect(updateSlideshow.mock.calls[2]?.[0]).toEqual({ slideshow: { intervalSeconds: 1 } })
  })

  it("[neoview.react.open-cancel] closes a session that resolves after the reader unmounts", async () => {
    let resolveOpen!: (value: ReaderSessionDto) => void
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    const client: ReaderHttpClient = {
      config: vi.fn(async () => runtimeConfig()),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(() => new Promise((resolve) => { resolveOpen = resolve })),
      listPages: vi.fn(),
      navigate: vi.fn(),
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    const view = render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    view.unmount()
    await act(async () => resolveOpen(opened))
    await waitFor(() => expect(client.close).toHaveBeenCalledWith("reader-1"))
  })

  it("[neoview.thumbnail.react-list] navigates the shared reader session from a thumbnail", async () => {
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    const secondPage = {
      ...opened.visiblePages[0]!,
      id: "page-2",
      index: 1,
      name: "002.jpg",
      assetUrl: "http://127.0.0.1:41000/reader/page-2",
      thumbnailUrl: "http://127.0.0.1:41000/reader/thumbnail-2",
    }
    const client: ReaderHttpClient = {
      config: vi.fn(async () => runtimeConfig()),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({
        pages: [{ ...opened.visiblePages[0]!, thumbnailUrl: "http://127.0.0.1:41000/reader/thumbnail-1" }, secondPage],
        total: 2,
      })),
      navigate: vi.fn(),
      goTo: vi.fn(async () => ({
        frame: { ...opened.frame, anchorPageIndex: 1, pages: [{ pageId: "page-2", pageIndex: 1, side: "single" }], atStart: false, atEnd: true },
        visiblePages: [secondPage],
      })),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    fireEvent.click(await screen.findByRole("button", { name: "转到第 2 页：002.jpg" }))
    await screen.findByRole("img", { name: "002.jpg" })
    expect(client.goTo).toHaveBeenCalledWith("reader-1", 1, expect.any(AbortSignal))
  })

  it("[neoview.settings.shell-react] applies late shell config without remounting the active image", async () => {
    let resolveConfig!: (value: ReaderRuntimeConfigDto) => void
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    const client: ReaderHttpClient = {
      config: vi.fn(() => new Promise((resolve) => { resolveConfig = resolve })),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({ pages: opened.visiblePages, total: 2 })),
      navigate: vi.fn(),
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    const imageBeforeConfig = await screen.findByRole("img", { name: "001.jpg" })
    fireEvent.change(screen.getByRole("combobox", { name: "缩放模式" }), { target: { value: "original" } })
    await act(async () => resolveConfig({
      ...runtimeConfig(),
      shell: {
      ...shellConfig(),
      showDelayMs: 125,
      edges: {
        ...shellConfig().edges,
        top: { enabled: true, initialVisible: false, pinned: false, triggerSize: 5 },
        left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 9 },
      },
        sidebars: {
          ...shellConfig().sidebars,
          left: { width: 444, height: "half", customHeight: 100, verticalAlign: 50, horizontalPosition: 0 },
        },
      },
    }))
    expect(screen.queryByRole("textbox", { name: "漫画、图片或目录路径" })).toBeNull()
    expect(document.querySelector<HTMLElement>('[data-reader-edge-trigger="top"]')?.style.height).toBe("5px")
    expect(screen.getByRole("img", { name: "001.jpg" })).toBe(imageBeforeConfig)
    expect(document.querySelector('[data-reader-frame-viewport="true"]')?.getAttribute("data-reader-fit-mode")).toBe("original")
  })

  it("[neoview.card.persist-react] optimistically unmounts card content before persistence finishes", async () => {
    let finishUpdate!: (value: ReaderShellConfigDto) => void
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    const config = shellConfig()
    config.edges.left = { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 }
    const client: ReaderHttpClient = {
      config: vi.fn(async () => ({ ...runtimeConfig(), shell: config })),
      updateSidebarLayout: vi.fn(async () => config),
      updateCardLayout: vi.fn(() => new Promise((resolve) => { finishUpdate = resolve })),
      updateBoardLayout: vi.fn(async () => config),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({ pages: opened.visiblePages, total: 2 })),
      navigate: vi.fn(),
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    fireEvent.click(await screen.findByRole("button", { name: "页面列表" }))
    await screen.findByRole("button", { name: "折叠页面导航" })
    expect(await screen.findByRole("spinbutton", { name: "跳转页码" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "折叠页面导航" }))
    expect(screen.queryByRole("spinbutton", { name: "跳转页码" })).toBeNull()
    expect(client.updateCardLayout).toHaveBeenCalledWith({ cardId: "page-navigation", expanded: false })
    await act(async () => finishUpdate({
      ...config,
      cardLayout: { ...config.cardLayout, "page-navigation": { ...config.cardLayout["page-navigation"]!, expanded: false } },
    }))
  })

  it("[neoview.settings.sessionless-card] mounts an explicitly docked setting card without opening a book", async () => {
    const config = shellConfig()
    config.edges.left = { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 }
    config.panelLayout.settings = { visible: true, order: 99, position: "left" }
    config.cardLayout["panel-layout-settings"] = { panelId: "settings", visible: true, expanded: false, order: 0 }
    const client: ReaderHttpClient = {
      config: vi.fn(async () => ({ ...runtimeConfig(), shell: config })),
      updateSidebarLayout: vi.fn(),
      updateCardLayout: vi.fn(),
      updateBoardLayout: vi.fn(),
      updateViewDefaults: vi.fn(),
      updateSlideshow: vi.fn(),
      open: vi.fn(),
      listPages: vi.fn(),
      navigate: vi.fn(),
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(),
    }

    render(<ReaderApp client={client} />)
    fireEvent.click(await screen.findByRole("button", { name: "设置" }))
    expect(await screen.findByRole("heading", { name: "设置" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "展开面板布局设置" })).toBeTruthy()
    expect(client.open).not.toHaveBeenCalled()
  })
})

function session(pageId: string, assetUrl: string, index: number): ReaderSessionDto {
  return {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "demo.cbz", pageCount: 2 },
    frame: {
      generation: 0,
      anchorPageIndex: index,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId, pageIndex: index, side: "single" }],
      pageCount: 2,
      atStart: index === 0,
      atEnd: index === 1,
    },
    visiblePages: [{
      id: pageId,
      index,
      name: "001.jpg",
      mediaKind: "image",
      mimeType: "image/jpeg",
      byteLength: 10,
      contentVersion: "v1",
      assetUrl,
    }],
  }
}

function shellConfig(): ReaderShellConfigDto {
  return {
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full" as const, customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full" as const, customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
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

function runtimeConfig(): ReaderRuntimeConfigDto {
  return {
    shell: shellConfig(),
    viewDefaults: { fitMode: "fit", pageMode: "single" },
    folderView: {
      viewMode: "compact",
      previewCount: 4,
      details: {
        columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
        hiddenColumns: [],
        pinnedLeft: ["name"],
        pinnedRight: [],
        columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
      },
      search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false },
    },
    slideshow: { intervalSeconds: 5, loop: false, random: false, fadeTransition: true },
  }
}
