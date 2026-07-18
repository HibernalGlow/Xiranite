import { describe, expect, it } from "vitest"

import { ReaderMemoryPressureMonitor } from "./ReaderMemoryPressureMonitor.js"

describe("ReaderMemoryPressureMonitor", () => {
  it("[neoview.memory-pressure.hysteresis] samples without timers and requires the recovery threshold before returning to normal", () => {
    let now = 0
    let available = 900
    const monitor = new ReaderMemoryPressureMonitor({
      criticalAvailableBytes: 200,
      elevatedAvailableBytes: 400,
      recoveryAvailableBytes: 800,
      sampleIntervalMs: 10,
      reliefIntervalMs: 50,
      availableMemory: () => available,
      now: () => now,
    })
    expect(monitor.sample()).toMatchObject({ level: "normal", relieve: false })
    available = 350
    now = 10
    expect(monitor.sample()).toMatchObject({ level: "elevated", relieve: true })
    monitor.recordRelief("elevated")
    available = 700
    now = 20
    expect(monitor.sample()).toMatchObject({ level: "elevated", relieve: false })
    now = 60
    expect(monitor.sample()).toMatchObject({ level: "elevated", relieve: true })
    available = 900
    now = 70
    expect(monitor.sample()).toMatchObject({ level: "normal", relieve: false })
    expect(monitor.snapshot()).toMatchObject({ samples: 5, elevatedReliefs: 1 })
  })

  it("[neoview.memory-pressure.critical] escalates immediately and tolerates unavailable platform metrics", () => {
    let now = 1
    let available: number | undefined = 100
    const monitor = new ReaderMemoryPressureMonitor({
      criticalAvailableBytes: 200,
      elevatedAvailableBytes: 400,
      recoveryAvailableBytes: 800,
      sampleIntervalMs: 0,
      reliefIntervalMs: 50,
      availableMemory: () => available,
      now: () => now,
    })
    expect(monitor.sample()).toMatchObject({ level: "critical", relieve: true, availableBytes: 100 })
    monitor.recordRelief("critical")
    monitor.recordAdmissionRejection()
    available = undefined
    expect(monitor.sample()).toMatchObject({ level: "normal", relieve: false, availableBytes: undefined })
    expect(monitor.sample()).toMatchObject({ level: "normal", relieve: false, availableBytes: undefined })
    available = 100
    now = 60
    expect(monitor.sample()).toMatchObject({ level: "critical", relieve: true, availableBytes: 100 })
    expect(monitor.snapshot()).toMatchObject({ criticalReliefs: 1, admissionRejections: 1 })
  })
})
