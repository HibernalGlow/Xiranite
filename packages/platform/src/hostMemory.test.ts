import { describe, expect, test } from "vitest"

import { readHostAvailableMemoryBytes } from "./hostMemory.js"

/**
 * Shape of a real `vm_stat` run on Apple Silicon. The free-pages figure is tiny
 * while the reclaimable sections dominate, which is exactly the asymmetry that
 * makes the runtime's own available-memory probe unusable on macOS.
 */
const VM_STAT_SAMPLE = [
  "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
  "Pages free:                                4974.",
  "Pages active:                            211392.",
  "Pages inactive:                          208352.",
  "Pages speculative:                         3986.",
  "Pages purgeable:                          11686.",
  "Pages wired down:                        192812.",
  "Pages occupied by compressor:            388331.",
  "",
].join("\n")

const PAGE_SIZE = 16384

/**
 * Pins `process.availableMemory` for one assertion.
 *
 * The runtime's own probe answers a *different* number every time it is read, so a test that compares the
 * function's return value against a second call made afterwards is a race, not a check — it passed only
 * while no runtime on the machine exposed the probe. Both Node 26 and Bun 1.4 do expose it, so that race is
 * now a red test on any supported platform. A stubbed figure is also the only way to assert the non-macOS
 * path on a macOS host.
 */
function withRuntimeProbe<T>(value: number | undefined, run: () => T): T {
  const holder = process as { availableMemory?: () => number }
  const original = Object.getOwnPropertyDescriptor(holder, "availableMemory")
  if (value === undefined) delete holder.availableMemory
  else holder.availableMemory = () => value
  try {
    return run()
  } finally {
    delete holder.availableMemory
    if (original !== undefined) Object.defineProperty(holder, "availableMemory", original)
  }
}

describe("readHostAvailableMemoryBytes", () => {
  test("sums macOS reclaimable pages instead of free pages alone", () => {
    const bytes = readHostAvailableMemoryBytes({
      platform: "darwin",
      readVmStat: () => VM_STAT_SAMPLE,
    })

    const freePagesOnly = 4974 * PAGE_SIZE
    expect(bytes).toBe((4974 + 208352 + 3986 + 11686) * PAGE_SIZE)
    expect(bytes!).toBeGreaterThan(freePagesOnly * 40)
  })

  test("falls back to the runtime probe when the macOS probe fails", () => {
    withRuntimeProbe(7_000_000_000, () => {
      const bytes = readHostAvailableMemoryBytes({
        platform: "darwin",
        readVmStat: () => {
          throw new Error("vm_stat unavailable")
        },
      })

      expect(bytes).toBe(7_000_000_000)
    })
  })

  test("reports no pressure signal when the runtime has no probe", () => {
    withRuntimeProbe(undefined, () => {
      const bytes = readHostAvailableMemoryBytes({
        platform: "darwin",
        readVmStat: () => {
          throw new Error("vm_stat unavailable")
        },
      })

      expect(bytes).toBeUndefined()
    })
  })

  test("rejects vm_stat output without any reclaimable section", () => {
    withRuntimeProbe(777, () => {
      const bytes = readHostAvailableMemoryBytes({
        platform: "darwin",
        readVmStat: () => "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n",
      })

      expect(bytes).toBe(777)
    })
  })

  test("never serves a cached sample to a caller-supplied probe", () => {
    let reads = 0
    const options = {
      platform: "darwin" as const,
      readVmStat: () => {
        reads += 1
        return VM_STAT_SAMPLE
      },
    }

    readHostAvailableMemoryBytes(options)
    readHostAvailableMemoryBytes(options)
    // Caching a test seam would leak one test's fixture into the next.
    expect(reads).toBe(2)
  })

  test("returns a plausible figure from the real macOS probe", () => {
    if (process.platform !== "darwin") return

    const bytes = readHostAvailableMemoryBytes({ platform: "darwin" })
    // Free pages alone measure well under 512 MiB on macOS; reclaimable pages do not.
    expect(bytes).toBeGreaterThan(512 * 1024 * 1024)
  })

  test("uses the runtime probe unchanged on non-macOS platforms", () => {
    withRuntimeProbe(4_000_000_000, () => {
      expect(readHostAvailableMemoryBytes({ platform: "linux" })).toBe(4_000_000_000)
      expect(readHostAvailableMemoryBytes({ platform: "win32" })).toBe(4_000_000_000)
    })
    withRuntimeProbe(undefined, () => {
      expect(readHostAvailableMemoryBytes({ platform: "linux" })).toBeUndefined()
    })
  })

  test("rejects a probe figure that is not a byte count", () => {
    withRuntimeProbe(-1, () => {
      expect(readHostAvailableMemoryBytes({ platform: "linux" })).toBeUndefined()
    })
  })
})
