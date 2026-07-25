export interface NodeProcessMemoryUsage {
  rssBytes: number
  heapUsedBytes: number
}

export interface NodeMemoryProtectionPolicy {
  maxRssGrowthBytes?: number
  maxHeapGrowthBytes?: number
  maxRetainedEvents?: number
  sampleIntervalMs?: number
}

export interface NodeMemoryProtectionOptions {
  defaultPolicy?: NodeMemoryProtectionPolicy
  nodePolicies?: Record<string, NodeMemoryProtectionPolicy>
  readMemoryUsage?: () => NodeProcessMemoryUsage
  now?: () => number
}

export interface ResolvedNodeMemoryProtectionPolicy {
  maxRssGrowthBytes?: number
  maxHeapGrowthBytes?: number
  maxRetainedEvents: number
  sampleIntervalMs: number
}

const DEFAULT_RETAINED_EVENTS = 1_000
const DEFAULT_SAMPLE_INTERVAL_MS = 250
const MIN_SAMPLE_INTERVAL_MS = 25
const MAX_RETAINED_EVENTS = 10_000
const MIB = 1024 * 1024

export function resolveNodeMemoryProtectionPolicy(
  options: NodeMemoryProtectionOptions | undefined,
  nodeId: string,
): ResolvedNodeMemoryProtectionPolicy {
  const policy = { ...options?.defaultPolicy, ...options?.nodePolicies?.[nodeId] }
  return {
    ...positiveBytes("maxRssGrowthBytes", policy.maxRssGrowthBytes),
    ...positiveBytes("maxHeapGrowthBytes", policy.maxHeapGrowthBytes),
    maxRetainedEvents: clampInteger(policy.maxRetainedEvents ?? DEFAULT_RETAINED_EVENTS, 1, MAX_RETAINED_EVENTS),
    sampleIntervalMs: clampInteger(policy.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS, MIN_SAMPLE_INTERVAL_MS, 60_000),
  }
}

export class NodeOperationMemoryGuard {
  readonly baseline?: NodeProcessMemoryUsage
  readonly policy: ResolvedNodeMemoryProtectionPolicy
  readonly nodeId: string
  peak?: NodeProcessMemoryUsage
  violation?: string

  private readonly readMemoryUsage?: () => NodeProcessMemoryUsage
  private readonly now: () => number
  private lastSampleAt = Number.NEGATIVE_INFINITY

  constructor(nodeId: string, policy: ResolvedNodeMemoryProtectionPolicy, options: NodeMemoryProtectionOptions | undefined) {
    this.nodeId = nodeId
    this.policy = policy
    this.readMemoryUsage = options?.readMemoryUsage
    this.now = options?.now ?? Date.now
    this.baseline = this.read()
    this.peak = this.baseline
  }

  sample(force = false): string | undefined {
    if (this.violation || !this.baseline || !this.readMemoryUsage) return this.violation
    const now = this.now()
    if (!force && now - this.lastSampleAt < this.policy.sampleIntervalMs) return undefined
    this.lastSampleAt = now
    const current = this.read()
    if (!current) return undefined
    this.peak = {
      rssBytes: Math.max(this.peak?.rssBytes ?? 0, current.rssBytes),
      heapUsedBytes: Math.max(this.peak?.heapUsedBytes ?? 0, current.heapUsedBytes),
    }

    const rssGrowth = Math.max(0, current.rssBytes - this.baseline.rssBytes)
    if (this.policy.maxRssGrowthBytes !== undefined && rssGrowth > this.policy.maxRssGrowthBytes) {
      this.violation = memoryViolationMessage(this.nodeId, "RSS", rssGrowth, this.policy.maxRssGrowthBytes, this.baseline.rssBytes, current.rssBytes)
      return this.violation
    }
    const heapGrowth = Math.max(0, current.heapUsedBytes - this.baseline.heapUsedBytes)
    if (this.policy.maxHeapGrowthBytes !== undefined && heapGrowth > this.policy.maxHeapGrowthBytes) {
      this.violation = memoryViolationMessage(this.nodeId, "heap", heapGrowth, this.policy.maxHeapGrowthBytes, this.baseline.heapUsedBytes, current.heapUsedBytes)
    }
    return this.violation
  }

  describe(): string {
    const limits = [
      this.policy.maxRssGrowthBytes === undefined ? undefined : `RSS growth ${formatMiB(this.policy.maxRssGrowthBytes)} MiB`,
      this.policy.maxHeapGrowthBytes === undefined ? undefined : `heap growth ${formatMiB(this.policy.maxHeapGrowthBytes)} MiB`,
      `retained events ${this.policy.maxRetainedEvents}`,
    ].filter(Boolean)
    const baseline = this.baseline ? `; baseline RSS ${formatMiB(this.baseline.rssBytes)} MiB, heap ${formatMiB(this.baseline.heapUsedBytes)} MiB` : "; process memory sampling unavailable"
    return `Memory guard: ${limits.join(", ")}${baseline}.`
  }

  private read(): NodeProcessMemoryUsage | undefined {
    if (!this.readMemoryUsage) return undefined
    try {
      const usage = this.readMemoryUsage()
      if (!Number.isFinite(usage.rssBytes) || !Number.isFinite(usage.heapUsedBytes)) return undefined
      return { rssBytes: Math.max(0, usage.rssBytes), heapUsedBytes: Math.max(0, usage.heapUsedBytes) }
    } catch {
      return undefined
    }
  }
}

function memoryViolationMessage(nodeId: string, metric: string, growth: number, limit: number, baseline: number, current: number): string {
  return `Memory protection stopped ${nodeId}: ${metric} growth ${formatMiB(growth)} MiB exceeded ${formatMiB(limit)} MiB (baseline ${formatMiB(baseline)} MiB, current ${formatMiB(current)} MiB).`
}

function positiveBytes<K extends "maxRssGrowthBytes" | "maxHeapGrowthBytes">(key: K, value: number | undefined): Partial<Record<K, number>> {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return {}
  return { [key]: Math.floor(value) } as Partial<Record<K, number>>
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function formatMiB(bytes: number): string {
  return (bytes / MIB).toFixed(1)
}
