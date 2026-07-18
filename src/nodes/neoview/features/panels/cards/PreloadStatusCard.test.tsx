import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderSessionDto, ReaderStorageDiagnosticsDto } from "../../../adapters/reader-http-client"
import { ReaderPreloadStatusStore } from "../../reader/ReaderPreloadStatusStore"
import PreloadStatusCard, { formatPreloadBytes, PreloadStatusEmptyView, PreloadStatusView } from "./PreloadStatusCard"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("PreloadStatusCard", () => {
  it("[neoview.preload-status.resident] keeps the legacy summary shell visible before a Reader session exists", () => {
    const view = render(<PreloadStatusCard {...panelContext(vi.fn(async () => diagnosticsDto()), undefined)} />)

    expect(view.container.querySelector('[data-neoview-preload-status="true"]')).toBeTruthy()
    expect(view.container.querySelector('[data-preload-empty="true"]')).toBeTruthy()
    expect(screen.getByText("0 / 0")).toBeTruthy()
    expect(screen.getByText("--")).toBeTruthy()
    expect(screen.getByText("附近页缓存")).toBeTruthy()
    expect(screen.getByText("等待书本")).toBeTruthy()
    expect(screen.queryByText("打开书本后显示预加载状态")).toBeNull()
    view.rerender(<PreloadStatusEmptyView />)
  })
  it("[neoview.preload-status.nearby-window] [neoview.preload-status.ui] [neoview.preload-status.accessibility] renders the bounded legacy page window and actual browser events", () => {
    const store = new ReaderPreloadStatusStore(4)
    const view = render(
      <PreloadStatusView sessionId="reader-1" currentPageIndex={4} totalPages={20} store={store} />,
    )

    expect(store.listenerCount("reader-1")).toBe(1)
    expect(screen.getByText("5 / 20")).toBeTruthy()
    expect(screen.getAllByLabelText(/第 \d+ 页/)).toHaveLength(9)
    expect(screen.getByLabelText("第 2 页，未预解码")).toBeTruthy()
    expect(screen.getByLabelText("第 5 页，当前")).toBeTruthy()
    expect(screen.getByLabelText("第 10 页，未预解码")).toBeTruthy()

    act(() => {
      store.begin("reader-1", 5)
      store.ready("reader-1", 5)
      store.begin("reader-1", 3)
      store.fail("reader-1", 3)
    })

    expect(screen.getByLabelText("第 4 页，失败")).toBeTruthy()
    expect(screen.getByLabelText("第 6 页，已预解码")).toBeTruthy()
    expect(screen.getByLabelText("浏览器预解码状态").textContent).toContain("1")

    view.unmount()
    expect(store.listenerCount("reader-1")).toBe(0)
  })

  it("[neoview.preload-status.memory] keeps server cache capacity separate from browser retention", () => {
    const store = new ReaderPreloadStatusStore(4)
    store.ready("reader-1", 3)
    store.ready("reader-1", 5)
    render(
      <PreloadStatusView
        sessionId="reader-1"
        currentPageIndex={4}
        totalPages={20}
        store={store}
        diagnostics={diagnosticsDto()}
      />,
    )

    expect(screen.getByText("12 项")).toBeTruthy()
    expect(screen.queryByText("2 / 4")).toBeNull()
    expect(screen.getByText("64.0 MB / 256.0 MB")).toBeTruthy()
    expect(screen.getByText("活动租约").textContent).toContain("1")
    const progress = screen.getByRole("progressbar", { name: "服务端呈现缓存使用率" })
    expect(progress.getAttribute("aria-valuenow")).toBe("25")
    expect(screen.getByLabelText("服务端预加载队列").textContent).toContain("邻近3")
  })

  it("[neoview.preload.cache-state] renders session-scoped cached and cold server pages separately from browser predecode", () => {
    const diagnostics = diagnosticsDto()
    diagnostics.reader!.sessionPreload = {
      generation: 7,
      pages: [
        { pageIndex: 4, outcome: "ready" },
        { pageIndex: 5, outcome: "started" },
        { pageIndex: 6, outcome: "failed" },
      ],
    }
    const view = render(<PreloadStatusView sessionId="reader-1" currentPageIndex={4} totalPages={20} diagnostics={diagnostics} />)

    expect(view.container.querySelector('[data-preload-nearby-page="4"]')?.getAttribute("data-server-cache-state")).toBe("cached")
    expect(view.container.querySelector('[data-preload-nearby-page="4"]')?.getAttribute("data-preload-tone")).toBe("current")
    expect(view.container.querySelector('[data-preload-nearby-page="5"]')?.getAttribute("data-server-cache-state")).toBe("loading")
    expect(view.container.querySelector('[data-preload-nearby-page="5"]')?.getAttribute("data-preload-tone")).toBe("loading")
    expect(view.container.querySelector('[data-preload-nearby-page="6"]')?.getAttribute("data-server-cache-state")).toBe("failed")
    expect(view.container.querySelector('[data-preload-nearby-page="6"]')?.getAttribute("data-preload-tone")).toBe("failed")
    expect(view.container.querySelector('[data-preload-nearby-page="7"]')?.getAttribute("data-server-cache-state")).toBe("cold")
    expect(view.container.querySelector('[data-preload-nearby-page="7"]')?.getAttribute("data-preload-tone")).toBe("cold")
    expect(screen.getByLabelText("第 5 页，当前，已缓存")).toBeTruthy()
  })

  it("[neoview.preload-status.memory] distinguishes zero and unavailable server presentation leases", () => {
    const zero = diagnosticsDto()
    zero.assets.presentation = { ...zero.assets.presentation!, activeLeases: 0 }
    const view = render(
      <PreloadStatusView sessionId="reader-1" currentPageIndex={0} totalPages={1} diagnostics={zero} />,
    )

    expect(view.container.querySelector('[data-preload-metric="active-leases"]')?.textContent).toContain("0")
    const { activeLeases: _activeLeases, ...legacyPresentation } = zero.assets.presentation!
    view.rerender(
      <PreloadStatusView
        sessionId="reader-1"
        currentPageIndex={0}
        totalPages={1}
        diagnostics={{ ...zero, assets: { ...zero.assets, presentation: legacyPresentation as typeof zero.assets.presentation } }}
      />,
    )
    expect(view.container.querySelector('[data-preload-metric="active-leases"]')?.textContent).toContain("--")
  })

  it("[neoview.preload-status.states] [neoview.preload-status.retry] exposes sanitized retry without hiding the live predecode state", () => {
    const retry = vi.fn()
    const store = new ReaderPreloadStatusStore(4)
    store.ready("reader-1", 5)
    render(
      <PreloadStatusView
        sessionId="reader-1"
        currentPageIndex={4}
        totalPages={20}
        store={store}
        diagnosticsError="预加载诊断暂时不可用"
        onRetry={retry}
      />,
    )

    expect(screen.getByRole("alert").textContent).not.toContain("D:/private")
    expect(screen.getByLabelText("第 6 页，已预解码")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it("[neoview.preload-status.refresh] [neoview.preload-status.diagnostics-cancel] polls only while mounted and aborts obsolete requests", async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const diagnostics = vi.fn(async (signal?: AbortSignal) => {
      signals.push(signal!)
      return diagnosticsDto()
    })
    const session = sessionDto()
    const view = render(<PreloadStatusCard {...panelContext(diagnostics, session)} />)

    await act(async () => Promise.resolve())
    expect(diagnostics).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(1_999))
    expect(diagnostics).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(diagnostics).toHaveBeenCalledTimes(2)

    view.rerender(<PreloadStatusCard {...panelContext(diagnostics, { ...session, frame: { ...session.frame, generation: 4 } })} />)
    await act(async () => Promise.resolve())
    expect(diagnostics).toHaveBeenCalledTimes(3)
    expect(signals[0]).toBe(signals[1])
    expect(signals[1]?.aborted).toBe(true)
    view.unmount()
    expect(signals[2]?.aborted).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(4_000))
    expect(diagnostics).toHaveBeenCalledTimes(3)
  })

  it("[neoview.preload-status.session-switch] clears previous-session diagnostics before the next snapshot arrives", async () => {
    let resolveSecond!: (value: ReaderStorageDiagnosticsDto) => void
    const second = new Promise<ReaderStorageDiagnosticsDto>((resolve) => { resolveSecond = resolve })
    const diagnostics = vi.fn()
      .mockResolvedValueOnce(diagnosticsDto())
      .mockReturnValueOnce(second)
    const session = sessionDto()
    const view = render(<PreloadStatusCard {...panelContext(diagnostics, session)} />)

    await waitFor(() => expect(memoryMetric(view.container).textContent).toContain("12"))
    view.rerender(<PreloadStatusCard {...panelContext(diagnostics, {
      ...session,
      sessionId: "reader-2",
      book: { ...session.book, id: "book-2" },
      frame: { ...session.frame, generation: 1 },
    })} />)

    expect(memoryMetric(view.container).textContent).toContain("--")
    expect(memoryMetric(view.container).textContent).not.toContain("12")
    await act(async () => resolveSecond(diagnosticsDto(7)))
    await waitFor(() => expect(memoryMetric(view.container).textContent).toContain("7"))
  })

  it("[neoview.preload-status.current-page] renders an empty book as 0 / 0 with no page tiles", () => {
    render(<PreloadStatusView sessionId="empty" currentPageIndex={99} totalPages={0} store={new ReaderPreloadStatusStore(4)} />)
    expect(screen.getByText("0 / 0")).toBeTruthy()
    expect(document.querySelectorAll("[data-preload-nearby-page]")).toHaveLength(0)
  })

  it("[neoview.preload.cancel-session] [neoview.preload.release-visible-retained] exposes confirmed session-scoped actions", async () => {
    const diagnostics = vi.fn(async () => diagnosticsDto())
    const onPreloadAction = vi.fn(async (action: "cancel-speculative" | "release-retained") => ({
      action,
      generation: 8,
      cancelled: action === "cancel-speculative" ? 2 : 0,
      released: action === "release-retained" ? 3 : 0,
      visibleRetained: 1,
    }))
    render(<PreloadStatusCard {...panelContext(diagnostics, sessionDto())} onPreloadAction={onPreloadAction} />)

    fireEvent.click(await screen.findByRole("button", { name: "取消预读" }))
    expect(await screen.findByText("已取消 2 个预读任务")).toBeTruthy()
    expect(onPreloadAction).toHaveBeenLastCalledWith("cancel-speculative", expect.any(AbortSignal))

    fireEvent.click(await screen.findByRole("button", { name: "释放缓存" }))
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "释放", exact: true }))
    expect(await screen.findByText("已释放 3 个缓存项，保留 1 个可见页")).toBeTruthy()
    expect(onPreloadAction).toHaveBeenLastCalledWith("release-retained", expect.any(AbortSignal))
  })

  it("[neoview.preload.action-rollback] sanitizes failures without reporting a committed action", async () => {
    const onPreloadAction = vi.fn(async () => { throw new Error("D:/private/cache") })
    render(<PreloadStatusCard {...panelContext(vi.fn(async () => diagnosticsDto()), sessionDto())} onPreloadAction={onPreloadAction} />)

    fireEvent.click(await screen.findByRole("button", { name: "取消预读" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("预加载操作失败，请重试")
    expect(alert.textContent).not.toContain("D:/private")
  })

  it("[neoview.preload.action-lifecycle] aborts an active action when the Card unmounts", async () => {
    let actionSignal: AbortSignal | undefined
    const onPreloadAction = vi.fn((_action: "cancel-speculative" | "release-retained", signal?: AbortSignal) => {
      actionSignal = signal
      return new Promise<never>(() => undefined)
    })
    const view = render(<PreloadStatusCard {...panelContext(vi.fn(async () => diagnosticsDto()), sessionDto())} onPreloadAction={onPreloadAction} />)
    fireEvent.click(await screen.findByRole("button", { name: "取消预读" }))
    await waitFor(() => expect(onPreloadAction).toHaveBeenCalledOnce())

    view.unmount()

    expect(actionSignal?.aborted).toBe(true)
  })

  it("[neoview.preload-status.format] [neoview.preload-status.ui] freezes legacy byte boundaries and invalid degradation", () => {
    expect(formatPreloadBytes(undefined)).toBe("--")
    expect(formatPreloadBytes(-1)).toBe("--")
    expect(formatPreloadBytes(0)).toBe("0 B")
    expect(formatPreloadBytes(1_023)).toBe("1023 B")
    expect(formatPreloadBytes(1_024)).toBe("1.0 KB")
    expect(formatPreloadBytes(1_048_576)).toBe("1.0 MB")
    expect(formatPreloadBytes(1_073_741_824)).toBe("1.00 GB")
  })
})

function panelContext(
  diagnostics: NonNullable<ReaderHttpClient["diagnostics"]>,
  session?: ReaderSessionDto,
) {
  return {
    session,
    client: {
      config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(), updateViewDefaults: vi.fn(),
      updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(), goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(), diagnostics,
    } satisfies ReaderHttpClient,
    disabled: false,
    onGoTo: vi.fn(),
  }
}

function sessionDto(): ReaderSessionDto {
  return {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "demo.cbz", pageCount: 20 },
    frame: {
      generation: 3,
      anchorPageIndex: 4,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "page-5", pageIndex: 4, side: "single" }],
      pageCount: 20,
      atStart: false,
      atEnd: false,
    },
    visiblePages: [],
  }
}

function diagnosticsDto(entries = 12): ReaderStorageDiagnosticsDto {
  return {
    schemaVersion: 1,
    reader: {
      activeSessions: 1,
      preload: {
        sessions: 1,
        candidates: { near: 3, ahead: 5, background: 1 },
        active: 1,
        plannedCandidates: 9,
        started: 4,
        ready: 2,
        failed: 1,
        cancelled: 0,
        evicted: 0,
      },
    },
    assets: {
      presentation: { entries, bytes: 64 * 1_048_576, maxBytes: 256 * 1_048_576, activeLeases: 1 },
      thumbnails: null,
    },
    presentationDiskCache: { enabled: false },
    solidArchiveCache: { retainedBytes: 0 },
  }
}

function memoryMetric(container: HTMLElement): HTMLElement {
  const metric = container.querySelector<HTMLElement>('[data-preload-metric="memory-entries"]')
  if (!metric) throw new Error("memory metric was not rendered")
  return metric
}
