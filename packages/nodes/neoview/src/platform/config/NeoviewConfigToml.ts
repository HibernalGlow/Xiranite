import { stringifyToml } from "@xiranite/config"

const BARE_KEY = /^[a-z0-9_-]+$/i

export function stringifyXiraniteConfigWithOptimizedNeoview(
  root: Record<string, unknown>,
  nodeConfig: Record<string, unknown>,
): string {
  const nodes = isRecord(root.nodes) ? root.nodes : {}
  const otherNodes = Object.fromEntries(Object.entries(nodes).filter(([key]) => key !== "neoview"))
  const rootWithoutNeoview = { ...root }

  if (Object.keys(otherNodes).length === 0) delete rootWithoutNeoview.nodes
  else rootWithoutNeoview.nodes = otherNodes

  const prefix = stringifyToml(rootWithoutNeoview).trimEnd()
  const neoview = `[nodes.neoview]\nconfig = ${stringifyInlineTable(nodeConfig)}\n`
  return prefix.length > 0 ? `${prefix}\n\n${neoview}` : neoview
}

function stringifyInlineTable(value: Record<string, unknown>, depth = 1000): string {
  if (depth === 0) throw new Error("Could not stringify NeoView config: maximum object depth exceeded")
  const entries = Object.entries(value).filter(([, child]) => child !== null && child !== undefined)
  if (entries.length === 0) return "{}"
  return `{ ${entries.map(([key, child]) => `${formatKey(key)} = ${stringifyValue(child, depth - 1)}`).join(", ")} }`
}

function stringifyValue(value: unknown, depth: number): string {
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
      return stringifyValue(child, depth - 1)
    }).join(", ")} ]`
  }
  if (isRecord(value)) return stringifyInlineTable(value, depth - 1)
  throw new TypeError(`cannot serialize values of type '${typeof value}'`)
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
