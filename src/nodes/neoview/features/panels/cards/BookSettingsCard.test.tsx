import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderBookSettingsSnapshotDto, ReaderBookSettingsUpdateDto, ReaderHttpClient } from "../../../adapters/reader-http-client"
import BookSettingsPanelCard, { BookSettingsCard, BOOK_SETTINGS_CAPABILITY_AUDIT } from "./BookSettingsCard"

const inheritedSettings: ReaderBookSettingsSnapshotDto = {
  schemaVersion: 1,
  bookId: "book-1",
  revision: 2,
  overrides: {},
  effective: {
    favorite: false,
    rating: 0,
    direction: "left-to-right",
    pageMode: "single",
    horizontalBook: false,
  },
  inherited: ["favorite", "rating", "direction", "pageMode", "horizontalBook"],
}

afterEach(cleanup)

describe("BookSettingsCard", () => {
  it("[neoview.card.book-settings-controls] exposes and delegates all five persistent controls", () => {
    const onUpdate = vi.fn()
    render(<BookSettingsCard bookName="example.cbz" settings={inheritedSettings} onUpdate={onUpdate} />)

    expect(screen.getByText("example.cbz")).toBeTruthy()
    expect(screen.getByRole("button", { name: "收藏本书" }).textContent).toBe("未收藏")
    expect(screen.getByRole("button", { name: "评分 1 星" }).textContent).toBe("☆")
    fireEvent.click(screen.getByRole("button", { name: "收藏本书" }))
    fireEvent.click(screen.getByRole("button", { name: "评分 4 星" }))
    fireEvent.click(screen.getByRole("button", { name: "右→左" }))
    fireEvent.click(screen.getByRole("button", { name: "双页" }))
    fireEvent.click(screen.getByRole("switch", { name: "横版本子" }))

    expect(onUpdate.mock.calls.map(([patch]) => patch)).toEqual([
      { favorite: true },
      { rating: 4 },
      { direction: "right-to-left" },
      { pageMode: "double" },
      { horizontalBook: true },
    ])
    expect(BOOK_SETTINGS_CAPABILITY_AUDIT.every(({ status }) => status === "supported-persistent")).toBe(true)
  })

  it("[neoview.card.book-settings-inheritance] identifies explicit values and resets each override to inherit", () => {
    const onUpdate = vi.fn()
    render(
      <BookSettingsCard
        bookName="explicit.cbz"
        settings={{
          ...inheritedSettings,
          overrides: { favorite: true, rating: 5, direction: "right-to-left", pageMode: "double", horizontalBook: true },
          effective: { favorite: true, rating: 5, direction: "right-to-left", pageMode: "double", horizontalBook: true },
          inherited: [],
        }}
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getAllByText("本书")).toHaveLength(5)
    for (const label of ["收藏", "评分", "阅读方向", "显示模式", "横版本子"]) {
      fireEvent.click(screen.getByRole("button", { name: `恢复继承${label}` }))
    }
    expect(onUpdate.mock.calls.map(([patch]) => patch)).toEqual([
      { favorite: null },
      { rating: null },
      { direction: null },
      { pageMode: null },
      { horizontalBook: null },
    ])
  })

  it("[neoview.card.book-settings-persistence] loads revisioned settings, publishes the updated frame and rolls optimistic state back on failure", async () => {
    const update = vi.fn()
      .mockResolvedValueOnce({
        settings: { ...inheritedSettings, revision: 3, overrides: { favorite: true }, effective: { ...inheritedSettings.effective, favorite: true }, inherited: inheritedSettings.inherited.filter((key) => key !== "favorite") },
        frame: frame("double"),
        visiblePages: [],
      })
      .mockRejectedValueOnce(new Error("保存失败"))
    const client = clientWith({
      bookSettings: vi.fn(async () => inheritedSettings),
      updateBookSettings: update,
    })
    const onBookSettingsUpdated = vi.fn()
    render(<BookSettingsPanelCard {...context(client, onBookSettingsUpdated)} />)

    fireEvent.click(await screen.findByRole("button", { name: "收藏本书" }))
    expect(screen.getByText("保存中…")).toBeTruthy()
    await waitFor(() => expect(screen.getByRole("button", { name: "取消收藏本书" })).toBeTruthy())
    expect(update).toHaveBeenCalledWith("reader-1", 2, { favorite: true }, expect.any(AbortSignal))
    expect(onBookSettingsUpdated).toHaveBeenCalledWith("reader-1", expect.objectContaining({ settings: expect.objectContaining({ revision: 3 }) }))

    const failedRating = screen.getByRole("button", { name: "评分 5 星" })
    failedRating.focus()
    fireEvent.click(failedRating)
    expect((await screen.findByRole("alert")).textContent).toContain("保存失败")
    expect(screen.getByRole("button", { name: "评分 5 星" }).getAttribute("aria-pressed")).toBe("false")
    expect(document.activeElement).toBe(failedRating)
    expect(update).toHaveBeenLastCalledWith("reader-1", 3, { rating: 5 }, expect.any(AbortSignal))
  })

  it("[neoview.card.book-settings-reset-optimistic] marks a nullable reset inherited before the server responds", async () => {
    const explicit: ReaderBookSettingsSnapshotDto = {
      ...inheritedSettings,
      overrides: { favorite: true },
      effective: { ...inheritedSettings.effective, favorite: true },
      inherited: inheritedSettings.inherited.filter((key) => key !== "favorite"),
    }
    let resolveUpdate: ((value: ReaderBookSettingsUpdateDto) => void) | undefined
    const updateBookSettings = vi.fn(() => new Promise<ReaderBookSettingsUpdateDto>((resolve) => { resolveUpdate = resolve }))
    const view = render(<BookSettingsPanelCard {...context(clientWith({
      bookSettings: vi.fn(async () => explicit),
      updateBookSettings,
    }), vi.fn())} />)

    fireEvent.click(await screen.findByRole("button", { name: "恢复继承收藏" }))
    const favoriteRow = view.container.querySelector('[data-book-setting="favorite"]')!
    expect(favoriteRow.textContent).toContain("继承")
    expect(screen.queryByRole("button", { name: "恢复继承收藏" })).toBeNull()
    expect(updateBookSettings).toHaveBeenCalledWith("reader-1", 2, { favorite: null }, expect.any(AbortSignal))

    resolveUpdate?.({ settings: { ...inheritedSettings, revision: 3 }, frame: frame("single"), visiblePages: [] })
    await waitFor(() => expect(screen.getByRole("button", { name: "收藏本书" })).toBeTruthy())
  })

  it("[neoview.card.book-settings-lifecycle] aborts a pending read when the Card unmounts", async () => {
    let signal: AbortSignal | undefined
    const client = clientWith({
      bookSettings: vi.fn((_sessionId, requestSignal) => {
        signal = requestSignal
        return new Promise<ReaderBookSettingsSnapshotDto>(() => undefined)
      }),
    })
    const view = render(<BookSettingsPanelCard {...context(client, vi.fn())} />)
    expect(await screen.findByLabelText("正在加载本书设置")).toBeTruthy()
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
})

function context(client: ReaderHttpClient, onBookSettingsUpdated: ReturnType<typeof vi.fn>) {
  return {
    client,
    disabled: false,
    onGoTo: vi.fn(),
    onBookSettingsUpdated,
    session: {
      sessionId: "reader-1",
      book: { id: "book-1", displayName: "example.cbz", pageCount: 1 },
      frame: frame("single"),
      visiblePages: [],
    },
  }
}

function frame(pageMode: "single" | "double") {
  return {
    generation: 1,
    anchorPageIndex: 0,
    direction: "left-to-right" as const,
    layout: { pageMode, panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: false },
    pages: [],
    pageCount: 1,
    atStart: true,
    atEnd: true,
  }
}

function clientWith(overrides: Partial<ReaderHttpClient>): ReaderHttpClient {
  return {
    config: vi.fn(),
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
    ...overrides,
  }
}
