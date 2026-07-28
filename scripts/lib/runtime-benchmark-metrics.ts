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

export interface ProcessResourceSample {
  timestampMs: number
  rssBytes: number
  heapTotalBytes: number
  heapUsedBytes: number
  externalBytes: number
  arrayBuffersBytes: number
}

export interface ProcessTreeSummary {
  available: boolean
  samples: number
  peakProcessCount?: number
  peakRssMiB?: number
  endRssMiB?: number
  peakPrivateMiB?: number
  endPrivateMiB?: number
  cpuTimeDeltaMs?: number
  error?: string
}

export interface ProcessTreeSample {
  timestampMs: number
  rssBytes: number
  privateBytes: number
  cpu100ns: number
  processCount: number
  rootRssBytes: number
  rootPrivateBytes: number
}

export interface ProcessTreeSamplerOptions {
  /** Set to zero when the measured workload is guaranteed to remain in one process tree captured at start. */
  refreshTreeIntervalMs?: number
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
  readonly #samples: ProcessResourceSample[] = []
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
    this.#samples.length = 0
    this.#startedAt = performance.now()
    this.#cpuStart = process.cpuUsage()
    this.#sample()
    const first = this.#samples[0]!
    this.#rssStart = first.rssBytes
    this.#rssPeak = first.rssBytes
    this.#heapPeak = first.heapUsedBytes
    this.#timer = setInterval(() => this.#sample(), this.#intervalMs)
  }

  samples(): ProcessResourceSample[] {
    return this.#samples.map((sample) => ({ ...sample }))
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
    this.#samples.push({
      timestampMs: Date.now(),
      rssBytes: memory.rss,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
    })
  }
}

export class ProcessTreeSampler {
  readonly #rootPid: number
  readonly #intervalMs: number
  readonly #refreshTreeIntervalMs: number
  readonly #samples: ProcessTreeSample[] = []
  #running = false
  #sampling?: Promise<void>
  #samplerProcess?: ReturnType<typeof Bun.spawn>
  #error?: string

  constructor(rootPid = process.pid, intervalMs = 1_000, options: ProcessTreeSamplerOptions = {}) {
    this.#rootPid = rootPid
    this.#intervalMs = intervalMs
    this.#refreshTreeIntervalMs = Math.max(0, options.refreshTreeIntervalMs ?? 5_000)
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#sampling = this.#run()
  }

  samples(): ProcessTreeSample[] {
    return this.#samples.map((sample) => ({ ...sample }))
  }

