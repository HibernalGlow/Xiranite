import { performance } from "node:perf_hooks"

export interface DistributionSummary {
  samples: number
  min: number
  p50: number
  p95: number
  p99: number
  max: number
  average: number
}

export interface ProcessResourceSummary {
  elapsedMs: number
  cpuUserMs: number
  cpuSystemMs: number
  cpuTotalMs: number
  averageCpuCores: number
  rssStartMiB: number
  rssPeakMiB: number
  rssDeltaMiB: number
  heapPeakMiB: number
}

export interface ProcessTreeSummary {
  available: boolean
  samples: number
  peakProcessCount?: number
  peakRssMiB?: number
  cpuTimeDeltaMs?: number
  error?: string
}

const MIB = 1024 * 1024

export class EventLoopDelaySampler {
  readonly #intervalMs: number
  readonly #samples: number[] = []
  #timer?: ReturnType<typeof setInterval>
  #expectedAt = 0

  constructor(intervalMs = 10) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new RangeError("Event-loop interval must be at least 1 ms.")
    this.#intervalMs = intervalMs
  }

  start(): void {
    if (this.#timer) return
    this.#expectedAt = performance.now() + this.#intervalMs
    this.#timer = setInterval(() => {
      const now = performance.now()
      this.#samples.push(Math.max(0, now - this.#expectedAt))
      this.#expectedAt = now + this.#intervalMs
    }, this.#intervalMs)
  }

  async stop(): Promise<DistributionSummary> {
    if (!this.#timer) return summarize([])
    await Bun.sleep(this.#intervalMs * 2)
    clearInterval(this.#timer)
    this.#timer = undefined
    return summarize(this.#samples)
  }
}

export class ProcessResourceSampler {
  readonly #intervalMs: number
  #timer?: ReturnType<typeof setInterval>
  #startedAt = 0
  #cpuStart = { user: 0, system: 0 }
  #rssStart = 0
  #rssPeak = 0
  #heapPeak = 0

  constructor(intervalMs = 25) {
    if (!Number.isFinite(intervalMs) || intervalMs < 5) throw new RangeError("Process sampling interval must be at least 5 ms.")
    this.#intervalMs = intervalMs
  }

  start(): void {
    if (this.#timer) return
    this.#startedAt = performance.now()
    this.#cpuStart = process.cpuUsage()
    const memory = process.memoryUsage()
    this.#rssStart = memory.rss
    this.#rssPeak = memory.rss
    this.#heapPeak = memory.heapUsed
    this.#timer = setInterval(() => this.#sample(), this.#intervalMs)
  }

  stop(): ProcessResourceSummary {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
    this.#sample()
    const elapsedMs = Math.max(0.001, performance.now() - this.#startedAt)
    const cpu = process.cpuUsage(this.#cpuStart)
    const cpuUserMs = cpu.user / 1_000
    const cpuSystemMs = cpu.system / 1_000
    const cpuTotalMs = cpuUserMs + cpuSystemMs
    return {
      elapsedMs: round(elapsedMs),
      cpuUserMs: round(cpuUserMs),
      cpuSystemMs: round(cpuSystemMs),
      cpuTotalMs: round(cpuTotalMs),
      averageCpuCores: round(cpuTotalMs / elapsedMs),
      rssStartMiB: round(this.#rssStart / MIB),
      rssPeakMiB: round(this.#rssPeak / MIB),
      rssDeltaMiB: round(Math.max(0, this.#rssPeak - this.#rssStart) / MIB),
      heapPeakMiB: round(this.#heapPeak / MIB),
    }
  }

  #sample(): void {
    const memory = process.memoryUsage()
    this.#rssPeak = Math.max(this.#rssPeak, memory.rss)
    this.#heapPeak = Math.max(this.#heapPeak, memory.heapUsed)
  }
}

interface ProcessTreeSample {
  rssBytes: number
  cpu100ns: number
  processCount: number
}

export class ProcessTreeSampler {
  readonly #rootPid: number
  readonly #intervalMs: number
  readonly #samples: ProcessTreeSample[] = []
  #running = false
  #sampling?: Promise<void>
  #error?: string

  constructor(rootPid = process.pid, intervalMs = 1_000) {
    this.#rootPid = rootPid
    this.#intervalMs = intervalMs
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#sampling = this.#run()
  }

  async stop(): Promise<ProcessTreeSummary> {
    this.#running = false
    await this.#sampling
    if (process.platform === "win32") await this.#sampleWindows()
    if (!this.#samples.length) return { available: false, samples: 0, error: this.#error ?? "Process-tree sampling is unavailable." }
    const first = this.#samples[0]!
    const last = this.#samples.at(-1)!
    return {
      available: true,
      samples: this.#samples.length,
      peakProcessCount: Math.max(...this.#samples.map((sample) => sample.processCount)),
      peakRssMiB: round(Math.max(...this.#samples.map((sample) => sample.rssBytes)) / MIB),
      cpuTimeDeltaMs: round(Math.max(0, last.cpu100ns - first.cpu100ns) / 10_000),
    }
  }

  async #run(): Promise<void> {
    if (process.platform !== "win32") {
      this.#error = `Process-tree sampling is not implemented for ${process.platform}.`
      return
    }
    while (this.#running) {
      await this.#sampleWindows()
      if (this.#running) await Bun.sleep(this.#intervalMs)
    }
  }

  async #sampleWindows(): Promise<void> {
    const shell = Bun.which("pwsh") ?? Bun.which("powershell")
    if (!shell) {
      this.#error = "PowerShell is unavailable."
      return
    }
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$rootPid = ${this.#rootPid}`,
      "$selfPid = $PID",
      "$items = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, KernelModeTime, UserModeTime)",
      "$ids = [System.Collections.Generic.HashSet[int]]::new()",
      "$queue = [System.Collections.Generic.Queue[int]]::new()",
      "$null = $ids.Add($rootPid)",
      "$queue.Enqueue($rootPid)",
      "while ($queue.Count -gt 0) {",
      "  $parent = $queue.Dequeue()",
      "  foreach ($item in $items) {",
      "    $pidValue = [int]$item.ProcessId",
      "    if ([int]$item.ParentProcessId -eq $parent -and $pidValue -ne $selfPid -and $ids.Add($pidValue)) { $queue.Enqueue($pidValue) }",
      "  }",
      "}",
      "$selected = @($items | Where-Object { $ids.Contains([int]$_.ProcessId) })",
      "$rss = [double](($selected | Measure-Object -Property WorkingSetSize -Sum).Sum)",
      "$cpu = [double](($selected | ForEach-Object { [double]$_.KernelModeTime + [double]$_.UserModeTime } | Measure-Object -Sum).Sum)",
      "@{ rssBytes = $rss; cpu100ns = $cpu; processCount = $selected.Count } | ConvertTo-Json -Compress",
    ].join("\n")
    try {
      const child = Bun.spawn([shell, "-NoProfile", "-NonInteractive", "-Command", script], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      if (exitCode !== 0) throw new Error(stderr.trim() || `PowerShell exited with ${exitCode}.`)
      const sample = JSON.parse(stdout.trim()) as ProcessTreeSample
      if (![sample.rssBytes, sample.cpu100ns, sample.processCount].every(Number.isFinite)) throw new Error("Invalid process-tree sample.")
      this.#samples.push(sample)
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error)
    }
  }
}

export function summarize(values: readonly number[]): DistributionSummary {
  if (!values.length) return { samples: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, average: 0 }
  const sorted = values.toSorted((left, right) => left - right)
  return {
    samples: values.length,
    min: round(sorted[0]!),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.at(-1)!),
    average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  }
}

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  return sorted[Math.max(0, index)]!
}

export function round(value: number): number {
  return Math.round(value * 100) / 100
}
