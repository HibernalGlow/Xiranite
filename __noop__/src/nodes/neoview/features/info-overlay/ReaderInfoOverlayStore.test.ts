import { describe, expect, it, vi } from "vitest"

import type { ReaderInfoOverlaySettings } from "@xiranite/node-neoview/info-overlay"

import { createReaderInfoOverlayStore } from "./ReaderInfoOverlayStore"

describe("ReaderInfoOverlayStore", () => {
  it("[neoview.info-overlay.store-resident] hydrates once and persists preview only when committed", async () => {
    const persist = vi.fn(async (settings: ReaderInfoOverlaySettings) => settings)
    const store = createReaderInfoOverlayStore({ persist })
    store.hydrate({ enabled: false, opacity: 0.85, showBorder: false })
    store.preview({ opacity: 0.5 })

    expect(store.getSnapshot()?.opacity).toBe(0.5)
    expect(persist).not.toHaveBeenCalled()
    await store.commit()
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[0].opacity).toBe(0.5)
    store.dispose()
  })

  it("[neoview.info-overlay.store-reset] resets optional dimensions through one canonical write", async () => {
    const persist = vi.fn(async (settings: ReaderInfoOverlaySettings) => settings)
    const store = createReaderInfoOverlayStore({ persist })
    store.hydrate({ enabled: true, opacity: 0.8, showBorder: true, width: 480, height: 56 })
    await store.reset()

    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[1]).toBe(true)
    expect(store.getSnapshot()).toEqual({ enabled: false, opacity: 0.85, showBorder: false })
    store.dispose()
  })
})
