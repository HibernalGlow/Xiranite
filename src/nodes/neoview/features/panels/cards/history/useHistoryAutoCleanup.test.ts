import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useHistoryAutoCleanup } from "./useHistoryAutoCleanup"

afterEach(() => {
  vi.useRealTimers()
})

describe("useHistoryAutoCleanup", () => {
  it("runs immediately and periodically only while the History Card is visible", async () => {
    vi.useFakeTimers()
    const cleanup = vi.fn(async () => ({
      kind: "recents" as const,
      scanned: 1,
      missing: 0,
      unknown: 0,
      deleted: 0,
      truncated: false,
    }))
    const onRefresh = vi.fn()
    const onResult = vi.fn()
    const onError = vi.fn()
    const props = {
      visible: true,
      resident: true,
      config: { enabled: true, trigger: "interval" as const, intervalMinutes: 15 },
      cleanup,
      onRefresh,
      onResult,
      onError,
    }
    const hook = renderHook((current) => useHistoryAutoCleanup(current), { initialProps: props })

    await act(async () => undefined)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(onRefresh).toHaveBeenCalledOnce()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000)
    })
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(onRefresh).toHaveBeenCalledTimes(2)

    hook.rerender({ ...props, visible: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000)
    })
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
  })
})
