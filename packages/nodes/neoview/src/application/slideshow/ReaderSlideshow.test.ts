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

  it("[neoview.slideshow.async-navigation] keeps navigation single-flight when the countdown is reset", async () => {
    vi.useFakeTimers()
    let finishNavigation!: (completed: boolean) => void
    const nextPage = vi.fn(() => new Promise<boolean>((resolve) => { finishNavigation = resolve }))
    const slideshow = new ReaderSlideshow({
      readPosition: () => ({ pageCount: 3, currentPageIndex: 0, atEnd: false }),
      nextPage,
      goToPage: vi.fn(async () => true),
    }, { intervalSeconds: 1 })

    slideshow.play()
    await vi.advanceTimersByTimeAsync(1000)
    expect(nextPage).toHaveBeenCalledTimes(1)

    slideshow.resetOnUserAction()
    await vi.advanceTimersByTimeAsync(1000)
    expect(nextPage).toHaveBeenCalledTimes(1)

    finishNavigation(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(nextPage).toHaveBeenCalledTimes(2)
    slideshow.dispose()
  })

  it("[neoview.slideshow.dispose] becomes terminal while async navigation is in flight", async () => {
    vi.useFakeTimers()
    let finishNavigation!: (completed: boolean) => void
    const nextPage = vi.fn(() => new Promise<boolean>((resolve) => { finishNavigation = resolve }))
    const slideshow = new ReaderSlideshow({
      readPosition: () => ({ pageCount: 2, currentPageIndex: 0, atEnd: false }),
      nextPage,
      goToPage: vi.fn(async () => true),
    }, { intervalSeconds: 1 })

    slideshow.play()
    await vi.advanceTimersByTimeAsync(1000)
    slideshow.dispose()
    finishNavigation(true)
    await vi.runAllTimersAsync()

    expect(slideshow.getSnapshot()).toMatchObject({ state: "stopped", remainingSeconds: 0 })
    expect(nextPage).toHaveBeenCalledTimes(1)
    slideshow.play()
    await vi.advanceTimersByTimeAsync(5000)
    expect(nextPage).toHaveBeenCalledTimes(1)
  })

  it("[neoview.slideshow.boundaries] stops without navigating a single-page book and bounds invalid random values", async () => {
    vi.useFakeTimers()
    const singlePageNext = vi.fn(async () => true)
    const singlePageGoTo = vi.fn(async () => true)
    const singlePage = new ReaderSlideshow({
      readPosition: () => ({ pageCount: 1, currentPageIndex: 0, atEnd: true }),
      nextPage: singlePageNext,
      goToPage: singlePageGoTo,
    }, { intervalSeconds: 1, loop: true, random: true })

    singlePage.play()
    await vi.advanceTimersByTimeAsync(1000)
    expect(singlePage.getSnapshot().state).toBe("stopped")
    expect(singlePageNext).not.toHaveBeenCalled()
    expect(singlePageGoTo).not.toHaveBeenCalled()
    singlePage.dispose()

    const goToPage = vi.fn(async () => true)
    const randomPage = new ReaderSlideshow({
      readPosition: () => ({ pageCount: 3, currentPageIndex: 0, atEnd: false }),
      nextPage: vi.fn(async () => true),
      goToPage,
      random: () => Number.NaN,
    }, { intervalSeconds: 1, random: true })
    randomPage.play()
    await vi.advanceTimersByTimeAsync(1000)
    expect(goToPage).toHaveBeenCalledWith(1)
    randomPage.dispose()
  })

  it("[neoview.slideshow.errors] recovers the timer when position or error observers throw", async () => {
    vi.useFakeTimers()
    let readCount = 0
    const onError = vi.fn(() => { throw new Error("observer failed") })
    const nextPage = vi.fn(async () => true)
    const slideshow = new ReaderSlideshow({
      readPosition: () => {
        readCount += 1
        if (readCount === 1) throw new Error("position failed")
        return { pageCount: 2, currentPageIndex: 0, atEnd: false }
      },
      nextPage,
      goToPage: vi.fn(async () => true),
      onError,
    }, { intervalSeconds: 1 })

    slideshow.play()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onError).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(nextPage).toHaveBeenCalledTimes(1)
    slideshow.dispose()
  })

  it("[neoview.slideshow.runtime-config] applies a config snapshot atomically", () => {
    const slideshow = new ReaderSlideshow({
      readPosition: () => ({ pageCount: 1, currentPageIndex: 0, atEnd: true }),
      nextPage: vi.fn(async () => true),
      goToPage: vi.fn(async () => true),
    })
    const listener = vi.fn()
    slideshow.subscribe(listener)
    slideshow.configure({ intervalSeconds: 12, loop: true, random: true })
    expect(slideshow.getSnapshot()).toMatchObject({ intervalSeconds: 12, loop: true, random: true })
    expect(listener).toHaveBeenCalledTimes(1)
    slideshow.configure({ intervalSeconds: 12, loop: true, random: true })
    expect(listener).toHaveBeenCalledTimes(1)
    slideshow.dispose()
  })
})
