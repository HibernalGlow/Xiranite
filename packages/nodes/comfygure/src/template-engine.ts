import { Liquid, TokenKind } from "liquidjs"
import type { ComfygureTemplatePart, ComfygureVisualTemplate } from "./contracts.js"
import { sanitizeOutputSegment } from "./program-normalization.js"

const COMFYGURE_LIQUID = new Liquid({
  strictFilters: true,
  strictVariables: true,
  lenientIf: true,
  ownPropertyOnly: true,
  templates: {},
  parseLimit: 32_768,
  renderLimit: 250,
  memoryLimit: 1_000_000,
})

COMFYGURE_LIQUID.registerFilter("pad", (value: unknown, width: unknown = 2) => String(value ?? "").padStart(Math.max(0, Math.min(32, Number(width) || 0)), "0"))
COMFYGURE_LIQUID.registerFilter("stem", (value: unknown) => pathStem(String(value ?? "")))
COMFYGURE_LIQUID.registerFilter("safe_segment", (value: unknown) => safeOutputSegment(String(value ?? "")))

export function parseComfygureVisualTemplate(source: string): ComfygureVisualTemplate {
  try {
    const templates = COMFYGURE_LIQUID.parse(source)
    const parts: ComfygureTemplatePart[] = []
    for (const template of templates) {
      const token = template.token
      if (token.kind === TokenKind.HTML) {
        const value = token.input.slice(token.begin, token.end)
        if (value) parts.push({ kind: "text", value })
        continue
      }
      if (token.kind === TokenKind.Output) {
        const content = (token as typeof token & { content?: string }).content?.trim()
        if (!content) return { supported: false, parts: [], error: "Liquid output is empty." }
        parts.push({ kind: "variable", value: content })
        continue
      }
      return { supported: false, parts: [], error: "Liquid control-flow tags are available in source mode only." }
    }
    return { supported: true, parts }
  } catch (error) {
    return { supported: false, parts: [], error: error instanceof Error ? error.message : String(error) }
  }
}
export function serializeComfygureVisualTemplate(parts: readonly ComfygureTemplatePart[]): string {
  return parts.map((part) => part.kind === "variable" ? `{{ ${part.value.trim()} }}` : part.value).join("")
}
export function renderComfygureLiquid(scope: string, template: string, context: Record<string, unknown>): string {
  try {
    return String(COMFYGURE_LIQUID.parseAndRenderSync(template, context)).trim()
  } catch (error) {
    throw new Error(`Invalid Comfygure ${scope} template: ${error instanceof Error ? error.message : String(error)}`)
  }
}
export function safeOutputSegment(value: string): string {
  return sanitizeOutputSegment(value.trim()) || "untitled"
}
export function pathBasename(value: string): string {
  return value.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? ""
}
export function pathStem(value: string): string {
  const name = pathBasename(value)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(0, dot) : name
}
