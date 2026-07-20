import { describe, expect, it, vi } from "vitest"

import type { ReaderSessionDto } from "../../adapters/reader-http-client"
import { watchReaderSourceChanges } from "./watchReaderSourceChanges"

describe("watchReaderSourceChanges", () => {
  it("[neoview.react.source-watch] long-polls by revision and adopts one successful replacement", async () => {
    const controller = new AbortController()
    const replacement = { sessionId: "reader-2" } as ReaderSessionDto
    const waitForChanges = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ revision: 1, state: "changed", kinds: ["update"], count: 1 })
    const reload = vi.fn().mockResolvedValue(replacement)
    const beforeReload = vi.fn().mockResolvedValue(undefined)
    const onReloaded = vi.fn()

    await watchReaderSourceChanges({
      sessionId: "reader-1",
      signal: controller.signal,
      waitForChanges,
      reload,
      beforeReload,
      onReloaded,
      onReloadFailed: vi.fn(),
      onWatchUnavailable: vi.fn(),
    })

    expect(waitForChanges.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["reader-1", 0],
      ["reader-1", 0],
    ])
    expect(reload).toHaveBeenCalledWith("reader-1", controller.signal)
    expect(beforeReload.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]!)
    expect(onReloaded).toHaveBeenCalledWith(replacement)
  })

  it("[neoview.react.source-watch-rollback] keeps watching the old session after a failed reload", async () => {
    const controller = new AbortController()
    const waitForChanges = vi.fn()
      .mockResolvedValueOnce({ revision: 3, state: "changed", kinds: ["create"], count: 1 })
      .mockImplementationOnce(async () => {
        controller.abort()
        throw controller.signal.reason
      })
    const onReloadFailed = vi.fn()

    await watchReaderSourceChanges({
      sessionId: "reader-1",
      signal: controller.signal,
      waitForChanges,
      reload: vi.fn().mockRejectedValue(new Error("private path must not escape")),
      onReloaded: vi.fn(),
      onReloadFailed,
      onWatchUnavailable: vi.fn(),
    })

    expect(onReloadFailed).toHaveBeenCalledOnce()
    expect(waitForChanges.mock.calls[1]?.[1]).toBe(3)
  })

  it("[neoview.react.source-watch-unavailable] retries without exposing transport details", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const onWatchUnavailable = vi.fn()
    const waitForChanges = vi.fn()
      .mockRejectedValueOnce(new Error("D:/private/book.cbz"))
      .mockRejectedValueOnce(new Error("D:/private/book.cbz"))
      .mockImplementationOnce(async () => {
        controller.abort()
        throw controller.signal.reason
      })
    const pending = watchReaderSourceChanges({
      sessionId: "reader-1",
      signal: controller.signal,
      waitForChanges,
      reload: vi.fn(),
      onReloaded: vi.fn(),
      onReloadFailed: vi.fn(),
      onWatchUnavailable,
      retryDelayMs: 25,
    })

    await vi.runAllTimersAsync()
    await pending

    expect(onWatchUnavailable).toHaveBeenCalledOnce()
    expect(onWatchUnavailable).toHaveBeenCalledWith()
    vi.useRealTimers()
  })
})
