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
    const bytes = readHostAvailableMemoryBytes({
      platform: "darwin",
      readVmStat: () => {
        throw new Error("vm_stat unavailable")
      },
    })

    // `process.availableMemory` is a Bun API; plain Node reports no probe at all.
    const runtimeProbe = (process as { availableMemory?: () => number }).availableMemory
    if (typeof runtimeProbe === "function") expect(bytes).toBe(runtimeProbe())
    else expect(bytes).toBeUndefined()
  })

  test("rejects vm_stat output without any reclaimable section", () => {
    const bytes = readHostAvailableMemoryBytes({
      platform: "darwin",
      readVmStat: () => "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n",
    })

    const runtimeProbe = (process as { availableMemory?: () => number }).availableMemory
    if (typeof runtimeProbe === "function") expect(bytes).toBe(runtimeProbe())
    else expect(bytes).toBeUndefined()
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
    const bytes = readHostAvailableMemoryBytes({ platform: "linux" })
    const runtimeProbe = (process as { availableMemory?: () => number }).availableMemory
    if (typeof runtimeProbe === "function") expect(bytes).toBe(runtimeProbe())
    else expect(bytes).toBeUndefined()
  })
})
