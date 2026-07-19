import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReaderSlideshow } from "@xiranite/node-neoview/ui-core"

import { ReaderSlideshowToolbar } from "./ReaderSlideshowToolbar"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("ReaderSlideshowToolbar", () => {
  it("[neoview.slideshow.react-controls] controls the shared slideshow runtime", () => {
    vi.useFakeTimers()
    const slideshow = new ReaderSlideshow({
      readPosition: () => ({ pageCount: 2, currentPageIndex: 0, atEnd: false }),
      nextPage: vi.fn(async () => true),
      goToPage: vi.fn(async () => true),
    })
    const onChange = vi.fn((patch) => slideshow.configure(patch))
    render(<ReaderSlideshowToolbar slideshow={slideshow} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "播放幻灯片" }))
    expect(screen.getByRole("button", { name: "暂停幻灯片" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("progressbar", { name: "幻灯片倒计时进度" })).toBeTruthy()
    fireEvent.change(screen.getByRole("slider", { name: "幻灯片间隔" }), { target: { value: "10" } })
    expect(slideshow.getSnapshot().intervalSeconds).toBe(10)
    fireEvent.click(screen.getByRole("button", { name: "幻灯片间隔 15 秒" }))
    expect(slideshow.getSnapshot().intervalSeconds).toBe(15)
    fireEvent.click(screen.getByRole("button", { name: "循环播放" }))
    fireEvent.click(screen.getByRole("button", { name: "随机播放" }))
    expect(slideshow.getSnapshot()).toMatchObject({ loop: true, random: true })
    expect(onChange.mock.calls).toEqual([
      [{ intervalSeconds: 10 }],
      [{ intervalSeconds: 15 }],
      [{ loop: true }],
      [{ random: true }],
    ])
    slideshow.dispose()
  })
})
