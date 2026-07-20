import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("media-chrome/react", () => import("@/test/media-chrome-react-stub"))

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

  it("keeps global and sidebar controls out of the busy state while a page turn is pending", async () => {
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    let finishNavigation!: (value: Awaited<ReturnType<ReaderHttpClient["navigate"]>>) => void
    const pendingNavigation = new Promise<Awaited<ReturnType<ReaderHttpClient["navigate"]>>>((resolve) => { finishNavigation = resolve })
    const navigate = vi.fn(() => pendingNavigation)
    const client: ReaderHttpClient = {
      config: vi.fn(async () => runtimeConfig()),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({ pages: opened.visiblePages, total: 2 })),
      navigate,
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    await screen.findByRole("img", { name: "001.jpg" })
    const disabledBefore = new Map(
      [...document.querySelectorAll<HTMLButtonElement>("[data-reader-app] button")]
        .map((button) => [button, button.disabled] as const),
    )

    const reader = document.querySelector("[data-reader-app]")!
    fireEvent.keyDown(reader, { key: "ArrowRight", code: "ArrowRight" })
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce())

    expect(screen.getByRole("button", { name: "关闭书籍" }).hasAttribute("disabled")).toBe(false)
    for (const [button, disabled] of disabledBefore) {
      if (button.isConnected) expect(button.disabled).toBe(disabled)
    }
    fireEvent.keyDown(reader, { key: "ArrowRight", code: "ArrowRight" })
    expect(navigate).toHaveBeenCalledOnce()

    await act(async () => finishNavigation({
      frame: { ...opened.frame, anchorPageIndex: 1, pages: [{ pageId: "page-2", pageIndex: 1, side: "single" }], atStart: false, atEnd: true },
      visiblePages: [{ ...opened.visiblePages[0]!, id: "page-2", index: 1, name: "002.jpg", assetUrl: "http://127.0.0.1:41000/reader/page-2" }],
    }))
    await screen.findByRole("img", { name: "002.jpg" })
  })

  it("[neoview.bindings.action-executor-react] routes configured actions through the shared Reader executor", async () => {
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    const replacement = { ...session("page-2", "http://127.0.0.1:41000/reader/page-2", 0), sessionId: "reader-2", book: { id: "book-2", displayName: "Book 2", pageCount: 1 } }
    const goTo = vi.fn(async () => opened)
    const openAdjacentBook = vi.fn(async () => replacement)
    const committed = vi.fn()
    const client: ReaderHttpClient = {
      config: vi.fn(async () => ({
        ...runtimeConfig(),
        inputBindings: { bindings: [{
          id: "last-page",
          action: "reader.last-page",
          context: "reader",
          enabled: true,
          input: { device: "keyboard", code: "KeyL" },
        }, {
          id: "next-book",
          action: "reader.next-book",
          context: "reader",
          enabled: true,
          input: { device: "keyboard", code: "KeyB" },
        }, {
          id: "progress-glow",
          action: "viewer.toggle-progress-bar-glow",
          context: "reader",
          enabled: true,
          input: { device: "keyboard", code: "KeyH" },
        }, {
          id: "progress-visible",
          action: "viewer.toggle-progress-bar",
          context: "reader",
          enabled: true,
          input: { device: "keyboard", code: "KeyG" },
        }] },
      })),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      openAdjacentBook,
      listPages: vi.fn(async () => ({ pages: opened.visiblePages, total: 2 })),
      navigate: vi.fn(),
      goTo,
      metadata: vi.fn(async () => ({ book: { sourcePath: "D:/books/Book 2.cbz" } })) as ReaderHttpClient["metadata"],
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} onPathCommitted={committed} />)

    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    await screen.findByRole("img", { name: "001.jpg" })
    const reader = document.querySelector("[data-reader-app]")!
    const progress = screen.getByRole("slider", { name: "阅读进度" })
    expect(progress.className).toContain("drop-shadow")
    fireEvent.keyDown(reader, { key: "h", code: "KeyH" })
    expect(progress.className).not.toContain("drop-shadow")
    fireEvent.keyDown(reader, { key: "g", code: "KeyG" })
    expect(screen.queryByRole("slider", { name: "阅读进度" })).toBeNull()
    fireEvent.keyDown(reader, { key: "l", code: "KeyL" })

    await waitFor(() => expect(goTo).toHaveBeenCalledWith("reader-1", 1, expect.any(AbortSignal)))
    fireEvent.keyDown(reader, { key: "b", code: "KeyB" })
    await screen.findByRole("img", { name: "001.jpg" })
    await waitFor(() => expect(openAdjacentBook).toHaveBeenCalledWith("reader-1", "next", expect.any(AbortSignal)))
    await waitFor(() => expect(committed).toHaveBeenLastCalledWith("D:/books/Book 2.cbz"))
  })

  it("[neoview.bindings.video-actions-react] routes multiple bindings and seek mode through the active native video", async () => {
    const base = session("video-1", "http://127.0.0.1:41000/reader/video-1", 0)
    const opened: ReaderSessionDto = {
      ...base,
      visiblePages: [{
        ...base.visiblePages[0]!,
        name: "clip.mp4",
        mediaKind: "video",
        mimeType: "video/mp4",
      }],
    }
    const navigate = vi.fn(async () => ({ frame: opened.frame, visiblePages: opened.visiblePages }))
    const client: ReaderHttpClient = {
      config: vi.fn(async () => ({
        ...runtimeConfig(),
        media: { videoMinPlaybackRate: 0.5, videoMaxPlaybackRate: 2, videoPlaybackRateStep: 0.5 },
        inputBindings: { bindings: [{
          id: "mute-primary",
          action: "video.toggle-mute",
          context: "video",
          enabled: true,
          input: { device: "keyboard", code: "KeyM" },
        }, {
          id: "mute-secondary",
          action: "video.toggle-mute",
          context: "video",
          enabled: true,
          input: { device: "keyboard", code: "KeyU" },
        }, {
          id: "seek-mode",
          action: "video.toggle-seek-mode",
          context: "video",
          enabled: true,
          input: { device: "keyboard", code: "KeyS" },
        }, {
          id: "next-page-in-video",
          action: "reader.next-page",
          context: "video",
          enabled: true,
          input: { device: "keyboard", code: "KeyN" },
        }] },
      })),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({ pages: opened.visiblePages, total: 2 })),
      navigate,
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    render(<ReaderApp initialPath="D:/books/video.cbz" client={client} />)

    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    const video = await waitFor(() => {
      const element = document.querySelector<HTMLVideoElement>("[data-reader-page-video='video-1']")
      expect(element).toBeTruthy()
      return element!
    })
    Object.defineProperty(video, "duration", { configurable: true, value: 100 })
    video.currentTime = 5
    video.focus()

    fireEvent.keyDown(video, { key: "m", code: "KeyM" })
    expect(video.muted).toBe(true)
    fireEvent.keyDown(video, { key: "u", code: "KeyU" })
    expect(video.muted).toBe(false)
    fireEvent.keyDown(video, { key: "s", code: "KeyS" })
    fireEvent.keyDown(video, { key: "n", code: "KeyN" })
    expect(video.currentTime).toBe(15)
    expect(navigate).not.toHaveBeenCalled()

    fireEvent(video, new Event("ended"))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("reader-1", "next", expect.any(AbortSignal)))
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

  it("[neoview.slideshow.fade-react] marks only slideshow-driven frames for the configured compositor fade", async () => {
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    const forward = {
      frame: {
        ...opened.frame,
        generation: 1,
        anchorPageIndex: 1,
        pages: [{ pageId: "page-2", pageIndex: 1, side: "single" as const }],
        atStart: false,
        atEnd: true,
      },
      visiblePages: [{
        ...opened.visiblePages[0]!,
        id: "page-2",
        index: 1,
        name: "002.jpg",
        assetUrl: "http://127.0.0.1:41000/reader/page-2",
      }],
    }
    const backward = {
      frame: { ...opened.frame, generation: 2 },
      visiblePages: opened.visiblePages,
    }
    const navigate = vi.fn(async (_sessionId: string, action: "next" | "previous") => action === "next" ? forward : backward)
    const client: ReaderHttpClient = {
      config: vi.fn(async () => ({ ...runtimeConfig(), slideshow: { intervalSeconds: 1, loop: false, random: false, fadeTransition: true } })),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      listPages: vi.fn(async () => ({ pages: [opened.visiblePages[0]!, forward.visiblePages[0]!], total: 2 })),
      navigate,
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }

    render(<ReaderApp initialPath="D:/books/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    await screen.findByRole("img", { name: "001.jpg" })
    fireEvent.click(screen.getByRole("button", { name: "展开幻灯片设置" }))
    const interval = await screen.findByRole("slider", { name: "幻灯片间隔" }) as HTMLInputElement
    fireEvent.change(interval, { target: { value: "1" } })
    await waitFor(() => expect(interval.value).toBe("1"))
    fireEvent.click(await screen.findByRole("button", { name: "播放幻灯片" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("reader-1", "next", expect.any(AbortSignal)), { timeout: 2_500 })
    const pendingImage = await screen.findByRole("img", { name: "002.jpg" })
    fireEvent.load(pendingImage)
    await waitFor(() => expect(document.querySelector("[data-reader-page-transition-source=\"slideshow\"]")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "暂停幻灯片" }))

    fireEvent.keyDown(document.querySelector("[data-reader-app]")!, { key: "ArrowLeft", code: "ArrowLeft" })
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(document.querySelector("[data-reader-page-transition-source=\"slideshow\"]")).toBeNull())
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

  it("[neoview.react.source-watch-gui] adopts an automatic reload and reports it without source paths", async () => {
    const opened = session("page-1", "http://127.0.0.1:41000/reader/page-1", 0)
    const replacement = {
      ...session("page-2", "http://127.0.0.1:41000/reader/page-2", 1),
      sessionId: "reader-2",
      visiblePages: [{
        ...session("page-2", "http://127.0.0.1:41000/reader/page-2", 1).visiblePages[0]!,
        name: "002.jpg",
      }],
    }
    let publishChange!: (change: { revision: number; state: "changed"; kinds: ["update"]; count: number }) => void
    const waitForSourceChanges = vi.fn((_sessionId: string, _revision: number, signal?: AbortSignal) => new Promise<any>((resolve, reject) => {
      if (!publishChange) publishChange = resolve
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
    }))
    const client: ReaderHttpClient = {
      config: vi.fn(async () => runtimeConfig()),
      updateSidebarLayout: vi.fn(async () => shellConfig()),
      updateCardLayout: vi.fn(async () => shellConfig()),
      updateBoardLayout: vi.fn(async () => shellConfig()),
      updateViewDefaults: vi.fn(async (patch) => ({ ...runtimeConfig().viewDefaults, ...patch.viewDefaults })),
      updateSlideshow: vi.fn(async (patch) => ({ ...runtimeConfig().slideshow, ...patch.slideshow })),
      open: vi.fn(async () => opened),
      reload: vi.fn(async () => replacement),
      waitForSourceChanges,
      listPages: vi.fn(async () => ({ pages: opened.visiblePages, total: 2 })),
      navigate: vi.fn(),
      goTo: vi.fn(),
      updateSessionOptions: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    const view = render(<ReaderApp initialPath="D:/private/demo.cbz" client={client} />)
    fireEvent.click(screen.getByRole("button", { name: "打开书籍" }))
    await screen.findByRole("img", { name: "001.jpg" })
    await waitFor(() => expect(waitForSourceChanges).toHaveBeenCalledWith("reader-1", 0, expect.any(AbortSignal)))

    await act(async () => publishChange({ revision: 1, state: "changed", kinds: ["update"], count: 1 }))

    expect(await screen.findByRole("img", { name: "002.jpg" })).toBeTruthy()
    expect(await screen.findByText("源内容已更新")).toBeTruthy()
    expect(document.body.textContent).not.toContain("D:/private/demo.cbz")
    expect(client.reload).toHaveBeenCalledWith("reader-1", expect.any(AbortSignal))
    view.unmount()
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
    pageList: { viewMode: "list", followProgress: true },
    bookmarkList: { activeListId: "all" },
    historyList: { viewMode: "compact" },
    folderView: {
      homePath: "",
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
      tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] },
    },
    slideshow: { intervalSeconds: 5, loop: false, random: false, fadeTransition: true },
    colorFilter: {
      colorizeEnabled: false,
      colorizePreset: "redAndBlueGray",
      customColors: [],
      onlyBlackAndWhite: false,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      sepia: 0,
      hueRotate: 0,
      invert: false,
      negative: false,
    },
    pageTransition: { enabled: false, type: "none", duration: 0, easing: "easeOutQuad" },
    inputBindings: { bindings: [] },
  }
}
