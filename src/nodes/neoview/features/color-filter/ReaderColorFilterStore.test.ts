import { DEFAULT_READER_COLOR_FILTER } from "@xiranite/node-neoview/ui-core"
import { describe, expect, it, vi } from "vitest"

import { createReaderColorFilterStore } from "./ReaderColorFilterStore"

describe("ReaderColorFilterStore", () => {
  it("[neoview.color-filter.preview] [neoview.color-filter.slider-commit] previews repeated slider values locally and persists once on commit", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderColorFilterStore({ persist })
    const listener = vi.fn()
    store.subscribe(listener)

    for (let brightness = 101; brightness <= 140; brightness += 1) store.preview({ brightness })

    expect(store.getSnapshot().brightness).toBe(140)
    expect(listener).toHaveBeenCalledTimes(40)
    expect(persist).not.toHaveBeenCalled()
    await store.commit()
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[0]).toMatchObject({ brightness: 140 })
  })

  it("[neoview.color-filter.hydration-race] [neoview.color-filter.lifecycle] ignores late config after local interaction", () => {
    const store = createReaderColorFilterStore({ persist: async (settings) => settings })
    store.preview({ contrast: 120 })
    store.hydrate({ ...DEFAULT_READER_COLOR_FILTER, contrast: 80 })
    expect(store.getSnapshot().contrast).toBe(120)
  })

  it("[neoview.color-filter.persistence] [neoview.color-filter.rollback] serializes writes and rolls the latest failed snapshot back", async () => {
    let finishFirst!: (settings: typeof DEFAULT_READER_COLOR_FILTER) => void
    const first = new Promise<typeof DEFAULT_READER_COLOR_FILTER>((resolve) => { finishFirst = resolve })
    const persist = vi.fn()
      .mockReturnValueOnce(first)
      .mockRejectedValueOnce(new Error("disk full"))
    const onError = vi.fn()
    const store = createReaderColorFilterStore({ persist, onError })
    store.preview({ brightness: 110 })
    const writing = store.commit()
    store.preview({ contrast: 130 })
    void store.commit()
    expect(persist).toHaveBeenCalledOnce()

    finishFirst({ ...DEFAULT_READER_COLOR_FILTER, brightness: 110 })
    await expect(writing).rejects.toThrow("disk full")
    expect(persist).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toMatchObject({ brightness: 110, contrast: 100 })
    expect(onError).toHaveBeenCalledOnce()
  })

  it("[neoview.color-filter.reset] resets locally and uses one explicit reset mutation", async () => {
    const persist = vi.fn(async (_settings, reset) => ({ ...DEFAULT_READER_COLOR_FILTER }))
    const store = createReaderColorFilterStore({ persist })
    store.preview({ sepia: 70, invert: true })
    await store.reset()
    expect(store.getSnapshot()).toEqual(DEFAULT_READER_COLOR_FILTER)
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[1]).toBe(true)
  })
})
