import { parseToml } from "@xiranite/config"

export type NeoviewConfigFormat = "absent" | "optimized" | "legacy" | "mixed" | "invalid"

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
    return { format: "optimized", message: "NeoView uses the canonical inline config envelope." }
  }
  if (hasConfig) {
    return {
      format: "mixed",
      message: `NeoView mixes optimized config with legacy keys: ${legacyKeys.join(", ")}. Optimized values take precedence.`,
    }
  }
  return {
    format: "legacy",
    message: "NeoView still uses legacy nested tables. It remains readable and will be canonicalized on the next config write.",
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
