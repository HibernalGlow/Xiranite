import { describe, expect, it } from "vitest"
import { VideoProcessScheduler } from "./VideoProcessScheduler.js"

const request = {
  resource: "cpu" as const,
  kind: "ffmpeg",
  priority: "background" as const,
}

describe("VideoProcessScheduler", () => {
  it("[neoview.video-process.scheduler] queues work on the same scheduler and reports a snapshot", async () => {
    const scheduler = new VideoProcessScheduler()
    const first = await scheduler.acquire(request)
    const secondPromise = scheduler.acquire(request)

    expect(scheduler.snapshot()).toEqual({
      active: 1,
      queued: 1,
      maxConcurrent: 1,
      closed: false,
    })

    first.release()
    const second = await secondPromise
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 0, closed: false })
    second.release()
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 0 })
    scheduler.close()
  })

  it("rejects queued work on close and does not start it after release", async () => {
    const scheduler = new VideoProcessScheduler()
    const active = await scheduler.acquire(request)
    const queued = scheduler.acquire(request)

    scheduler.close()
    await expect(queued).rejects.toMatchObject({ name: "AbortError" })
    active.release()

    expect(scheduler.snapshot()).toEqual({
      active: 0,
      queued: 0,
      maxConcurrent: 1,
      closed: true,
    })
  })

  it("makes close idempotent", () => {
    const scheduler = new VideoProcessScheduler()

    expect(() => scheduler.close()).not.toThrow()
    expect(() => scheduler.close()).not.toThrow()
    expect(scheduler.snapshot().closed).toBe(true)
  })

  it("returns to zero active work after an active lease is released", async () => {
    const scheduler = new VideoProcessScheduler()
    const lease = await scheduler.acquire(request)

    expect(scheduler.snapshot().active).toBe(1)
    lease.release()
    expect(scheduler.snapshot()).toEqual({
      active: 0,
      queued: 0,
      maxConcurrent: 1,
      closed: false,
    })
    scheduler.close()
  })
})
