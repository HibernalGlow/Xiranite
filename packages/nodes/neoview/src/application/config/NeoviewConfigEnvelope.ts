export const NEOVIEW_CONFIG_ENVELOPE_KEY = "config"

export function unwrapNeoviewConfigEnvelope(value: unknown): Record<string, unknown> {
  const node = requireRecord(value, "[nodes.neoview]")
  if (!Object.hasOwn(node, NEOVIEW_CONFIG_ENVELOPE_KEY)) return cloneRecord(node)

  const optimized = requireRecord(node[NEOVIEW_CONFIG_ENVELOPE_KEY], "[nodes.neoview].config")
  const legacy = Object.fromEntries(
    Object.entries(node).filter(([key]) => key !== NEOVIEW_CONFIG_ENVELOPE_KEY),
  )
  return deepMerge(legacy, optimized)
}

export function wrapNeoviewConfigEnvelope(config: Record<string, unknown>): Record<string, unknown> {
  return { [NEOVIEW_CONFIG_ENVELOPE_KEY]: cloneRecord(config) }
}

export function isOptimizedNeoviewConfigEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false
  return Object.keys(value).length === 1 && isRecord(value[NEOVIEW_CONFIG_ENVELOPE_KEY])
}

function deepMerge(current: Record<string, unknown>, canonical: Record<string, unknown>): Record<string, unknown> {
  const result = cloneRecord(current)
  for (const [key, value] of Object.entries(canonical)) {
    const previous = result[key]
    result[key] = isRecord(previous) && isRecord(value)
      ? deepMerge(previous, value)
      : cloneValue(value)
  }
  return result
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]))
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (isRecord(value)) return cloneRecord(value)
  return value
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
