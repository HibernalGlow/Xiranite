import { execFileSync } from "node:child_process"
import { platform as osPlatform } from "node:os"

/**
 * macOS reports only genuinely free pages through the runtime's available-memory
 * probe (`process.availableMemory`, `os.freemem`). The kernel deliberately spends
 * idle RAM on the file cache, so that figure understates what the host can hand out
 * by an order of magnitude: on a 16 GiB machine it measures 80-260 MiB while
 * `vm_stat` accounts for roughly 3.5 GiB of reclaimable pages.
 *
 * Consumers compare this figure against byte thresholds (cache admission, reader
 * memory pressure), so a free-pages-only reading makes macOS look permanently out
 * of memory and silently disables caching. Summing free, inactive, speculative and
 * purgeable pages is the macOS analogue of Linux `MemAvailable`, which keeps the
 * same thresholds meaningful on every supported platform.
 */

const DARWIN_MEMORY_PROBE = "/usr/bin/vm_stat"
const DARWIN_PAGE_SIZE_FALLBACK = 4096
const DARWIN_RECLAIMABLE_SECTIONS = ["Pages free", "Pages inactive", "Pages speculative", "Pages purgeable"] as const
const DEFAULT_PROBE_CACHE_MS = 5_000

export interface HostAvailableMemoryOptions {
  /** Platform to measure for; defaults to the running platform. */
  platform?: NodeJS.Platform
  /** Test seam replacing the `vm_stat` probe on macOS. */
  readVmStat?: () => string
  /** Reuse window for the macOS probe; 0 disables caching. */
  cacheTtlMs?: number
  /** Test seam for cache expiry. */
  now?: () => number
}

let darwinSample: { sampledAtMs: number; bytes: number } | undefined

/**
 * Bytes the host can plausibly hand to new allocations. Returns `undefined` when
 * no probe is available, which callers treat as "no pressure signal".
 */
export function readHostAvailableMemoryBytes(options: HostAvailableMemoryOptions = {}): number | undefined {
  if ((options.platform ?? osPlatform()) !== "darwin") return readRuntimeAvailableBytes()
  try {
    return readDarwinAvailableBytes(options)
  } catch {
    return readRuntimeAvailableBytes()
  }
}

function readDarwinAvailableBytes(options: HostAvailableMemoryOptions): number {
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_PROBE_CACHE_MS)
  const now = options.now ?? Date.now
  // A caller-supplied probe is a test seam, so it must never see a cached sample.
  const cacheable = options.readVmStat === undefined && cacheTtlMs > 0
  if (cacheable && darwinSample && now() - darwinSample.sampledAtMs < cacheTtlMs) return darwinSample.bytes

  const bytes = sumReclaimableDarwinBytes(options.readVmStat?.() ?? readVmStatOutput())
  if (cacheable) darwinSample = { sampledAtMs: now(), bytes }
  return bytes
}

function readVmStatOutput(): string {
  return execFileSync(DARWIN_MEMORY_PROBE, { encoding: "utf8" })
}

function sumReclaimableDarwinBytes(output: string): number {
  const pageSizeMatch = /page size of (\d+) bytes/.exec(output)
  const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : DARWIN_PAGE_SIZE_FALLBACK
  let pages = 0
  let sections = 0
  for (const section of DARWIN_RECLAIMABLE_SECTIONS) {
    const match = new RegExp(`${section}:\\s+(\\d+)`).exec(output)
    if (!match) continue
    pages += Number(match[1])
    sections += 1
  }
  if (sections === 0) throw new Error("vm_stat output contained no reclaimable memory section")
  return pages * pageSize
}

function readRuntimeAvailableBytes(): number | undefined {
  const probe = (process as { availableMemory?: () => number }).availableMemory
  if (typeof probe !== "function") return undefined
  try {
    return normalizeBytes(probe())
  } catch {
    return undefined
  }
}

function normalizeBytes(value: number): number | undefined {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
