/**
 * The gate grammar both sides of `audit:node-interaction-parity` are measured in (ADR-0069).
 *
 * A node's `isDangerous` closure and a definition's `DangerGate` are the same claim in two notations, so each
 * is reduced here into disjunctive normal form over five leaves — `oneOf`/`truthy`/`filled`/`atLeast` — and
 * compared by structure. The semantics are `crates/xiranite-cli-runtime/src/plan.rs::danger_required`'s, not
 * an invention: `actionIs(f, allowed)` is "the value of f is in allowed", so a closure's `f === "x"` is the
 * same leaf with a one-element set, and `fieldTrue(f)` is `truthy(f)` with the predicate's `negated` flag as
 * the polarity. `DangerGate::{None,ActionIn,FieldFlag,All,Any}` map onto `never`, one clause, one clause, one
 * conjunction and a disjunction of singletons.
 *
 * A gate that cannot be expressed this way is refused with a reason, never approximated: that is what keeps
 * the parity gate from reporting a match it did not prove.
 */
// ------------------------------------------------------------------ gate grammar

/** One leaf of the gate grammar, in field-id space. `oneOf` folds `actionIs` and a `===` against a literal. */
export type GateLiteral =
  | { kind: "oneOf"; field: string; values: string[]; negated: boolean }
  | { kind: "truthy"; field: string; negated: boolean }
  | { kind: "filled"; field: string; negated: boolean }
  | { kind: "atLeast"; field: string; minimum: number; negated: boolean }

/** A conjunction. The empty clause is `always`. */
export type GateClause = GateLiteral[]

/** Disjunctive normal form: an OR of conjunctions. The empty form is `never`. */
export type GateForm = GateClause[]

export type Reduction = { ok: true; form: GateForm } | { ok: false; reason: string; at: string }

export const fail = (reason: string, at: string): Reduction => ({ ok: false, reason, at })
export const formed = (form: GateForm): Reduction => ({ ok: true, form })
/** One leaf is one clause holding one literal — the nesting that makes `all`/`any` compose. */
export const leaf = (literal: GateLiteral): Reduction => formed([[literal]])

const literalKey = (literal: GateLiteral): string => {
  if (literal.kind === "oneOf") return `oneOf:${literal.field}:${literal.negated ? "!" : ""}[${[...literal.values].sort().join(",")}]`
  if (literal.kind === "atLeast") return `atLeast:${literal.field}:${literal.negated ? "!" : ""}:${literal.minimum}`
  return `${literal.kind}:${literal.field}:${literal.negated ? "!" : ""}`
}

const clauseKey = (clause: GateClause): string => [...clause].map(literalKey).sort().join("&")

/** Order-insensitive identity of a gate, which is what makes the two sides comparable at all. */
export const formKey = (form: GateForm): string => [...new Set(form.map(clauseKey))].sort().join("|")

/** Printable form, for the report lines and for test failures. */
export function gateFormText(form: GateForm): string {
  if (form.length === 0) return "never"
  return form
    .map((clause) =>
      clause.length === 0
        ? "always"
        : clause
            .map((literal) => {
              const not = literal.negated ? "¬" : ""
              if (literal.kind === "oneOf") return `${not}${literal.field}∈[${literal.values.join("|")}]`
              if (literal.kind === "atLeast") return `${not}${literal.field}≥${literal.minimum}`
              if (literal.kind === "filled") return `${not}filled(${literal.field})`
              return `${not}true(${literal.field})`
            })
            .join(" ∧ "),
    )
    .join(" ∨ ")
}

const union = (left: string[], right: string[]): string[] => [...new Set([...left, ...right])]

/** `a ∨ b`, with the absorption an `always` branch causes. */
export function disjoin(left: GateForm, right: GateForm): GateForm {
  const merged = [...left, ...right]
  return merged.some((clause) => clause.length === 0) ? [[]] : merged
}

/** `a ∧ b`, distributed, capped so a pathological body becomes manual review instead of a hang. */
export function conjoin(left: GateForm, right: GateForm, at: string): Reduction {
  if (left.length === 0 || right.length === 0) return formed([])
  const product: GateForm = left.flatMap((clause) => right.map((other) => [...clause, ...other]))
  if (product.length > 24) return fail(`AND over OR produced ${product.length} branches`, at)
  return formed(product)
}

