import { stringify as stringifyToml } from "smol-toml"

const BARE_KEY = /^[a-z0-9_-]+$/i

export function stringifyXiraniteConfig(root: Record<string, unknown>): string {
  const nodes = isRecord(root.nodes) ? root.nodes : undefined
  const rawNeoview = nodes?.neoview
  if (!isRecord(rawNeoview)) return stringifyToml(root)

  const neoview = unwrapNeoviewEnvelope(rawNeoview)
  const otherNodes = Object.fromEntries(Object.entries(nodes ?? {}).filter(([key]) => key !== "neoview"))
  const rootWithoutNeoview = { ...root }
  if (Object.keys(otherNodes).length === 0) delete rootWithoutNeoview.nodes
  else rootWithoutNeoview.nodes = otherNodes

  const prefix = stringifyToml(rootWithoutNeoview).trimEnd()
  const neoviewText = stringifyNeoviewSections(neoview)
  return prefix.length > 0 ? `${prefix}\n\n${neoviewText}` : neoviewText
}

function stringifyNeoviewSections(config: Record<string, unknown>): string {
  const rootEntries: Array<[string, unknown]> = []
  const sections: Array<[string, Record<string, unknown>]> = []
  for (const [key, value] of Object.entries(config)) {
    if (value === null || value === undefined) continue
    if (isRecord(value)) sections.push([key, value])
    else rootEntries.push([key, value])
  }

  const blocks = [stringifySection("nodes.neoview", rootEntries)]
  for (const [key, value] of sections) {
    blocks.push(stringifySection(`nodes.neoview.${formatKey(key)}`, Object.entries(value)))
  }
  return `${blocks.join("\n\n")}\n`
}

function stringifySection(path: string, entries: Array<[string, unknown]>): string {
  const lines = [`[${path}]`]
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue
    lines.push(`${formatKey(key)} = ${stringifyInlineValue(value, 1000)}`)
  }
  return lines.join("\n")
}

function stringifyInlineValue(value: unknown, depth: number): string {
  if (depth === 0) throw new Error("Could not stringify NeoView config: maximum object depth exceeded")
  if (typeof value === "string") return formatString(value)
  if (typeof value === "boolean" || typeof value === "bigint") return value.toString()
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan"
    if (value === Infinity) return "inf"
    if (value === -Infinity) return "-inf"
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) return value.toFixed(1)
    return value.toString()
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError("cannot serialize invalid date")
    return value.toISOString()
  }
  if (Array.isArray(value)) {
    return `[ ${value.map((child) => {
      if (child === null || child === undefined) throw new TypeError("arrays cannot contain null or undefined values")
      return stringifyInlineValue(child, depth - 1)
    }).join(", ")} ]`
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, child]) => child !== null && child !== undefined)
    if (entries.length === 0) return "{}"
    return `{ ${entries.map(([key, child]) => `${formatKey(key)} = ${stringifyInlineValue(child, depth - 1)}`).join(", ")} }`
  }
  throw new TypeError(`cannot serialize values of type '${typeof value}'`)
}

function unwrapNeoviewEnvelope(node: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(node, "config")) return cloneRecord(node)
  if (!isRecord(node.config)) throw new Error("[nodes.neoview].config must be an object.")
  const legacy = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "config"))
  return deepMerge(legacy, node.config)
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = cloneRecord(base)
  for (const [key, value] of Object.entries(override)) {
    result[key] = isRecord(result[key]) && isRecord(value)
      ? deepMerge(result[key], value)
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

function formatKey(key: string): string {
  return BARE_KEY.test(key) ? key : formatString(key)
}

function formatString(value: string): string {
  return JSON.stringify(value).replace(/\x7f/g, "\\u007f")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
