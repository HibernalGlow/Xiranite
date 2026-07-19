import { parseToml } from "@xiranite/config"

export type NeoviewConfigFormat = "absent" | "optimized" | "envelope" | "legacy" | "mixed" | "invalid"

export interface NeoviewConfigFormatReport {
  format: NeoviewConfigFormat
  message: string
}

export function inspectNeoviewConfigFormat(text: string): NeoviewConfigFormatReport {
  let root: unknown
  try {
    root = parseToml(text)
  } catch (error) {
    return { format: "invalid", message: `TOML cannot be parsed: ${errorMessage(error)}` }
  }
  if (!isRecord(root) || !isRecord(root.nodes) || !Object.hasOwn(root.nodes, "neoview")) {
    return { format: "absent", message: "No [nodes.neoview] configuration is present." }
  }
  const node = root.nodes.neoview
  if (!isRecord(node)) return { format: "invalid", message: "[nodes.neoview] must be a table." }

  const hasConfig = Object.hasOwn(node, "config")
  if (hasConfig && !isRecord(node.config)) {
    return { format: "invalid", message: "[nodes.neoview].config must be an inline table/object." }
  }
  const legacyKeys = Object.keys(node).filter((key) => key !== "config")
  if (hasConfig && legacyKeys.length === 0) {
    return { format: "envelope", message: "NeoView uses the compatible all-in-one config envelope and should be migrated to first-level sections." }
  }
  if (hasConfig) {
    return {
      format: "mixed",
      message: `NeoView mixes optimized config with legacy keys: ${legacyKeys.join(", ")}. Optimized values take precedence.`,
    }
  }
  if (hasDeepNeoviewHeaders(text)) return {
    format: "legacy",
    message: "NeoView uses deep nested tables. It remains readable and will be compacted on the next config write.",
  }
  if (hasCollapsedNeoviewCollections(text)) return {
    format: "legacy",
    message: "NeoView collapses related objects into a single long line. It will be split into second-level groups on the next config write.",
  }
  return { format: "optimized", message: "NeoView uses readable second-level groups with one related object per inline row." }
}

function hasDeepNeoviewHeaders(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    const match = /^\[(\[?)(nodes\.neoview(?:\..+)?)\]\]?$/.exec(trimmed)
    if (!match || match[2] === "nodes.neoview") continue
    if (match[1] === "[") return true
    const tail = match[2].slice("nodes.neoview.".length)
    if (tail.split(".").length > 2) return true
  }
  return false
}

function hasCollapsedNeoviewCollections(text: string): boolean {
  let sectionDepth = -1
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    const header = /^\[(\[?)(nodes\.neoview(?:\..+)?)\]\]?$/.exec(trimmed)
    if (header) {
      const path = header[2]
      sectionDepth = path === "nodes.neoview" ? 0 : path.slice("nodes.neoview.".length).split(".").length
      continue
    }
    if (sectionDepth <= 1 && /^[^#=]+\s*=\s*\{/.test(trimmed)) return true
    if (sectionDepth <= 1 && /^[^#=]+\s*=\s*\[\s*\{/.test(trimmed)) return true
  }
  return false
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
