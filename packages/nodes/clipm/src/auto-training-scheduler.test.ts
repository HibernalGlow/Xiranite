import { afterEach, describe, expect, test, vi } from "vitest"
import { ClipmAutoTrainingScheduler } from "./auto-training-scheduler.js"

afterEach(() => {
  vi.useRealTimers()
})

describe("ClipmAutoTrainingScheduler", () => {
  test("attempts once after the configured idle window", async () => {
    vi.useFakeTimers()
    const runAttempt = vi.fn(async () => undefined)
    const scheduler = new ClipmAutoTrainingScheduler({
      enabled: true,
      batchSize: 20,
      idleDelayMs: 600_000,
      runAttempt,
    })

    await scheduler.runActivity(async () => undefined)
    await vi.advanceTimersByTimeAsync(599_999)
    expect(runAttempt).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(runAttempt).toHaveBeenCalledOnce()
    expect(runAttempt).toHaveBeenCalledWith(20)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(runAttempt).toHaveBeenCalledOnce()
  })

  test("resets idle time around overlapping native node operations", async () => {
    vi.useFakeTimers()
    const runAttempt = vi.fn(async () => undefined)
    const scheduler = new ClipmAutoTrainingScheduler({
      enabled: true,
      batchSize: 12,
      idleDelayMs: 100,
      runAttempt,
    })
    let finish!: () => void
    const operation = scheduler.runActivity(async () => await new Promise<void>((resolve) => { finish = resolve }))

    await vi.advanceTimersByTimeAsync(500)
    expect(runAttempt).not.toHaveBeenCalled()
    finish()
    await operation
    await vi.advanceTimersByTimeAsync(99)
    expect(runAttempt).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(runAttempt).toHaveBeenCalledWith(12)
  })

  test("disabling automatic training cancels a pending attempt", async () => {
    vi.useFakeTimers()
    const runAttempt = vi.fn(async () => undefined)
    const scheduler = new ClipmAutoTrainingScheduler({
      enabled: true,
      batchSize: 20,
      idleDelayMs: 100,
      runAttempt,
    })
    await scheduler.runActivity(async () => undefined)

    scheduler.disable()
    await vi.advanceTimersByTimeAsync(100)

    expect(runAttempt).not.toHaveBeenCalled()
  })
})
