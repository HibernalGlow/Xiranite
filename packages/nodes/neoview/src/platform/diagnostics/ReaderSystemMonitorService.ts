import { statfs } from "node:fs/promises"
import { cpus, freemem, loadavg, totalmem, uptime } from "node:os"

export interface ReaderSystemMonitorSnapshot {
  schemaVersion: 1
  sampledAtMs: number
  uptimeSeconds: number
  loadAverage: readonly [number, number, number]
  cpu: {
    averageUsagePercent: number
    cores: readonly { index: number; usagePercent: number }[]
  }
  memory: {
    totalBytes: number
    usedBytes: number
    freeBytes: number
    cachedBytes: number | null
  }
  network: {
    available: false
    reason: string
    receiveBytesPerSecond: null
    transmitBytesPerSecond: null
  }
  disk: {
    available: boolean
    reason?: string
    totalBytes: number | null
    usedBytes: number | null
    freeBytes: number | null
  }
  gpu: {
    available: false
    reason: string
  }
}

export interface ReaderSystemMonitorSource {
  now(): number
  cpuTimes(): readonly ReaderCpuTimes[]
  uptime(): number
  loadAverage(): readonly number[]
  totalMemory(): number
  freeMemory(): number
  diskSpace(): Promise<{ totalBytes: number; freeBytes: number }>
}

export interface ReaderCpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

/**
 * An on-demand, single-flight system sampler. It never owns a timer and is
 * therefore inert until the dedicated diagnostics endpoint is requested.
 */
export class ReaderSystemMonitorService {
  readonly #source: ReaderSystemMonitorSource
  #previousCpu?: readonly ReaderCpuTimes[]
  #inFlight?: Promise<ReaderSystemMonitorSnapshot>

  constructor(source: ReaderSystemMonitorSource = platformSystemMonitorSource()) {
    this.#source = source
  }

  sample(): Promise<ReaderSystemMonitorSnapshot> {
    if (this.#inFlight) return this.#inFlight
    const pending = this.#sample().finally(() => {
      if (this.#inFlight === pending) this.#inFlight = undefined
    })
    this.#inFlight = pending
    return pending
  }

  async #sample(): Promise<ReaderSystemMonitorSnapshot> {
    const currentCpu = this.#source.cpuTimes().slice(0, 256)
    const previousCpu = this.#previousCpu
    this.#previousCpu = currentCpu.map((times) => ({ ...times }))
    const cores = currentCpu.map((times, index) => ({
      index,
      usagePercent: cpuUsagePercent(times, previousCpu?.[index]),
    }))
    const averageUsagePercent = cores.length
      ? finitePercent(cores.reduce((total, core) => total + core.usagePercent, 0) / cores.length)
      : 0
    const totalBytes = finiteBytes(this.#source.totalMemory())
    const freeBytes = Math.min(totalBytes, finiteBytes(this.#source.freeMemory()))
    let disk: ReaderSystemMonitorSnapshot["disk"]
    try {
      const space = await this.#source.diskSpace()
      const diskTotal = finiteBytes(space.totalBytes)
      const diskFree = Math.min(diskTotal, finiteBytes(space.freeBytes))
      disk = {
        available: diskTotal > 0,
        ...(diskTotal > 0 ? {} : { reason: "Disk capacity is unavailable." }),
        totalBytes: diskTotal || null,
        usedBytes: diskTotal ? diskTotal - diskFree : null,
        freeBytes: diskTotal ? diskFree : null,
      }
    } catch {
      disk = {
        available: false,
        reason: "Disk capacity is unavailable on this host.",
        totalBytes: null,
        usedBytes: null,
        freeBytes: null,
      }
    }
    const loads = this.#source.loadAverage()
    return {
      schemaVersion: 1,
      sampledAtMs: finiteTimestamp(this.#source.now()),
      uptimeSeconds: finiteNonNegative(this.#source.uptime()),
      loadAverage: [0, 1, 2].map((index) => finiteNonNegative(loads[index] ?? 0)) as [number, number, number],
      cpu: { averageUsagePercent, cores },
      memory: {
        totalBytes,
        usedBytes: totalBytes - freeBytes,
        freeBytes,
        cachedBytes: null,
      },
      network: {
        available: false,
        reason: "Network throughput is unavailable from the portable host sampler.",
        receiveBytesPerSecond: null,
        transmitBytesPerSecond: null,
      },
      disk,
      gpu: {
        available: false,
        reason: "GPU monitoring requires a dedicated host sampler.",
      },
    }
  }
}

function platformSystemMonitorSource(): ReaderSystemMonitorSource {
  return {
    now: Date.now,
    cpuTimes: () => cpus().map((cpu) => cpu.times),
    uptime,
    loadAverage: loadavg,
    totalMemory: totalmem,
    freeMemory: freemem,
    diskSpace: async () => {
      const value = await statfs(process.cwd(), { bigint: true })
      return {
        totalBytes: safeBigInt(value.blocks * value.bsize),
        freeBytes: safeBigInt(value.bavail * value.bsize),
      }
    },
  }
}

function cpuUsagePercent(current: ReaderCpuTimes, previous?: ReaderCpuTimes): number {
  const currentTotal = cpuTotal(current)
  const previousTotal = previous ? cpuTotal(previous) : 0
  const totalDelta = currentTotal - previousTotal
  const idleDelta = current.idle - (previous?.idle ?? 0)
  if (totalDelta <= 0) return 0
  return finitePercent(((totalDelta - Math.max(0, idleDelta)) / totalDelta) * 100)
}

function cpuTotal(value: ReaderCpuTimes): number {
  return value.user + value.nice + value.sys + value.idle + value.irq
}

function safeBigInt(value: bigint): number {
  if (value <= 0n) return 0
  return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value)
}

function finiteTimestamp(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(finiteNonNegative(value))))
}

function finiteBytes(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(finiteNonNegative(value)))
}

function finitePercent(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}
