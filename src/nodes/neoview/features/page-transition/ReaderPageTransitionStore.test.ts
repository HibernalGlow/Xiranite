import { DEFAULT_READER_PAGE_TRANSITION } from "@xiranite/node-neoview/ui-core"
import { describe, expect, it, vi } from "vitest"

import { createReaderPageTransitionStore } from "./ReaderPageTransitionStore"

describe("ReaderPageTransitionStore", () => {
  it("[neoview.page-transition.slider-commit] previews repeated slider values and persists once", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderPageTransitionStore({ persist })

    for (let duration = 10; duration <= 400; duration += 10) store.preview({ duration })

    expect(store.getSnapshot().duration).toBe(400)
    expect(persist).not.toHaveBeenCalled()
    await store.commit()
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[0].duration).toBe(400)
  })

  it("[neoview.page-transition.hydration-race] ignores late hydration after local input", () => {
    const store = createReaderPageTransitionStore({ persist: async (settings) => settings })
    store.preview({ duration: 250 })
    store.hydrate({ ...DEFAULT_READER_PAGE_TRANSITION, duration: 100 })
    expect(store.getSnapshot().duration).toBe(250)
  })

  it("[neoview.page-transition.persistence] serializes writes and rolls back the latest failure", async () => {
    let finishFirst!: (settings: typeof DEFAULT_READER_PAGE_TRANSITION) => void
    const first = new Promise<typeof DEFAULT_READER_PAGE_TRANSITION>((resolve) => { finishFirst = resolve })
    const persist = vi.fn()
      .mockReturnValueOnce(first)
      .mockRejectedValueOnce(new Error("disk full"))
    const store = createReaderPageTransitionStore({ persist })
    store.preview({ duration: 200 })
    const writing = store.commit()
    store.preview({ easing: "linear" })
    void store.commit()

    expect(persist).toHaveBeenCalledOnce()
    finishFirst({ ...DEFAULT_READER_PAGE_TRANSITION, duration: 200 })
    await expect(writing).rejects.toThrow("disk full")
    expect(persist).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toEqual({ ...DEFAULT_READER_PAGE_TRANSITION, duration: 200 })
  })

  it("[neoview.page-transition.reset] restores all defaults with one reset mutation", async () => {
    const persist = vi.fn(async () => ({ ...DEFAULT_READER_PAGE_TRANSITION }))
    const store = createReaderPageTransitionStore({ persist })
    store.preview({ enabled: true, type: "flip", duration: 400, easing: "linear" })
    await store.reset()

    expect(store.getSnapshot()).toEqual(DEFAULT_READER_PAGE_TRANSITION)
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[1]).toBe(true)
  })
})
