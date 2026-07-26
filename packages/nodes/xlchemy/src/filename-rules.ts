import type { XlchemyFormat, XlchemyInput, XlchemyOutputMode } from "./core.js"

export type XlchemyFilenameMatchTarget = "filename" | "path"
export type XlchemyFilenameMatcher = "contains" | "glob" | "regex"

export interface XlchemyFilenameRule {
  id: string
  enabled: boolean
  inputExtensions: string[]
  outputFormats: XlchemyFormat[]
  outputModes: XlchemyOutputMode[]
  matchTarget: XlchemyFilenameMatchTarget
  matcher: XlchemyFilenameMatcher
  pattern: string
  prefix: string
  suffix: string
}

export const DEFAULT_FILENAME_RULES: XlchemyFilenameRule[] = [
  { id: "builtin-psd", enabled: true, inputExtensions: ["psd", "psb"], outputFormats: [], outputModes: [], matchTarget: "filename", matcher: "glob", pattern: "*", prefix: "", suffix: "[PSD]" },
  { id: "builtin-clip", enabled: true, inputExtensions: ["clip"], outputFormats: [], outputModes: [], matchTarget: "filename", matcher: "glob", pattern: "*", prefix: "", suffix: "[CLIP]" },
  { id: "builtin-dynar", enabled: true, inputExtensions: [], outputFormats: ["dynar"], outputModes: [], matchTarget: "filename", matcher: "regex", pattern: "^(?!\\[#dyna\\])", prefix: "[#dyna]", suffix: ".wbp" },
]

export function normalizeFilenameRule(rule: XlchemyFilenameRule): XlchemyFilenameRule {
  const extensions = rule.inputExtensions.map((value) => value.trim().replace(/^\./, "").toLowerCase()).filter(Boolean)
  const normalized = { ...rule, id: rule.id || `rule-${Math.random().toString(36).slice(2)}`, enabled: rule.enabled !== false, inputExtensions: [...new Set(extensions)], outputFormats: [...new Set(rule.outputFormats)], outputModes: [...new Set(rule.outputModes)], matchTarget: rule.matchTarget ?? "filename", matcher: rule.matcher ?? "glob", pattern: rule.pattern ?? "*", prefix: rule.prefix ?? "", suffix: rule.suffix ?? "" }
  // Upgrade the prior built-in rule without changing separately named custom rules.
  return normalized.id === "builtin-dynar" && normalized.prefix === "[#dyna]" && normalized.suffix === "" && normalized.outputFormats.length === 1 && normalized.outputFormats[0] === "dynar"
    ? { ...normalized, suffix: ".wbp" }
    : normalized
}

export function applyFilenameRules(stem: string, sourcePath: string, sourceExtension: string, input: Pick<XlchemyInput, "filenameRules" | "format" | "outputMode">): string {
  const extension = sourceExtension.replace(/^\./, "").toLowerCase()
  const filename = sourcePath.replace(/\\/g, "/").split("/").at(-1) ?? sourcePath
  const matching = (input.filenameRules ?? DEFAULT_FILENAME_RULES).filter((rule) => {
    if (!rule.enabled) return false
    if (rule.inputExtensions.length && !rule.inputExtensions.includes(extension)) return false
    if (rule.outputFormats.length && !rule.outputFormats.includes(input.format)) return false
    if (rule.outputModes.length && !rule.outputModes.includes(input.outputMode)) return false
    const value = rule.matchTarget === "path" ? sourcePath : filename
    return matchesFilenameRule(value, rule)
  })
  return `${matching.map((rule) => rule.prefix).join("")}${stem}${matching.map((rule) => rule.suffix).join("")}`
}

function matchesFilenameRule(value: string, rule: XlchemyFilenameRule): boolean {
  if (!rule.pattern || rule.pattern === "*") return true
  if (rule.matcher === "contains") return value.toLowerCase().includes(rule.pattern.toLowerCase())
  try {
    if (rule.matcher === "regex") return new RegExp(rule.pattern, "i").test(value)
    const escaped = rule.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
    return new RegExp(`^${escaped}$`, "i").test(value)
  } catch { return false }
}
