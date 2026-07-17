import { z } from "zod"

export const READER_SETTINGS_EXPORT_FORMAT = "Xiranite/NeoViewConfig" as const
export const READER_SETTINGS_EXPORT_VERSION = 1 as const

export interface ReaderSettingsPortablePayload {
  format: typeof READER_SETTINGS_EXPORT_FORMAT
  version: typeof READER_SETTINGS_EXPORT_VERSION
  exportedAt: number
  nodeConfig: Record<string, unknown>
  omittedSensitivePaths: string[]
}

const PortablePayloadSchema = z.object({
  format: z.literal(READER_SETTINGS_EXPORT_FORMAT),
  version: z.literal(READER_SETTINGS_EXPORT_VERSION),
  exportedAt: z.number().int().nonnegative(),
  nodeConfig: z.record(z.string(), z.unknown()),
  omittedSensitivePaths: z.array(z.string()).max(256),
}).strict()

const SENSITIVE_KEY = /(?:password|passwd|token|secret|credential|api[_-]?key|authorization)/i
const MAX_DEPTH = 32
const MAX_NODES = 100_000

export class ReaderSettingsPortableCodec {
  encode(nodeConfig: Record<string, unknown>, exportedAt = Date.now()): ReaderSettingsPortablePayload {
    if (!Number.isSafeInteger(exportedAt) || exportedAt < 0) throw new TypeError("exportedAt must be a non-negative safe integer")
    const omittedSensitivePaths: string[] = []
    const state = { nodes: 0 }
    const sanitized = sanitizeRecord(nodeConfig, "", omittedSensitivePaths, state, 0)
    return PortablePayloadSchema.parse({
      format: READER_SETTINGS_EXPORT_FORMAT,
      version: READER_SETTINGS_EXPORT_VERSION,
      exportedAt,
      nodeConfig: sanitized,
      omittedSensitivePaths,
    })
  }

  decode(input: string | unknown): ReaderSettingsPortablePayload {
    const parsed = typeof input === "string" ? JSON.parse(input) : input
    const payload = PortablePayloadSchema.parse(parsed)
    const omittedSensitivePaths: string[] = []
    const nodeConfig = sanitizeRecord(payload.nodeConfig, "", omittedSensitivePaths, { nodes: 0 }, 0)
    if (omittedSensitivePaths.length) {
      throw new Error(`Portable NeoView settings contain sensitive fields: ${omittedSensitivePaths.join(", ")}`)
    }
    return { ...payload, nodeConfig }
  }
}

function sanitizeRecord(
  value: Record<string, unknown>,
  path: string,
  omitted: string[],
  state: { nodes: number },
  depth: number,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key
    if (SENSITIVE_KEY.test(key)) {
      if (omitted.length >= 256) throw new Error("Portable NeoView settings contain too many sensitive fields.")
      omitted.push(childPath)
      return []
    }
    return [[key, sanitizeValue(child, childPath, omitted, state, depth + 1)]]
  }))
}

function sanitizeValue(
  value: unknown,
  path: string,
  omitted: string[],
  state: { nodes: number },
  depth: number,
): unknown {
  state.nodes += 1
  if (state.nodes > MAX_NODES) throw new Error(`Portable NeoView settings exceed ${MAX_NODES} values.`)
  if (depth > MAX_DEPTH) throw new Error(`Portable NeoView settings exceed ${MAX_DEPTH} nesting levels.`)
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((child, index) => sanitizeValue(child, `${path}[${index}]`, omitted, state, depth + 1))
  if (isRecord(value)) return sanitizeRecord(value, path, omitted, state, depth)
  throw new Error(`Portable NeoView settings contain a non-JSON value at ${path}.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