/**
 * Canonicalise so equivalent writings collide.
 *
 * Inside a clause, same-polarity `oneOf` literals on one field merge: `¬(a∈S) ∧ ¬(a∈T)` is `¬(a∈S∪T)`, which is
 * how smartzip's two `!==` become one negated `actionIs`. Across clauses, branches differing only by the value
 * of one positive `oneOf` merge: `(rename ∧ ¬dry) ∨ (delete ∧ ¬dry)` is `(action∈[rename|delete]) ∧ ¬dry`,
 * which is how enginev's `(a || b) && c` maps onto `all[actionIs, …]` — `DangerGate` has no nesting, so that
 * factorisation is the only honest reading. What the merge cannot decide is refused, never approximated.
 */
export function normalizeGateForm(form: GateForm): Reduction {
  const merged: GateClause[] = []
  for (const clause of form) {
    const positives = new Map<string, string[]>()
    const negatives = new Map<string, string[]>()
    const others: GateLiteral[] = []
    for (const literal of clause) {
      if (literal.kind !== "oneOf") {
        others.push(literal)
        continue
      }
      const bucket = literal.negated ? negatives : positives
      bucket.set(literal.field, union(bucket.get(literal.field) ?? [], literal.values))
    }
    for (const field of positives.keys()) {
      if (negatives.has(field)) return fail(`field "${field}" is required both inside and outside a value set`, clauseKey(clause))
    }
    const folded: GateClause = [...others]
    for (const [field, values] of positives) folded.push({ kind: "oneOf", field, values, negated: false })
    for (const [field, values] of negatives) folded.push({ kind: "oneOf", field, values, negated: true })
    merged.push(folded)
  }

  const groups = new Map<string, GateClause>()
  for (const clause of merged) {
    const positive = clause.filter((literal) => literal.kind === "oneOf" && !literal.negated)
    if (positive.length > 1) return fail("more than one positive value set in one clause", clauseKey(clause))
    const rest = clause
      .filter((literal) => !(literal.kind === "oneOf" && !literal.negated))
      .map(literalKey)
      .sort()
      .join("&")
    if (positive.length === 0) {
      if (!groups.has(`plain:${rest}`)) groups.set(`plain:${rest}`, clause)
      continue
    }
    const only = positive[0] as Extract<GateLiteral, { kind: "oneOf" }>
    const groupKey = `set:${rest}:${only.field}`
    const existing = groups.get(groupKey)
    if (!existing) {
      groups.set(groupKey, clause)
      continue
    }
    const previous = existing.find((literal) => literal.kind === "oneOf" && !literal.negated) as Extract<GateLiteral, { kind: "oneOf" }>
    previous.values = union(previous.values, only.values)
  }
  // Sorting makes the printed form stable, so two reports of the same gate read identically.
  const sorted = (clause: GateClause): GateClause =>
    [...clause]
      .map((literal) => (literal.kind === "oneOf" ? { ...literal, values: [...literal.values].sort() } : literal))
      .sort((left, right) => (literalKey(left) < literalKey(right) ? -1 : 1))
  return formed([...groups.values()].map(sorted))
}

// ------------------------------------------------------------------ definition -> gate form

export type Json = Record<string, unknown>

export const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

