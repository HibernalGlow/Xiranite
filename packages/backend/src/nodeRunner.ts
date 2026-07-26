import { runNodeWithEvents } from "@xiranite/runtime/node-runner"
import type { NodeMemoryProtectionOptions, NodeOperationContext, NodeOperationControl, NodeRunner } from "@xiranite/services"
import {
  DEFAULT_NODE_MEMORY_PROTECTION_SETTINGS,
  type NodeMemoryProtectionPolicySettingsDTO,
  type NodeMemoryProtectionSettingsDTO,
  type NodeRunEventDTO,
  type NodeRunResultDTO,
} from "@xiranite/shared"

import type { BackendFileOperationManager } from "./fileOperations.js"

export interface BackendNodeRunnerOptions {
  fileOperations?: BackendFileOperationManager
}

const MIB = 1024 * 1024

export function createBackendNodeMemoryProtection(env: Record<string, string | undefined> = process.env): NodeMemoryProtectionOptions {
  return createBackendNodeMemoryProtectionController(env).options
}

export interface BackendNodeMemoryProtectionController {
  options: NodeMemoryProtectionOptions
  getSettings(): NodeMemoryProtectionSettingsDTO
  applySettings(value: unknown): NodeMemoryProtectionSettingsDTO
}

export function createBackendNodeMemoryProtectionController(
  env: Record<string, string | undefined> = process.env,
  existingOptions?: NodeMemoryProtectionOptions,
): BackendNodeMemoryProtectionController {
  const environmentDefaults = settingsFromEnvironment(env)
  const options: NodeMemoryProtectionOptions = existingOptions ?? {
    readMemoryUsage: () => {
      const usage = process.memoryUsage()
      return { rssBytes: usage.rss, heapUsedBytes: usage.heapUsed }
    },
  }
  let settings = settingsFromOptions(options, environmentDefaults)
  applySettingsToOptions(options, settings)

  return {
    options,
    getSettings: () => cloneSettings(settings),
    applySettings(value) {
      settings = resolveSettings(value, environmentDefaults)
      applySettingsToOptions(options, settings)
      return cloneSettings(settings)
    },
  }
}

function settingsFromEnvironment(env: Record<string, string | undefined>): NodeMemoryProtectionSettingsDTO {
  const defaults = DEFAULT_NODE_MEMORY_PROTECTION_SETTINGS
  return {
    defaultPolicy: {
      maxRssGrowthMiB: positiveInteger(env.XIRANITE_NODE_MAX_RSS_GROWTH_MIB, defaults.defaultPolicy.maxRssGrowthMiB, 65_536),
      maxHeapGrowthMiB: positiveInteger(env.XIRANITE_NODE_MAX_HEAP_GROWTH_MIB, defaults.defaultPolicy.maxHeapGrowthMiB, 32_768),
      maxRetainedEvents: positiveInteger(env.XIRANITE_NODE_MAX_RETAINED_EVENTS, defaults.defaultPolicy.maxRetainedEvents, 10_000),
      sampleIntervalMs: positiveInteger(env.XIRANITE_NODE_MEMORY_SAMPLE_INTERVAL_MS, defaults.defaultPolicy.sampleIntervalMs, 60_000, 25),
    },
    nodePolicies: {
      xlchemy: {
        maxRssGrowthMiB: positiveInteger(env.XIRANITE_XLCHEMY_MAX_RSS_GROWTH_MIB, defaults.nodePolicies.xlchemy!.maxRssGrowthMiB, 65_536),
        maxHeapGrowthMiB: positiveInteger(env.XIRANITE_XLCHEMY_MAX_HEAP_GROWTH_MIB, defaults.nodePolicies.xlchemy!.maxHeapGrowthMiB, 32_768),
        maxRetainedEvents: positiveInteger(env.XIRANITE_XLCHEMY_MAX_RETAINED_EVENTS, defaults.nodePolicies.xlchemy!.maxRetainedEvents, 10_000),
        sampleIntervalMs: positiveInteger(env.XIRANITE_XLCHEMY_MEMORY_SAMPLE_INTERVAL_MS, defaults.nodePolicies.xlchemy!.sampleIntervalMs, 60_000, 25),
      },
    },
  }
}

function settingsFromOptions(options: NodeMemoryProtectionOptions, fallback: NodeMemoryProtectionSettingsDTO): NodeMemoryProtectionSettingsDTO {
  const nodeIds = new Set([...Object.keys(fallback.nodePolicies), ...Object.keys(options.nodePolicies ?? {})])
  return {
    defaultPolicy: policyFromOptions(options.defaultPolicy, fallback.defaultPolicy),
    nodePolicies: Object.fromEntries([...nodeIds].map((nodeId) => [
      nodeId,
      policyFromOptions(options.nodePolicies?.[nodeId], fallback.nodePolicies[nodeId] ?? fallback.defaultPolicy),
    ])),
  }
}

