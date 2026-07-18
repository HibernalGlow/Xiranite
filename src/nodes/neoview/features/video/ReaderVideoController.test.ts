import { describe, expect, it, vi } from "vitest"

import { ReaderVideoController } from "./ReaderVideoController"

describe("ReaderVideoController", () => {
  it("[neoview.bindings.video-controller] preserves legacy video action semantics on the active native element", async () => {
    const controller = new ReaderVideoController()
    controller.configure({ videoMinPlaybackRate: 0.5, videoMaxPlaybackRate: 2, videoPlaybackRateStep: 0.5 })
    const video = document.createElement("video")
    Object.defineProperty(video, "duration", { configurable: true, value: 100 })
    video.currentTime = 95
    const play = vi.spyOn(video, "play").mockResolvedValue()
    const onListEnded = vi.fn()
    const unregister = controller.register(video, onListEnded)

    expect(controller.playPause()).toBe(true)
    expect(play).toHaveBeenCalledOnce()
    controller.seek(1)
    expect(video.currentTime).toBe(100)
    controller.seek(-1)
    expect(video.currentTime).toBe(90)
    controller.adjustVolume(-1)
    expect(video.volume).toBeCloseTo(0.9)
    for (let index = 0; index < 9; index += 1) controller.adjustVolume(-1)
    expect(video.volume).toBe(0)
    expect(video.muted).toBe(true)
    controller.toggleMute()
    expect(video.muted).toBe(false)

    controller.adjustSpeed(1)
    expect(video.playbackRate).toBe(1.5)
    controller.adjustSpeed(1)
    controller.adjustSpeed(1)
    expect(video.playbackRate).toBe(2)
    controller.toggleSpeed()
    expect(video.playbackRate).toBe(1)
    controller.toggleSpeed()
    expect(video.playbackRate).toBe(2)

    video.dispatchEvent(new Event("ended"))
    expect(onListEnded).toHaveBeenCalledOnce()
    controller.cycleLoopMode()
    expect(video.loop).toBe(true)
    video.dispatchEvent(new Event("ended"))
    expect(onListEnded).toHaveBeenCalledOnce()
    controller.cycleLoopMode()
    expect(video.loop).toBe(false)
    controller.cycleLoopMode()
    video.dispatchEvent(new Event("ended"))
    expect(onListEnded).toHaveBeenCalledTimes(2)

    unregister()
    expect(controller.playPause()).toBe(false)
    controller.dispose()
  })

  it("[neoview.bindings.video-lifecycle] falls back to the previous mounted video and releases ended listeners", () => {
    const controller = new ReaderVideoController()
    const first = document.createElement("video")
    const second = document.createElement("video")
    const firstEnded = vi.fn()
    const secondEnded = vi.fn()
    const unregisterFirst = controller.register(first, firstEnded)
    const unregisterSecond = controller.register(second, secondEnded)

    first.dispatchEvent(new Event("ended"))
    second.dispatchEvent(new Event("ended"))
    expect(firstEnded).not.toHaveBeenCalled()
    expect(secondEnded).toHaveBeenCalledOnce()

    unregisterSecond()
    first.dispatchEvent(new Event("ended"))
    expect(firstEnded).toHaveBeenCalledOnce()
    unregisterFirst()
    first.dispatchEvent(new Event("ended"))
    expect(firstEnded).toHaveBeenCalledOnce()
  })
})