export function scalarText(value: unknown): { text: string; isBoolean: boolean } | null {
  if (!isObject(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 1) return null
  const inner = value[keys[0] as string]
  if (typeof inner === "string") return { text: inner, isBoolean: false }
  if (typeof inner === "number") return { text: String(inner), isBoolean: false }
  if (typeof inner === "boolean") return { text: String(inner), isBoolean: true }
  return null
}

function predicateToReduction(predicate: unknown): Reduction {
  const at = JSON.stringify(predicate)?.slice(0, 80) ?? "predicate"
  if (!isObject(predicate) || !isObject(predicate.test)) return fail("predicate is not {test, negated}", at)
  const negated = predicate.negated === true
  const test = predicate.test
  switch (test.type) {
    case "always":
      return formed([[]])
    case "never":
      return formed([])
    case "actionIs": {
      if (typeof test.actionField !== "string" || !Array.isArray(test.allowed)) return fail("actionIs without actionField/allowed", at)
      return leaf({ kind: "oneOf", field: test.actionField, values: test.allowed.map((item) => String(item)), negated })
    }
    case "fieldEquals": {
      if (typeof test.fieldId !== "string") return fail("fieldEquals without fieldId", at)
      const scalar = scalarText(test.value)
      if (!scalar) return fail("fieldEquals without a scalar value", at)
      // A boolean `fieldEquals` and a `fieldTrue` are different declarations; this gate will not pretend
      // they are one, because the closure side only rewrites `=== false` when the field kind says boolean.
      if (scalar.isBoolean) return fail(`fieldEquals against a boolean (${scalar.text}) is not a truthiness claim`, at)
      return leaf({ kind: "oneOf", field: test.fieldId, values: [scalar.text], negated })
    }
    case "fieldFilled":
      return typeof test.fieldId === "string" ? leaf({ kind: "filled", field: test.fieldId, negated }) : fail("fieldFilled without fieldId", at)
    case "fieldTrue":
      return typeof test.fieldId === "string" ? leaf({ kind: "truthy", field: test.fieldId, negated }) : fail("fieldTrue without fieldId", at)
    case "numberAtLeast":
      return typeof test.fieldId === "string" && typeof test.minimum === "number"
        ? leaf({ kind: "atLeast", field: test.fieldId, minimum: test.minimum, negated })
        : fail("numberAtLeast without fieldId and minimum", at)
    default:
      return fail(`test type ${JSON.stringify(test.type)} is not in the Rust Test enum`, at)
  }
}

/** The gate as a normalised form, or the reason it cannot be read (`pluginExport` is a real answer). */
export function definitionGateForm(definition: Json): { form: GateForm | null; reason: string | null } {
  const gate = definition.danger
  if (!isObject(gate)) return { form: null, reason: "danger is not a gate object" }
  let reduction: Reduction
  switch (gate.type) {
    case "none":
      reduction = formed([])
      break
    case "actionIn": {
      if (typeof gate.actionField !== "string" || !Array.isArray(gate.dangerous)) return { form: null, reason: "actionIn without actionField/dangerous" }
      reduction = leaf({ kind: "oneOf", field: gate.actionField, values: gate.dangerous.map((item) => String(item)), negated: false })
      break
    }
    case "fieldFlag": {
      if (typeof gate.fieldId !== "string") return { form: null, reason: "fieldFlag without fieldId" }
      reduction = leaf({ kind: "truthy", field: gate.fieldId, negated: gate.inverted === true })
      break
    }
    case "all": {
      if (!Array.isArray(gate.predicates)) return { form: null, reason: "all without predicates" }
      let acc: GateForm = [[]]
      for (const predicate of gate.predicates) {
        const literal = predicateToReduction(predicate)
        if (!literal.ok) return { form: null, reason: literal.reason }
        const joined = conjoin(acc, literal.form, "danger.all")
        if (!joined.ok) return { form: null, reason: joined.reason }
        acc = joined.form
      }
      reduction = formed(acc)
      break
    }
    case "any": {
      if (!Array.isArray(gate.predicates)) return { form: null, reason: "any without predicates" }
      let acc: GateForm = []
      for (const predicate of gate.predicates) {
        const literal = predicateToReduction(predicate)
        if (!literal.ok) return { form: null, reason: literal.reason }
        acc = disjoin(acc, literal.form)
      }
      reduction = formed(acc)
      break
    }
    case "pluginExport":
      return { form: null, reason: `the definition delegates the gate to plugin export "${String(gate.exportName ?? "")}"` }
    default:
      return { form: null, reason: `danger type ${JSON.stringify(gate.type)} is not in the Rust DangerGate enum` }
  }
  if (!reduction.ok) return { form: null, reason: reduction.reason }
  const normalized = normalizeGateForm(reduction.form)
  if (!normalized.ok) return { form: null, reason: normalized.reason }
  return { form: normalized.form, reason: null }
}