function policyFromOptions(
  policy: NodeMemoryProtectionOptions["defaultPolicy"],
  fallback: NodeMemoryProtectionPolicySettingsDTO,
): NodeMemoryProtectionPolicySettingsDTO {
  return {
    maxRssGrowthMiB: bytesToMiB(policy?.maxRssGrowthBytes, fallback.maxRssGrowthMiB, 65_536),
    maxHeapGrowthMiB: bytesToMiB(policy?.maxHeapGrowthBytes, fallback.maxHeapGrowthMiB, 32_768),
    maxRetainedEvents: boundedInteger(policy?.maxRetainedEvents, fallback.maxRetainedEvents, 1, 10_000),
    sampleIntervalMs: boundedInteger(policy?.sampleIntervalMs, fallback.sampleIntervalMs, 25, 60_000),
  }
}

function resolveSettings(value: unknown, fallback: NodeMemoryProtectionSettingsDTO): NodeMemoryProtectionSettingsDTO {
  if (!isRecord(value)) return cloneSettings(fallback)
  const defaultPolicy = resolvePolicySettings(value.defaultPolicy, fallback.defaultPolicy)
  const nodePolicies: Record<string, NodeMemoryProtectionPolicySettingsDTO> = {}
  const rawNodePolicies = isRecord(value.nodePolicies) ? value.nodePolicies : {}
  const nodeIds = new Set([...Object.keys(fallback.nodePolicies), ...Object.keys(rawNodePolicies)])
  for (const nodeId of nodeIds) {
    if (!nodeId || nodeId === "__proto__" || nodeId === "prototype" || nodeId === "constructor") continue
    nodePolicies[nodeId] = resolvePolicySettings(rawNodePolicies[nodeId], fallback.nodePolicies[nodeId] ?? defaultPolicy)
  }
  return { defaultPolicy, nodePolicies }
}

function resolvePolicySettings(value: unknown, fallback: NodeMemoryProtectionPolicySettingsDTO): NodeMemoryProtectionPolicySettingsDTO {
  const policy = isRecord(value) ? value : {}
  return {
    maxRssGrowthMiB: boundedInteger(policy.maxRssGrowthMiB, fallback.maxRssGrowthMiB, 1, 65_536),
    maxHeapGrowthMiB: boundedInteger(policy.maxHeapGrowthMiB, fallback.maxHeapGrowthMiB, 1, 32_768),
    maxRetainedEvents: boundedInteger(policy.maxRetainedEvents, fallback.maxRetainedEvents, 1, 10_000),
    sampleIntervalMs: boundedInteger(policy.sampleIntervalMs, fallback.sampleIntervalMs, 25, 60_000),
  }
}

function applySettingsToOptions(options: NodeMemoryProtectionOptions, settings: NodeMemoryProtectionSettingsDTO): void {
  options.defaultPolicy = policyToOptions(settings.defaultPolicy)
  options.nodePolicies = Object.fromEntries(Object.entries(settings.nodePolicies).map(([nodeId, policy]) => [nodeId, policyToOptions(policy)]))
}

function policyToOptions(policy: NodeMemoryProtectionPolicySettingsDTO) {
  return {
    maxRssGrowthBytes: policy.maxRssGrowthMiB * MIB,
    maxHeapGrowthBytes: policy.maxHeapGrowthMiB * MIB,
    maxRetainedEvents: policy.maxRetainedEvents,
    sampleIntervalMs: policy.sampleIntervalMs,
  }
}

function cloneSettings(settings: NodeMemoryProtectionSettingsDTO): NodeMemoryProtectionSettingsDTO {
  return {
    defaultPolicy: { ...settings.defaultPolicy },
    nodePolicies: Object.fromEntries(Object.entries(settings.nodePolicies).map(([nodeId, policy]) => [nodeId, { ...policy }])),
  }
}

function bytesToMiB(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return boundedInteger(Math.ceil(value / MIB), fallback, 1, maximum)
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number, minimum = 1): number {
  return boundedInteger(value === undefined ? fallback : Number(value), fallback, minimum, maximum)
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function createBackendNodeRunner(options: BackendNodeRunnerOptions = {}): NodeRunner {
  return {
    async runNode<TInput = unknown, TData = unknown>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEventDTO) => void, control?: NodeOperationControl, context: NodeOperationContext = {}) {
      return await runNodeWithEvents(nodeId, input, onEvent, control, {
        nodeId,
        componentId: context.componentId,
        workspaceId: context.workspaceId,
        fileOperations: options.fileOperations?.scoped({ nodeId, ...context }),
      }) as NodeRunResultDTO<TData>
    },
  }
}
