import { act, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ReaderPreloadStatusStore } from "../../reader/ReaderPreloadStatusStore"
import { PreloadStatusView } from "./PreloadStatusCard"

describe("PreloadStatusCard", () => {
  it("[neoview.card.preload-status-live] subscribes only while mounted and renders actual decode events", () => {
    const store = new ReaderPreloadStatusStore(4)
    const view = render(
      <PreloadStatusView sessionId="reader-1" currentPageIndex={4} totalPages={20} store={store} />,
    )

    expect(store.listenerCount("reader-1")).toBe(1)
    expect(screen.getByText("5 / 20")).toBeTruthy()
    expect(screen.getByText("暂无相邻页预解码任务")).toBeTruthy()

    act(() => {
      store.begin("reader-1", 5)
      store.ready("reader-1", 5)
      store.begin("reader-1", 3)
      store.fail("reader-1", 3)
    })

    expect(screen.getByText("2 / 4")).toBeTruthy()
    expect(screen.getByText("P4")).toBeTruthy()
    expect(screen.getByText("P6")).toBeTruthy()
    expect(screen.getByText("ready")).toBeTruthy()
    expect(screen.getByText("failed")).toBeTruthy()

    view.unmount()
    expect(store.listenerCount("reader-1")).toBe(0)
  })
})
