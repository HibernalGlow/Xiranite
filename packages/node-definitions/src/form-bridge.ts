/**
 * The form bridge: definition in, working form state out (ADR-0069).
 *
 * A node's `interaction.ts` used to carry behaviour: `visibleWhen(values)`, `validate(value, values)`,
 * `toInput(values)`, `isDangerous(input)`. Those closures cannot be shared with `clap` or `ratatui`, so the
 * definition declares them as data and this module is the interpreter: given a definition and the current
 * values it answers which fields show, what is wrong, what the plugin input document looks like, and
 * whether the run needs a confirmation.
 *
 * The point of putting the interpreter here rather than back into each face is the one the ADR is about:
 * this file, `xiranite-cli-runtime` and `xiranite-tui-runtime` implement the same rules over the same data,
 * so a node cannot behave differently depending on which face the user typed into.
 */

import type { DefinitionDocument } from "./contract.ts"

export type Values = Record<string, string | number | boolean>

export interface ResolvedField {
  id: string
  label: string
  description?: string
  kind: string
  placeholder?: string
  lines?: number
  min?: number
  max?: number
  step?: number
  options: Array<{ value: string | number | boolean, label: string, hint?: string, disabled: boolean }>
}

type Json = Record<string, unknown>

const asJson = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null

const text = (value: unknown, language: string): string => {
  const localized = asJson(value)
  if (!localized) return typeof value === "string" ? value : ""
  const chosen = language === "en" ? localized.en : localized.zh
  return typeof chosen === "string" ? chosen : ""
}

/** The `Scalar` of a definition value as a plain JS value. */
export function scalarValue(scalar: unknown): string | number | boolean {
  const record = asJson(scalar)
  if (!record) return ""
  const only = Object.values(record)[0]
  return typeof only === "string" || typeof only === "number" || typeof only === "boolean" ? only : ""
}

const truthy = (value: unknown): boolean =>
  value === true || (typeof value === "string" && value.trim() !== "") || (typeof value === "number" && !Number.isNaN(value))

function testHolds(test: Json, values: Values): boolean {
  const kind = test.type
  switch (kind) {
    case "always":
      return true
    // `never` states what a node means by `visibleWhen: () => false`; an empty compound would only imply it.
    case "never":
      return false
    case "actionIs": {
      const allowed = Array.isArray(test.allowed) ? test.allowed.map((item) => String(item)) : []
      return allowed.includes(String(values[String(test.actionField)] ?? ""))
    }
    case "fieldEquals":
      return String(values[String(test.fieldId)] ?? "") === String(scalarValue(test.value))
    case "fieldFilled":
      return truthy(values[String(test.fieldId)])
    case "fieldTrue":
      return values[String(test.fieldId)] === true
    case "numberAtLeast": {
      const value = Number(values[String(test.fieldId)])
      return Number.isFinite(value) && value >= Number(test.minimum)
    }
    default:
      // An unknown test must not silently read as "visible": fail closed and let the gate complain.
      return false
  }
}

/** Evaluate a flat condition (`single` / `all` / `any` / `anyAll`) against current values. */
export function conditionHolds(condition: unknown, values: Values): boolean {
  const record = asJson(condition)
  if (!record) return true
  switch (record.type) {
    case "single": {
      const predicate = asJson(record.predicate)
      if (!predicate) return true
      return Boolean(predicate.negated) !== testHolds(asJson(predicate.test) ?? {}, values)
    }
    case "all":
      return (Array.isArray(record.predicates) ? record.predicates : []).every((predicate) => conditionHolds({ type: "single", predicate }, values))
    case "any":
      return (Array.isArray(record.predicates) ? record.predicates : []).some((predicate) => conditionHolds({ type: "single", predicate }, values))
    case "anyAll": {
      const clauses = Array.isArray(record.clauses) ? record.clauses : []
      return clauses.some((clause) => (Array.isArray(clause) ? clause : []).every((predicate) => conditionHolds({ type: "single", predicate }, values)))
    }
    default:
      return true
  }
}

/** A field is shown when its declared condition holds; absent means always shown. */
export function fieldIsVisible(definition: DefinitionDocument, field: Json, values: Values): boolean {
  void definition
  return conditionHolds(field.visible ?? { type: "always" }, values)
}

/** The fields a face should draw right now, with the localized copy for `language`. */
export function visibleFields(definition: DefinitionDocument, values: Values, language = "zh"): ResolvedField[] {
  return (definition.fields as Json[])
    .filter((field) => fieldIsVisible(definition, field, values))
    .map((field) => ({
      id: String(field.id),
      label: text(field.label, language),
      description: field.description ? text(field.description, language) : undefined,
      kind: String(field.kind),
      placeholder: field.placeholder ? text(field.placeholder, language) : undefined,
      lines: typeof field.lines === "number" ? field.lines : undefined,
      min: asJson(field.range)?.min as number | undefined,
      max: asJson(field.range)?.max as number | undefined,
      step: asJson(field.range)?.step as number | undefined,
      options: (Array.isArray(field.options) ? field.options : []).map((option: Json) => ({
        value: scalarValue(option.value),
        label: text(option.label, language),
        hint: option.hint ? text(option.hint, language) : undefined,
        disabled: option.disabled === true,
      })),
    }))
}

