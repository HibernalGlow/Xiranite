import { describe, expect, it } from "vitest"

import { ResourceSchedulerService } from "./resourceScheduler.js"

describe("ResourceSchedulerService", () => {
  it("[xiranite.scheduler.priority] reserves an interactive CPU slot across owners and reports queue state", async () => {
    const scheduler = new ResourceSchedulerService({
      pools: { cpu: { maxConcurrent: 2, reservedInteractive: 1 } },
    })
    const background = await scheduler.acquire({
      resource: "cpu",
      kind: "thumbnail.generate",
      priority: "background",
      ownerId: "other-node",
    })
    const deferred = scheduler.acquire({
      resource: "cpu",
      kind: "thumbnail.generate",
      priority: "background",
      ownerId: "other-node",
    })
    expect(scheduler.snapshot().cpu).toMatchObject({
      active: 1,
      queued: 1,
      queuedByPriority: { interactive: 0, view: 0, ahead: 0, background: 1 },
    })

    const interactive = await scheduler.acquire({
      resource: "cpu",
      kind: "neoview.image-transform",
      priority: "interactive",
      ownerId: "reader-1",
    })
    expect(scheduler.snapshot().cpu.active).toBe(2)
    interactive.release()
    background.release()
    const next = await deferred
    next.release()
    expect(scheduler.snapshot().cpu).toMatchObject({ active: 0, queued: 0 })
  })

  it("[xiranite.scheduler.pools] uses independent CPU, I/O and GPU pools and cancels queued work", async () => {
    const scheduler = new ResourceSchedulerService({
      pools: {
        cpu: { maxConcurrent: 1, reservedInteractive: 0 },
        io: { maxConcurrent: 1, reservedInteractive: 0 },
        gpu: { maxConcurrent: 1, reservedInteractive: 0 },
      },
    })
    const cpu = await scheduler.acquire({ resource: "cpu", kind: "cpu", priority: "interactive" })
    const io = await scheduler.acquire({ resource: "io", kind: "io", priority: "interactive" })
    const gpu = await scheduler.acquire({ resource: "gpu", kind: "gpu", priority: "interactive" })
    expect(scheduler.snapshot()).toMatchObject({ cpu: { active: 1 }, io: { active: 1 }, gpu: { active: 1 } })

    const abort = new AbortController()
    const queued = scheduler.acquire({ resource: "cpu", kind: "queued", priority: "interactive" }, abort.signal)
    abort.abort(new Error("cancelled queued resource"))
    await expect(queued).rejects.toThrow("cancelled queued resource")
    expect(scheduler.snapshot().cpu.queued).toBe(0)
    cpu.release()
    io.release()
    gpu.release()
  })

  it("[xiranite.scheduler.telemetry] reports lease lifecycle and monotonic queue wait without retaining tasks", async () => {
    let now = 100
    const scheduler = new ResourceSchedulerService({
      pools: { cpu: { maxConcurrent: 1, reservedInteractive: 0 } },
      now: () => now,
    })
    const active = await scheduler.acquire({ resource: "cpu", kind: "active", priority: "interactive" })
    now = 125
    const nextPromise = scheduler.acquire({ resource: "cpu", kind: "next", priority: "view" })
    now = 145
    expect(scheduler.snapshot().cpu.oldestQueuedWaitMs).toBe(20)
    now = 165
    active.release()
    active.release()
    const next = await nextPromise
    expect(scheduler.snapshot().cpu).toMatchObject({
      active: 1,
      queued: 0,
      granted: 2,
      released: 1,
      cancelled: 0,
      queueWaitSamples: 2,
      totalQueueWaitMs: 40,
      maxQueueWaitMs: 40,
      oldestQueuedWaitMs: 0,
    })
    next.release()
    expect(scheduler.snapshot().cpu).toMatchObject({ active: 0, released: 2 })
  })
})
