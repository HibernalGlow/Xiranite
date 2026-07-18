import { describe, expect, it, vi } from "vitest"

import { ReaderViewerToggleStore } from "./ReaderViewerToggleStore"

describe("ReaderViewerToggleStore", () => {
  it("[neoview.bindings.viewer-toggle-store] shares viewer visibility outside Reader root state", () => {
    const store = new ReaderViewerToggleStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.toggleProgressBarGlow()
    expect(store.getSnapshot()).toEqual({ progressBarVisible: true, progressBarGlow: false, pageInfoVisible: true })
    store.toggleProgressBar()
    expect(store.getSnapshot()).toEqual({ progressBarVisible: false, progressBarGlow: false, pageInfoVisible: true })
    store.togglePageInfo()
    expect(store.getSnapshot()).toEqual({ progressBarVisible: false, progressBarGlow: false, pageInfoVisible: false })
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    store.toggleProgressBar()
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
