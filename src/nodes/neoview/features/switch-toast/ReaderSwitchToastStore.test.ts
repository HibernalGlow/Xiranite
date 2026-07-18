import { describe, expect, it, vi } from "vitest"

import { DEFAULT_READER_SWITCH_TOAST } from "@xiranite/node-neoview/switch-toast"
import { createReaderSwitchToastStore } from "./ReaderSwitchToastStore"

describe("ReaderSwitchToastStore", () => {
  it("[neoview.switch-toast.store-commit] previews repeatedly and persists the latest snapshot once", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderSwitchToastStore({ persist })
    store.preview({ opacity: 0.8 })
    store.preview({ opacity: 0.7 })
    expect(persist).not.toHaveBeenCalled()
    await store.commit()
    expect(persist).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledWith(
      { ...DEFAULT_READER_SWITCH_TOAST, opacity: 0.7 },
      false,
      expect.any(AbortSignal),
    )
    store.dispose()
  })

  it("[neoview.switch-toast.queue] bounds messages, deduplicates for 500ms and clears timers", () => {
    vi.useFakeTimers()
    const store = createReaderSwitchToastStore({ persist: async (settings) => settings })
    store.show({ title: "A", durationMs: 2_600 })
    store.show({ title: "A", durationMs: 2_600 })
    expect(store.getMessages()).toHaveLength(1)
    vi.advanceTimersByTime(501)
    store.show({ title: "B" })
    store.show({ title: "C" })
    store.show({ title: "D" })
    expect(store.getMessages().map((message) => message.title)).toEqual(["B", "C", "D"])
    vi.runAllTimers()
    expect(store.getMessages()).toEqual([])
    store.dispose()
    vi.useRealTimers()
  })

  it("[neoview.switch-toast.hydration-race] never overwrites a touched local draft with late config", () => {
    const store = createReaderSwitchToastStore({ persist: async (settings) => settings })
    store.preview({ enablePage: true })
    store.hydrate({ ...DEFAULT_READER_SWITCH_TOAST, enableBook: true })
    expect(store.getSnapshot()).toMatchObject({ enablePage: true, enableBook: false })
    store.dispose()
  })
})
