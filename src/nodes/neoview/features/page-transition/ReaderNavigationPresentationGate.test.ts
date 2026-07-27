import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_PAGE_TRANSITION } from "@xiranite/node-neoview/ui-core"

import { commitReaderNavigation, commitReaderNavigationForPresentation } from "./ReaderNavigationPresentationGate"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("commitReaderNavigationForPresentation", () => {
  it("[neoview.page-transition.continuous-present] commits synchronously and waits for a committed paint", async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return 1
    }))
    const commit = vi.fn()
    let settled = false
    const presented = commitReaderNavigationForPresentation(commit, 0).then(() => { settled = true })

    expect(commit).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    frames.shift()?.(16)
    await Promise.resolve()
    expect(settled).toBe(false)
    frames.shift()?.(32)
    await presented
    expect(settled).toBe(true)
  })

  it("waits for an enabled page-transition duration after the first paint", async () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback)
      return 1
    })
    let settled = false
    const presented = commitReaderNavigationForPresentation(vi.fn(), 240).then(() => { settled = true })

    frames.shift()?.(16)
    await Promise.resolve()
    frames.shift()?.(32)
    for (let turn = 0; turn < 4; turn += 1) await Promise.resolve()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(239)
    expect(settled).toBe(false)
    vi.advanceTimersByTime(1)
    await presented
    expect(settled).toBe(true)
  })

  it("bypasses presentation waiting when the persistent switch is disabled", async () => {
    const commit = vi.fn()
    await commitReaderNavigation(commit, { ...DEFAULT_READER_PAGE_TRANSITION, renderEveryRepeatedPage: false }, true)
    expect(commit).toHaveBeenCalledOnce()
  })
})