  async waitForFirstSample(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!this.#samples.length && Date.now() < deadline) {
      if (this.#error) throw new Error(this.#error)
      await Bun.sleep(25)
    }
    if (!this.#samples.length) throw new Error(`Process-tree sampler did not produce a sample within ${timeoutMs} ms.`)
  }

  async stop(): Promise<ProcessTreeSummary> {
    this.#running = false
    this.#samplerProcess?.kill()
    await this.#sampling
    if (process.platform === "win32" && !this.#samples.length) await this.#sampleWindows()
    if (!this.#samples.length) return { available: false, samples: 0, error: this.#error ?? "Process-tree sampling is unavailable." }
    const first = this.#samples[0]!
    const last = this.#samples.at(-1)!
    return {
      available: true,
      samples: this.#samples.length,
      peakProcessCount: Math.max(...this.#samples.map((sample) => sample.processCount)),
      peakRssMiB: round(Math.max(...this.#samples.map((sample) => sample.rssBytes)) / MIB),
      endRssMiB: round(last.rssBytes / MIB),
      peakPrivateMiB: round(Math.max(...this.#samples.map((sample) => sample.privateBytes)) / MIB),
      endPrivateMiB: round(last.privateBytes / MIB),
      cpuTimeDeltaMs: round(Math.max(0, last.cpu100ns - first.cpu100ns) / 10_000),
    }
  }

  async #run(): Promise<void> {
    if (process.platform !== "win32") {
      this.#error = `Process-tree sampling is not implemented for ${process.platform}.`
      return
    }
    await this.#streamWindowsSamples()
  }

  async #streamWindowsSamples(): Promise<void> {
    const shell = Bun.which("pwsh") ?? Bun.which("powershell")
    if (!shell) {
      this.#error = "PowerShell is unavailable."
      return
    }
    const script = [
      ...this.#windowsSampleScript(),
      ...(this.#refreshTreeIntervalMs > 0 ? ["Update-XiraniteProcessTree"] : []),
      "$lastTreeRefresh = [Environment]::TickCount64",
      `while ($true) { $started = [Environment]::TickCount64; if (${this.#refreshTreeIntervalMs} -gt 0 -and $started - $lastTreeRefresh -ge ${this.#refreshTreeIntervalMs}) { Update-XiraniteProcessTree; $lastTreeRefresh = [Environment]::TickCount64 }; Write-XiraniteSample; $remaining = ${this.#intervalMs} - ([Environment]::TickCount64 - $started); if ($remaining -gt 0) { Start-Sleep -Milliseconds $remaining } }`,
    ].join("\n")
    const child = Bun.spawn([shell, "-NoProfile", "-NonInteractive", "-Command", script], {
      stdout: "pipe",
      stderr: "pipe",
    })
    this.#samplerProcess = child
    const stderrPromise = new Response(child.stderr).text()
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let buffered = ""
    try {
      for (;;) {
        const { value, done } = await reader.read()
        buffered += decoder.decode(value, { stream: !done })
        let newline = buffered.indexOf("\n")
        while (newline >= 0) {
          const line = buffered.slice(0, newline).trim()
          buffered = buffered.slice(newline + 1)
          if (line) this.#appendWindowsSample(line)
          newline = buffered.indexOf("\n")
        }
        if (done) break
      }
      if (buffered.trim()) this.#appendWindowsSample(buffered.trim())
    } catch (error) {
      if (this.#running) this.#error = error instanceof Error ? error.message : String(error)
    } finally {
      reader.releaseLock()
      const [exitCode, stderr] = await Promise.all([child.exited, stderrPromise])
      if (this.#running && exitCode !== 0) this.#error = stderr.trim() || `PowerShell sampler exited with ${exitCode}.`
      if (this.#samplerProcess === child) this.#samplerProcess = undefined
    }
  }

  #windowsSampleScript(): string[] {
    return [
      "$ErrorActionPreference = 'Stop'",
      `$rootPid = ${this.#rootPid}`,
      "$selfPid = $PID",
      "$trackedIds = @($rootPid)",
      "function Update-XiraniteProcessTree {",
      "  $items = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, PrivatePageCount, KernelModeTime, UserModeTime)",
      "  $ids = [System.Collections.Generic.HashSet[int]]::new()",
      "  $queue = [System.Collections.Generic.Queue[int]]::new()",
      "  $null = $ids.Add($rootPid)",
      "  $queue.Enqueue($rootPid)",
      "  while ($queue.Count -gt 0) {",
      "    $parent = $queue.Dequeue()",
      "    foreach ($item in $items) {",
      "      $pidValue = [int]$item.ProcessId",
      "      if ([int]$item.ParentProcessId -eq $parent -and $pidValue -ne $selfPid -and $ids.Add($pidValue)) { $queue.Enqueue($pidValue) }",
      "    }",
      "  }",
      "  $script:trackedIds = @($ids)",
      "}",
      "function Write-XiraniteSample {",
      "  $selected = @(foreach ($trackedId in $trackedIds) { Get-Process -Id $trackedId -ErrorAction SilentlyContinue })",
      "  $root = $selected | Where-Object { [int]$_.Id -eq $rootPid } | Select-Object -First 1",
      "  $rss = [double](($selected | Measure-Object -Property WorkingSet64 -Sum).Sum)",
      "  $private = [double](($selected | Measure-Object -Property PrivateMemorySize64 -Sum).Sum)",
      "  $cpu = [double](($selected | ForEach-Object { [double]$_.TotalProcessorTime.Ticks } | Measure-Object -Sum).Sum)",
      "  @{ timestampMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); rssBytes = $rss; privateBytes = $private; cpu100ns = $cpu; processCount = $selected.Count; rootRssBytes = [double]$root.WorkingSet64; rootPrivateBytes = [double]$root.PrivateMemorySize64 } | ConvertTo-Json -Compress",
      "}",
    ]
  }

  async #sampleWindows(): Promise<void> {
    const shell = Bun.which("pwsh") ?? Bun.which("powershell")
    if (!shell) {
      this.#error = "PowerShell is unavailable."
      return
    }
    const script = [...this.#windowsSampleScript(), "Update-XiraniteProcessTree", "Write-XiraniteSample"].join("\n")
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
      this.#appendWindowsSample(stdout.trim())
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error)
    }
  }

  #appendWindowsSample(serialized: string): void {
    const sample = JSON.parse(serialized) as ProcessTreeSample
    if (![sample.timestampMs, sample.rssBytes, sample.privateBytes, sample.cpu100ns, sample.processCount, sample.rootRssBytes, sample.rootPrivateBytes].every(Number.isFinite)) throw new Error("Invalid process-tree sample.")
    this.#samples.push(sample)
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
