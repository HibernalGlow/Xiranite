import { describe, expect, it, vi } from "vitest"

import type { ReaderImageTrimSettings } from "@xiranite/node-neoview/image-trim"
import { createReaderImageTrimStore } from "./ReaderImageTrimStore"

describe("ReaderImageTrimStore", () => {
  it("[neoview.image-trim.store] previews locally and writes once on commit", async () => {
    const persist = vi.fn(async (settings: ReaderImageTrimSettings) => settings)
    const store = createReaderImageTrimStore({ persist })
    store.hydrate({ enabled: false, top: 0, bottom: 0, left: 0, right: 0, linkVertical: false, linkHorizontal: false, autoTrimThreshold: 30, autoTrimTarget: "auto" })
    store.preview({ enabled: true, top: 10.5 })
    expect(persist).not.toHaveBeenCalled()
    await store.commit()
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[0]).toMatchObject({ enabled: true, top: 10.5 })
    store.dispose()
  })

  it("[neoview.image-trim.dispose] aborts persistence and ignores a late result after disposal", async () => {
    let resolvePersist!: (settings: ReaderImageTrimSettings) => void
    let persistSignal!: AbortSignal
    const persist = vi.fn((settings: ReaderImageTrimSettings, _reset: boolean, signal: AbortSignal) => {
      persistSignal = signal
      return new Promise<ReaderImageTrimSettings>((resolve) => { resolvePersist = resolve })
    })
    const listener = vi.fn()
    const store = createReaderImageTrimStore({ persist })
    store.hydrate({ enabled: false, top: 0, bottom: 0, left: 0, right: 0, linkVertical: false, linkHorizontal: false, autoTrimThreshold: 30, autoTrimTarget: "auto" })
    store.subscribe(listener)
    store.preview({ top: 10 })
    const commit = store.commit()
    store.dispose()
    expect(persistSignal.aborted).toBe(true)
    resolvePersist({ enabled: true, top: 99, bottom: 0, left: 0, right: 0, linkVertical: false, linkHorizontal: false, autoTrimThreshold: 100, autoTrimTarget: "white" })
    await commit
    expect(store.getSnapshot()).toBeUndefined()
    expect(listener).toHaveBeenCalledOnce()
    const lateListener = vi.fn()
    store.subscribe(lateListener)
    store.preview({ top: 20 })
    expect(lateListener).not.toHaveBeenCalled()
  })
})