/** Values a face starts from: the authored defaults, keyed by field id. */
export function defaultValues(definition: DefinitionDocument): Values {
  const values: Values = {}
  for (const field of definition.fields as Json[]) {
    if (field.default !== undefined && field.default !== null) values[String(field.id)] = scalarValue(field.default)
  }
  return values
}

/**
 * Check the declared rules and return the node's own message for the first failure.
 *
 * `custom` rules are node logic and live in the plugin, so the faces cannot evaluate them locally; they are
 * reported through `deferredRules` so a face knows to ask the plugin instead of guessing.
 */
export function validateValues(
  definition: DefinitionDocument,
  values: Values,
  language = "zh",
): { problems: string[], deferredRules: string[] } {
  const problems: string[] = []
  const deferredRules: string[] = []
  for (const field of definition.fields as Json[]) {
    const id = String(field.id)
    const value = values[id]
    for (const item of (Array.isArray(field.rules) ? field.rules : []) as Json[]) {
      const rule = asJson(item.rule) ?? item
      const when = item.when
      if (when && !conditionHolds(when, values)) continue
      // Nodes author their own failure copy. Where one did not, the report stays machine-readable instead
      // of inventing prose the node never wrote.
      const message = item.message ? text(item.message, language) : `${id}:rule:${String(rule.type)}`
      switch (rule.type) {
        case "required":
          if (!truthy(value)) problems.push(message)
          break
        case "nonBlank":
          if (typeof value === "string" && value.trim() === "") problems.push(message)
          break
        case "integerAtLeast": {
          const numeric = Number(value)
          const minimum = Number(rule.minimum)
          if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < minimum) problems.push(message)
          break
        }
        case "numberAtLeast": {
          const numeric = Number(value)
          if (!Number.isFinite(numeric) || numeric < Number(rule.minimum)) problems.push(message)
          break
        }
        case "integerInRange":
        case "numberInRange": {
          const numeric = Number(value)
          const range = asJson(field.range)
          const min = typeof range?.min === "number" ? range.min : Number.NEGATIVE_INFINITY
          const max = typeof range?.max === "number" ? range.max : Number.POSITIVE_INFINITY
          if (!Number.isFinite(numeric) || numeric < min || numeric > max) problems.push(message)
          else if (rule.type === "integerInRange" && !Number.isInteger(numeric)) problems.push(message)
          break
        }
        case "oneOfDeclaredOptions": {
          const allowed = (Array.isArray(field.options) ? field.options : []).map((option: Json) => String(scalarValue(option.value)))
          if (!allowed.includes(String(value))) problems.push(message)
          break
        }
        case "atLeastLines": {
          const lines = String(value ?? "").split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean)
          if (lines.length < Number(rule.minimum ?? 1)) problems.push(message)
          break
        }
        case "custom":
          if (typeof rule.exportName === "string") deferredRules.push(rule.exportName)
          break
      }
    }
  }
  return { problems, deferredRules }
}

/** Build the plugin input document exactly as the node's old `toInput` did. */
export function buildInput(definition: DefinitionDocument, values: Values): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const binding of (Array.isArray(definition.inputBindings) ? definition.inputBindings : []) as Json[]) {
    const fieldId = String(binding.fieldId)
    const slot = String(binding.slot)
    const raw = values[fieldId]
    if (raw === undefined) continue
    switch (binding.transform) {
      case "trim":
        input[slot] = String(raw).trim()
        break
      case "trimOrOmit": {
        const trimmed = String(raw).trim()
        if (trimmed !== "") input[slot] = trimmed
        break
      }
      case "lines":
        input[slot] = String(raw).split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean)
        break
      case "delimited":
        input[slot] = String(raw).split(/[,;\r\n]+/).map((part) => part.trim()).filter(Boolean)
        break
      case "asInteger":
        input[slot] = Math.trunc(Number(raw))
        break
      case "asBoolean":
        input[slot] = raw === true || String(raw) === "true" || raw === 1
        break
      default:
        input[slot] = raw
    }
  }
  return input
}

/** Whether the run needs confirming, and the authored prompt when it is static. */
export function dangerState(
  definition: DefinitionDocument,
  values: Values,
  language = "zh",
): { dangerous: boolean, prompt?: { title: string, body: string, confirmLabel: string }, exportName?: string } {
  const gate = asJson(definition.danger) ?? { type: "none" }
  const prompt = asJson(definition.dangerPrompt)
  const resolvedPrompt = prompt
    ? { title: text(prompt.title, language), body: text(prompt.body, language), confirmLabel: text(prompt.confirmLabel ?? prompt.confirm_label, language) }
    : undefined
  switch (gate.type) {
    case "none":
      return { dangerous: false, prompt: resolvedPrompt }
    case "actionIn": {
      const selected = String(values[String(gate.actionField)] ?? "")
      const dangerous = (Array.isArray(gate.dangerous) ? gate.dangerous : []).map(String)
      return { dangerous: dangerous.includes(selected), prompt: resolvedPrompt }
    }
    case "fieldFlag": {
      const set = values[String(gate.fieldId)] === true
      return { dangerous: gate.inverted === true ? !set : set, prompt: resolvedPrompt }
    }
    case "all":
    case "any":
      return {
        dangerous: conditionHolds({ type: gate.type, predicates: gate.predicates ?? [] }, values),
        prompt: resolvedPrompt,
      }
    case "pluginExport":
      return { dangerous: false, exportName: String(gate.exportName ?? "") }
    default:
      return { dangerous: false }
  }
}
