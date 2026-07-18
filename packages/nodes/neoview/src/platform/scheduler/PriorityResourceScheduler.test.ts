import { describe, expect, it } from "vitest"

import { PriorityResourceScheduler } from "./PriorityResourceScheduler.js"

describe("PriorityResourceScheduler", () => {
  it("[neoview.scheduler.interactive-slot] reserves capacity and prioritizes interactive work", async () => {
    const scheduler = new PriorityResourceScheduler({ maxConcurrent: 2, reservedInteractive: 1 })
    const background = await scheduler.acquire({ resource: "cpu", kind: "thumbnail", priority: "background" })
    const queuedBackground = scheduler.acquire({ resource: "cpu", kind: "thumbnail", priority: "background" })
    let secondBackgroundStarted = false
    void queuedBackground.then(() => { secondBackgroundStarted = true })
    await Promise.resolve()
    expect(secondBackgroundStarted).toBe(false)

    const interactive = await scheduler.acquire({ resource: "cpu", kind: "image-transform", priority: "interactive" })
    expect(scheduler.active).toBe(2)
    interactive.release()
    await Promise.resolve()
    expect(secondBackgroundStarted).toBe(false)
    background.release()
    const second = await queuedBackground
    expect(scheduler.active).toBe(1)
    second.release()
    expect(scheduler.active).toBe(0)
  })

  it("[neoview.scheduler.cancellation] removes cancelled queued work without consuming a slot", async () => {
    const scheduler = new PriorityResourceScheduler({ maxConcurrent: 1, reservedInteractive: 0 })
    const active = await scheduler.acquire({ resource: "cpu", kind: "image-transform", priority: "interactive" })
    const abort = new AbortController()
    const queued = scheduler.acquire({ resource: "cpu", kind: "image-transform", priority: "interactive" }, abort.signal)
    abort.abort(new Error("superseded"))
    await expect(queued).rejects.toThrow("superseded")
    expect(scheduler.queued).toBe(0)
    active.release()
    expect(scheduler.active).toBe(0)
  })

  it("[neoview.scheduler.close] rejects queued work and preserves active lease release", async () => {
    const scheduler = new PriorityResourceScheduler({ maxConcurrent: 1, reservedInteractive: 0 })
    const active = await scheduler.acquire({ resource: "cpu", kind: "active", priority: "interactive" })
    const queued = scheduler.acquire({ resource: "cpu", kind: "queued", priority: "background" })

    scheduler.close()
    scheduler.close()

    await expect(queued).rejects.toMatchObject({ name: "AbortError" })
    expect(scheduler.queued).toBe(0)
    await expect(scheduler.acquire({ resource: "cpu", kind: "after-close", priority: "interactive" })).rejects.toMatchObject({ name: "AbortError" })
    active.release()
    active.release()
    expect(scheduler.active).toBe(0)
  })
})
