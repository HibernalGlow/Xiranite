import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderSlideshow } from "./ReaderSlideshow.js"

afterEach(() => {
  vi.useRealTimers()
})

describe("ReaderSlideshow", () => {
  it("[neoview.slideshow.runtime] serializes timed navigation and stops at the final page", async () => {
    vi.useFakeTimers()
    let pageIndex = 0
    let finishNavigation!: (completed: boolean) => void
    const nextPage = vi.fn(() => new Promise<boolean>((resolve) => { finishNavigation = resolve }))
    const slideshow = new ReaderSlideshow({
      readPosition: () => ({ pageCount: 2, currentPageIndex: pageIndex, atEnd: pageIndex === 1 }),
      nextPage,
      goToPage: vi.fn(async () => true),
    }, { intervalSeconds: 1 })

    slideshow.play()
    await vi.advanceTimersByTimeAsync(1000)
    expect(nextPage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(nextPage).toHaveBeenCalledTimes(1)

    pageIndex = 1
    finishNavigation(true)
    await vi.runAllTimersAsync()
    expect(slideshow.getSnapshot()).toMatchObject({ state: "stopped", remainingSeconds: 0 })
    slideshow.dispose()
  })

  it("[neoview.slideshow.runtime-options] loops, avoids the current random page and cancels on pause", async () => {
    vi.useFakeTimers()
    let position = { pageCount: 4, currentPageIndex: 3, atEnd: true }
    const goToPage = vi.fn(async (pageIndex: number) => {
      position = { ...position, currentPageIndex: pageIndex, atEnd: pageIndex === 3 }
      return true
    })
    const slideshow = new ReaderSlideshow({
      readPosition: () => position,
      nextPage: vi.fn(async () => true),
      goToPage,
      random: () => 0.99,
    }, { intervalSeconds: 2, loop: true })

    slideshow.play()
    await vi.advanceTimersByTimeAsync(2000)
    expect(goToPage).toHaveBeenLastCalledWith(0)
    slideshow.setRandom(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(goToPage).toHaveBeenLastCalledWith(3)
    slideshow.pause()
    await vi.advanceTimersByTimeAsync(5000)
    expect(goToPage).toHaveBeenCalledTimes(2)
    slideshow.dispose()
  })
})
