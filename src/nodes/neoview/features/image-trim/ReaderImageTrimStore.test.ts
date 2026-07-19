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

  it("[neoview.image-trim.edges] synchronizes linked pairs locally and persists once per completed action", async () => {
    const persist = vi.fn(async (value: ReaderImageTrimSettings) => value)
    const store = createReaderImageTrimStore({ persist })
    store.hydrate({ ...settings(), top: 10, bottom: 20, left: 5, right: 15 })

    await store.update({ linkVertical: true, linkHorizontal: true })
    expect(store.getSnapshot()).toMatchObject({ top: 20, bottom: 20, left: 15, right: 15 })
    expect(persist).toHaveBeenCalledOnce()

    store.preview({ top: 12 })
    store.preview({ left: 8 })
    expect(store.getSnapshot()).toMatchObject({ top: 12, bottom: 12, left: 8, right: 8 })
    expect(persist).toHaveBeenCalledOnce()
    await store.commit()
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[1]?.[0]).toMatchObject({ top: 12, bottom: 12, left: 8, right: 8 })
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

  it("[neoview.image-trim.persistence] [neoview.image-trim.states] rolls an optimistic preview back after a failed write", async () => {
    const failure = new Error("config disk unavailable")
    const onError = vi.fn()
    const store = createReaderImageTrimStore({
      persist: async () => { throw failure },
      onError,
    })
    const confirmed = settings()
    store.hydrate(confirmed)
    store.preview({ enabled: true, top: 12.5, autoTrimTarget: "white" })
    expect(store.getSnapshot()).toMatchObject({ enabled: true, top: 12.5, autoTrimTarget: "white" })

    await expect(store.commit()).rejects.toBe(failure)

    expect(store.getSnapshot()).toEqual(confirmed)
    expect(onError).toHaveBeenCalledWith(failure)
    store.dispose()
  })

  it("[neoview.image-trim.auto-persist] applies detected margins through one canonical write", async () => {
    const persist = vi.fn(async (settings: ReaderImageTrimSettings) => settings)
    const detect = vi.fn(async () => ({ top: 10, bottom: 11, left: 12, right: 13 }))
    const store = createReaderImageTrimStore({ persist, detect })
    store.hydrate(settings())
    const image = decodedImage()
    store.registerImage("page-1:v1", image)

    await expect(store.autoDetect()).resolves.toEqual({
      status: "applied",
      margins: { top: 10, bottom: 11, left: 12, right: 13 },
    })

    expect(detect).toHaveBeenCalledWith(image, expect.objectContaining({ threshold: 30, target: "auto" }))
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[0]).toMatchObject({ enabled: true, top: 10, bottom: 11, left: 12, right: 13 })
    store.dispose()
  })

  it("[neoview.image-trim.zero-border] leaves settings and persistence untouched when no border is found", async () => {
    const persist = vi.fn(async (value: ReaderImageTrimSettings) => value)
    const store = createReaderImageTrimStore({
      persist,
      detect: async () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    })
    store.hydrate({ ...settings(), top: 7 })
    store.registerImage("page-1:v1", decodedImage())

    await expect(store.presetWhite()).resolves.toEqual({ status: "no-border" })

    expect(store.getSnapshot()?.top).toBe(7)
    expect(persist).not.toHaveBeenCalled()
    store.dispose()
  })

  it("[neoview.image-trim.presets] uses the fixed legacy threshold for explicit black and white targets", async () => {
    const detect = vi.fn(async () => ({ top: 0, bottom: 0, left: 0, right: 0 }))
    const store = createReaderImageTrimStore({ persist: async (value) => value, detect })
    store.hydrate(settings())
    const image = decodedImage()
    store.registerImage("page-1:v1", image)

    await store.presetBlack()
    await store.presetWhite()

    expect(detect).toHaveBeenNthCalledWith(1, image, expect.objectContaining({ threshold: 40, target: "black" }))
    expect(detect).toHaveBeenNthCalledWith(2, image, expect.objectContaining({ threshold: 40, target: "white" }))
    store.dispose()
  })

  it("[neoview.image-trim.stale-detection] [neoview.image-trim.navigation-cancel] aborts and ignores a result after image replacement", async () => {
    let resolveDetection!: (value: { top: number; bottom: number; left: number; right: number }) => void
    let detectionSignal!: AbortSignal
    const persist = vi.fn(async (value: ReaderImageTrimSettings) => value)
    const store = createReaderImageTrimStore({
      persist,
      detect: (_image, options) => {
        detectionSignal = options.signal
        return new Promise((resolve) => { resolveDetection = resolve })
      },
    })
    store.hydrate(settings())
    const unregister = store.registerImage("page-1:v1", decodedImage())
    const pending = store.autoDetect()

    unregister()
    store.registerImage("page-2:v1", decodedImage())
    expect(detectionSignal.aborted).toBe(true)
    resolveDetection({ top: 10, bottom: 10, left: 10, right: 10 })

    await expect(pending).resolves.toEqual({ status: "cancelled" })
    expect(persist).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toEqual(settings())
    store.dispose()
  })

  it("[neoview.image-trim.detect-dispose] aborts pending detection on disposal", async () => {
    let detectionSignal!: AbortSignal
    const store = createReaderImageTrimStore({
      persist: async (value) => value,
      detect: (_image, options) => {
        detectionSignal = options.signal
        return new Promise(() => undefined)
      },
    })
    store.hydrate(settings())
    store.registerImage("page-1:v1", decodedImage())
    void store.autoDetect()
    await Promise.resolve()

    store.dispose()

    expect(detectionSignal.aborted).toBe(true)
  })
})

function settings(): ReaderImageTrimSettings {
  return { enabled: false, top: 0, bottom: 0, left: 0, right: 0, linkVertical: false, linkHorizontal: false, autoTrimThreshold: 30, autoTrimTarget: "auto" }
}

function decodedImage(): HTMLImageElement {
  const image = document.createElement("img")
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1200 },
    naturalHeight: { configurable: true, value: 800 },
  })
  return image
}
