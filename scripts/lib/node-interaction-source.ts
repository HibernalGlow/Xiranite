/**
 * Reading one node's `interaction.ts`: the schema object it produces, and its danger closures as source text.
 *
 * Split by what each reader can answer. The vocabulary (fields, action options, `initialValues` defaults) comes
 * from the imported object, because that is what the terminal renders — an object-literal reader would call a
 * computed default "absent" and a `.map()`-built option list "unreadable". A closure's *behaviour* cannot be
 * read that way, so it is taken from the syntax tree (`@ast-grep/napi`, per ADR-0067) and reduced to the gate
 * grammar in `./node-gate-form.ts`. The reduction only names fields the definition can also name: a body that
 * reads a slot the definition binds to no field, or that compares a non-boolean field to a boolean, is refused
 * with a reason instead of being scored.
 */
import { pathToFileURL } from "node:url"

import { parse, type SgNode } from "@ast-grep/napi"

import {
  conjoin,
  disjoin,
  fail,
  formed,
  isObject,
  leaf,
  normalizeGateForm,
  type GateForm,
  type Json,
  type Reduction,
} from "./node-gate-form.ts"

// ------------------------------------------------------------------ syntax-tree helpers

const quotePattern = /^["'`]|["'`]$/g

const unquoteKey = (node: SgNode): string => node.text().replace(quotePattern, "")

function stringText(node: SgNode): string | null {
  if (node.kind() !== "string") return null
  const fragment = node.children().find((child) => child.kind() === "string_fragment")
  return fragment ? fragment.text() : node.text().replace(quotePattern, "")
}

/** A literal the grammar can name as a value; booleans are flagged because they get a rule of their own. */
function literalValue(node: SgNode): { value: string; isBoolean: boolean } | null {
  const text = stringText(node)
  if (text !== null) return { value: text, isBoolean: false }
  if (node.kind() === "true") return { value: "true", isBoolean: true }
  if (node.kind() === "false") return { value: "false", isBoolean: true }
  if (node.kind() === "number") return { value: node.text(), isBoolean: false }
  return null
}

function binaryParts(node: SgNode): { left: SgNode; operator: string; right: SgNode } | null {
  if (node.kind() !== "binary_expression") return null
  const children = node.children()
  if (children.length < 3) return null
  const operator = children
    .slice(1, -1)
    .map((child) => child.text())
    .join("")
    .trim()
  return { left: children[0] as SgNode, operator, right: children[children.length - 1] as SgNode }
}

/** Skips parentheses and a `?? literal` tail — the way this tree writes `input.action ?? ""`. */
function unwrap(node: SgNode): SgNode {
  let current = node
  for (let guard = 0; guard < 8; guard += 1) {
    if (current.kind() === "parenthesized_expression") {
      const inner = current.children().find((child) => child.kind() !== "(" && child.kind() !== ")")
      if (!inner) return current
      current = inner
      continue
    }
    const parts = binaryParts(current)
    if (parts && parts.operator === "??" && literalValue(parts.right)) {
      current = parts.left
      continue
    }
    return current
  }
  return current
}

/** `param.slot` — the only member shape the gate grammar can name as a field read. */
function memberOnParam(node: SgNode, param: string): string | null {
  if (node.kind() !== "member_expression") return null
  const children = node.children()
  const object = children[0]
  const property = children[children.length - 1]
  if (!object || !property || object.text() !== param) return null
  // `input.scoreOptions?.dryRun` reaches into a nested document, which is not one field value.
  if (children.some((child) => child.text() === "?.")) return null
  if (property.kind() !== "property_identifier" && property.kind() !== "identifier") return null
  return property.text()
}

const referencesParam = (node: SgNode, name: string): boolean =>
  node.findAll({ rule: { kind: "identifier" } }).some((child) => child.text() === name)

const lineOf = (node: SgNode): number => node.range().start.line + 1

/** A `{ … }` body counts as one value only when it is exactly one `return`. */
function blockReturn(
  block: SgNode,
  param: string | null,
): { param: string | null; body: SgNode | null; scope: SgNode | null; note: string | null } {
  const statements = block.children().filter((child) => child.kind() !== "{" && child.kind() !== "}")
  const returns = statements.filter((child) => child.kind() === "return_statement")
  if (statements.length !== 1 || returns.length !== 1) {
    // The block still says which fields the body reads, which is all the prompt questions need.
    return { param, body: null, scope: block, note: `body holds ${statements.length} statement(s), ${returns.length} of them return` }
  }
  const expression = (returns[0] as SgNode).children().find((child) => child.kind() !== "return" && child.kind() !== ";")
  return { param, body: expression ?? null, scope: expression ?? block, note: expression ? null : "return with no value" }
}

/** The parameter name and the single value expression of a closure. */
function closureParts(node: SgNode): { param: string | null; body: SgNode | null; scope: SgNode | null; note: string | null } {
  if (node.kind() === "arrow_function") {
    const children = node.children()
    const arrow = children.findIndex((child) => child.kind() === "=>")
    if (arrow < 0) return { param: null, body: null, scope: null, note: "arrow with no `=>`" }
    const head = children.slice(0, arrow)
    const parameters = head.find((child) => child.kind() === "formal_parameters")
    const declared = parameters
      ? parameters.children().find((child) => child.kind() === "required_parameter" || child.kind() === "identifier")
      : head.find((child) => child.kind() === "identifier")
    const param = declared ? (declared.children().find((child) => child.kind() === "identifier")?.text() ?? declared.text()) : null
    const body = children.slice(arrow + 1)[0] ?? null
    if (!body) return { param, body: null, scope: null, note: "arrow with no body" }
    if (body.kind() === "statement_block") return blockReturn(body, param)
    return { param, body, scope: body, note: null }
  }
  if (node.kind() === "function_expression" || node.kind() === "function_declaration" || node.kind() === "method_definition") {
    const parameters = node.children().find((child) => child.kind() === "formal_parameters")
    const declared = parameters?.children().find((child) => child.kind() === "required_parameter" || child.kind() === "identifier")
    const param = declared ? (declared.children().find((child) => child.kind() === "identifier")?.text() ?? declared.text()) : null
    const block = node.children().find((child) => child.kind() === "statement_block")
    if (!block) return { param, body: null, scope: null, note: "function with no body" }
    return blockReturn(block, param)
  }
  return { param: null, body: null, scope: null, note: `not a function (${node.kind()})` }
}

/** Every property pair with this key plus every method with this name, in source order. */
function closureNodes(root: SgNode, name: string): SgNode[] {
  const found: SgNode[] = []
  for (const pair of root.findAll({ rule: { kind: "pair" } })) {
    const key = pair.field("key")
    if (!key || unquoteKey(key) !== name) continue
    const value = pair.field("value")
    if (value) found.push(value)
  }
  for (const method of root.findAll({ rule: { kind: "method_definition" } })) {
    if (method.field("name")?.text() === name) found.push(method)
  }
  return found
}

/** `isDangerous: someHelper` — the body lives in this file, so follow the name. */
function resolveNamed(root: SgNode, name: string): SgNode | null {
  for (const declaration of root.findAll({ rule: { kind: "function_declaration" } })) {
    if (declaration.children().some((child) => child.kind() === "identifier" && child.text() === name)) return declaration
  }
  for (const declarator of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const children = declarator.children()
    if (children[0]?.text() !== name) continue
    return children[children.length - 1] ?? null
  }
  return null
}

// ------------------------------------------------------------------ closure -> gate form

interface ClosureContext {
  param: string
  /** The definition's field id for an input slot name, or `null` when the definition binds no such slot. */
  fieldOf: (slot: string) => string | null
  /** Only a field declared `boolean` on both sides may use the `=== false` ⇄ `¬true(…)` equivalence. */
  isBoolean: (fieldId: string) => boolean
}

function leafToReduction(node: SgNode, ctx: ClosureContext): Reduction {
  const at = node.text().slice(0, 80)

  if (node.kind() === "unary_expression") {
    const [operator, operand] = node.children()
    if (!operator || operator.text() !== "!" || !operand) return fail("a negation that is not `!`", at)
    const slot = memberOnParam(unwrap(operand), ctx.param)
    if (!slot) return fail("negates something that is not a field of the input", at)
    const fieldId = ctx.fieldOf(slot)
    if (!fieldId) return fail(`reads slot "${slot}", which the definition binds to no field`, at)
    if (!ctx.isBoolean(fieldId)) return fail(`\`!${slot}\` is not a boolean field on both sides`, at)
    return leaf({ kind: "truthy", field: fieldId, negated: true })
  }

  const parts = binaryParts(node)
  if (!parts) {
    const slot = memberOnParam(unwrap(node), ctx.param)
    if (!slot) return fail("an expression that is not a comparison", at)
    const fieldId = ctx.fieldOf(slot)
    if (!fieldId) return fail(`reads slot "${slot}", which the definition binds to no field`, at)
    if (!ctx.isBoolean(fieldId)) return fail(`\`${slot}\` used as a condition is not a boolean field on both sides`, at)
    return leaf({ kind: "truthy", field: fieldId, negated: false })
  }

  if (parts.operator === ">=" || parts.operator === "<=" || parts.operator === ">" || parts.operator === "<") {
    // `>=` and its mirrored spelling `literal <= field` are the `numberAtLeast` leaf; strict and inclusive
    // comparisons of the other direction name different sets, so they stay out of the grammar.
    if (parts.operator === ">" || parts.operator === "<") return fail(`\`>\`/\`<\` has no gate equivalent`, at)
    const flipped = parts.operator === "<="
    const valueNode = unwrap(flipped ? parts.left : parts.right)
    const memberNode = unwrap(flipped ? parts.right : parts.left)
    const value = literalValue(valueNode)
    const slot = memberOnParam(memberNode, ctx.param)
    if (!value || value.isBoolean || !slot) return fail("an ordering comparison that is not `field >= number literal`", at)
    const fieldId = ctx.fieldOf(slot)
    if (!fieldId) return fail(`reads slot "${slot}", which the definition binds to no field`, at)
    const minimum = Number(value.value)
    if (!Number.isFinite(minimum)) return fail("an ordering comparison against a non-number", at)
    return leaf({ kind: "atLeast", field: fieldId, minimum, negated: flipped })
  }

  if (parts.operator !== "===" && parts.operator !== "!==") return fail(`operator ${parts.operator || "?"} is not in the gate grammar`, at)
  const negated = parts.operator === "!=="
  const left = unwrap(parts.left)
  const right = unwrap(parts.right)
  const leftIsField = memberOnParam(left, ctx.param) !== null
  const slot = memberOnParam(left, ctx.param) ?? memberOnParam(right, ctx.param)
  if (!slot) return fail("compares something that is not a field of the input", at)
  const value = literalValue(leftIsField ? right : left)
  if (!value) return fail(`compares "${slot}" to a value that is not a literal`, at)
  const fieldId = ctx.fieldOf(slot)
  if (!fieldId) return fail(`reads slot "${slot}", which the definition binds to no field`, at)
  if (value.isBoolean) {
    if (!ctx.isBoolean(fieldId)) return fail(`"${slot}" is compared to a boolean but is not declared boolean on both sides`, at)
    // `x === false` ⇄ `¬true(x)`, `x !== false` ⇄ `true(x)`: valid only because the field declares booleans,
    // which is what makes "not true" and "false" the same set for it.
    const holdsWhenTrue = value.value === "true" ? !negated : negated
    return leaf({ kind: "truthy", field: fieldId, negated: !holdsWhenTrue })
  }
  return leaf({ kind: "oneOf", field: fieldId, values: [value.value], negated })
}

/** `.includes([...])`, including the `!…includes(…)` and `String(…)` spellings. */
function includesToReduction(node: SgNode, ctx: ClosureContext, negated: boolean): Reduction | null {
  const callee = node.children()[0]
  const args = node.children().find((child) => child.kind() === "arguments")
  if (!callee || !args || callee.kind() !== "member_expression") return null
  if (callee.children().at(-1)?.text() !== "includes") return null
  const source = callee.children()[0]
  if (!source || source.kind() !== "array") return null
  const values: string[] = []
  for (const element of source.children()) {
    // The array's own `[`/`]` and the separators are punctuation children, not values.
    if (element.kind() === "," || element.kind() === "[" || element.kind() === "]") continue
    const text = stringText(element)
    if (text === null) return null
    values.push(text)
  }
  if (values.length === 0) return null
  let subject = args.children().find((child) => child.kind() !== "(" && child.kind() !== ")")
  if (!subject) return null
  if (subject.kind() === "call_expression" && subject.children()[0]?.text() === "String") {
    subject = subject.children().at(-1)?.children().find((child) => child.kind() !== "(" && child.kind() !== ")") ?? subject
  }
  const slot = memberOnParam(unwrap(subject), ctx.param)
  if (!slot) return null
  const fieldId = ctx.fieldOf(slot)
  if (!fieldId) return null
  return leaf({ kind: "oneOf", field: fieldId, values, negated })
}

function expressionToReduction(node: SgNode, ctx: ClosureContext): Reduction {
  const current = unwrap(node)
  const parts = binaryParts(current)
  if (parts?.operator === "||") {
    const left = expressionToReduction(parts.left, ctx)
    if (!left.ok) return left
    const right = expressionToReduction(parts.right, ctx)
    if (!right.ok) return right
    return formed(disjoin(left.form, right.form))
  }
  if (parts?.operator === "&&") {
    const left = expressionToReduction(parts.left, ctx)
    if (!left.ok) return left
    const right = expressionToReduction(parts.right, ctx)
    if (!right.ok) return right
    return conjoin(left.form, right.form, current.text().slice(0, 80))
  }
  if (current.kind() === "unary_expression") {
    const [operator, operand] = current.children()
    if (operator?.text() === "!" && operand) {
      const inner = unwrap(operand)
      if (inner.kind() === "call_expression") {
        const viaIncludes = includesToReduction(inner, ctx, true)
        if (viaIncludes) return viaIncludes
      }
    }
    return leafToReduction(current, ctx)
  }
  if (current.kind() === "call_expression") {
    const viaIncludes = includesToReduction(current, ctx, false)
    if (viaIncludes) return viaIncludes
    return fail(`calls ${current.children()[0]?.text() ?? "a function"}, which the gate grammar cannot name`, current.text().slice(0, 80))
  }
  if (current.kind() === "true") return formed([[]])
  if (current.kind() === "false") return formed([])
  return leafToReduction(current, ctx)
}

// ------------------------------------------------------------------ the node's side

export interface SchemaFieldFact {
  id: string
  kind: string
  /** The `initialValues` entry as text, or `null` when the schema gives the field no starting value. */
  defaultText: string | null
}

export interface PromptFact {
  line: number
  text: string
  /** True when the closure reads its argument, so its copy is not one constant to compare. */
  paramDependent: boolean
  /** The authored copy in both languages, only when the closure ignores its argument. */
  copy: { zh: Json; en: Json } | null
  copyFailure: string | null
}

export interface SchemaFacts {
  interactionFile: string
  /** Why nothing is comparable for this node; `null` when the schema loaded. */
  failure: string | null
  /** True when the file holds no terminal schema at all (findz deleted its one). */
  schemaless: boolean
  actionFieldId: string | null
  actionFieldFrom: "role" | "id" | "none"
  actions: string[]
  fields: SchemaFieldFact[]
  /** `null` when the node declares no `dangerPrompt`. */
  prompt: PromptFact | null
  /** The file source, so the gate closure is analysed from the same tree the facts came out of. */
  source: string
  hasDangerClosure: boolean
}

const valueText = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value === "string") return value
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  return JSON.stringify(value)
}

const SCHEMA_MARKS = new Set(["toInput", "initialValues", "isDangerous", "preview"])

type SchemaFactory = (defaults?: unknown, language?: string) => Record<string, unknown>

const looksLikeSchema = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && (Array.isArray(value.fields) || "initialValues" in value || "toInput" in value)

/**
 * Read one node's schema by importing it.
 *
 * The vocabulary must come from the object the terminal renders: `options` after the `.map()` that builds them
 * (`packages/nodes/trename/src/interaction.ts:35`), `initialValues` after the spread that fills it. A reader
 * that only walked the object literal would call a computed default "missing" and an option list "unreadable".
 */
export async function loadSchemaFacts(nodeId: string, file: string, source: string): Promise<SchemaFacts> {
  const root = parse("typescript", source).root()
  const dangerEntries = closureNodes(root, "isDangerous")
  const base: SchemaFacts = {
    interactionFile: `packages/nodes/${nodeId}/src/interaction.ts`,
    failure: null,
    schemaless: false,
    actionFieldId: null,
    actionFieldFrom: "none",
    actions: [],
    fields: [],
    prompt: null,
    source,
    hasDangerClosure: dangerEntries.length > 0,
  }

  const declaresSchema = root.findAll({ rule: { kind: "pair" } }).some((pair) => {
    const key = pair.field("key")
    return key ? SCHEMA_MARKS.has(unquoteKey(key)) : false
  })
  if (!declaresSchema) return { ...base, schemaless: true, failure: "the file declares no terminal interaction schema" }

  let schema: Record<string, unknown> | null = null
  let schemaEn: Record<string, unknown> | null = null
  let failure: string | null = null
  try {
    const loaded = (await import(pathToFileURL(file).href)) as Record<string, unknown>
    const candidates = Object.entries(loaded)
      .filter(([, value]) => typeof value === "function")
      .sort(([left], [right]) => (/InteractionSchema/.test(left) ? -1 : 0) - (/InteractionSchema/.test(right) ? -1 : 0))
    for (const [, value] of candidates) {
      const factory = value as SchemaFactory
      try {
        const produced = factory({}, "zh")
        if (!looksLikeSchema(produced)) continue
        schema = produced
        const english = factory({}, "en")
        schemaEn = looksLikeSchema(english) ? english : null
        break
      } catch {
        // Not the schema factory; try the next exported function before giving up.
      }
    }
    if (!schema) failure = "no exported function produced an interaction schema"
  } catch (error) {
    failure = `import failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`
  }
  if (!schema) return { ...base, failure: failure ?? "schema object could not be produced" }

  const rawFields = Array.isArray(schema.fields) ? (schema.fields as unknown[]) : []
  const initialValues = isObject(schema.initialValues) ? schema.initialValues : {}
  const fields: SchemaFieldFact[] = rawFields
    .filter((entry): entry is Json => isObject(entry) && typeof entry.id === "string")
    .map((entry) => ({
      id: String(entry.id),
      kind: typeof entry.kind === "string" ? entry.kind : "",
      defaultText: valueText(initialValues[String(entry.id)]),
    }))

  const roleField = rawFields.find((entry) => isObject(entry) && entry.role === "action")
  const idField = rawFields.find((entry) => isObject(entry) && entry.id === "action")
  const actionEntry = isObject(roleField) ? roleField : isObject(idField) ? idField : null
  const actionFieldId = actionEntry && typeof actionEntry.id === "string" ? actionEntry.id : null
  const options = actionEntry && Array.isArray(actionEntry.options) ? (actionEntry.options as unknown[]) : []
  const actions = options
    .map((option) => (isObject(option) ? valueText(option.value) : valueText(option)) ?? "")
    .filter((value) => value !== "")

  // The prompt: source text and line from the tree, the copy from the live closure when it is a constant.
  let prompt: PromptFact | null = null
  const promptEntries = closureNodes(root, "dangerPrompt")
  if (promptEntries.length > 0) {
    const entry = promptEntries[0] as SgNode
    const target = entry.kind() === "identifier" ? resolveNamed(root, entry.text()) : entry
    const node = target ?? entry
    const parts = closureParts(node)
    const paramDependent = Boolean(parts.param && parts.scope && referencesParam(parts.scope, parts.param))
    let copy: { zh: Json; en: Json } | null = null
    let copyFailure: string | null = null
    if (paramDependent) copyFailure = "the prompt reads its argument"
    else if (typeof schema.dangerPrompt !== "function") copyFailure = "the loaded schema has no callable dangerPrompt"
    else if (!schemaEn || typeof schemaEn.dangerPrompt !== "function") copyFailure = "the schema could not be re-instantiated in English"
    else {
      try {
        const zh = schema.dangerPrompt(null)
        const en = (schemaEn.dangerPrompt as (input: unknown) => unknown)(null)
        copy = isObject(zh) && isObject(en) ? { zh, en } : null
        if (!copy) copyFailure = "dangerPrompt() did not return an object"
      } catch (error) {
        copyFailure = `dangerPrompt() could not be evaluated: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`
      }
    }
    prompt = { line: lineOf(node), text: node.text().slice(0, 400), paramDependent, copy, copyFailure }
  }

  return {
    ...base,
    actionFieldId,
    actionFieldFrom: actionEntry ? (isObject(roleField) ? "role" : "id") : "none",
    actions,
    fields,
    prompt,
  }
}

export interface DefinitionShape {
  /** Field kinds as the definition declares them. */
  fieldKinds: Map<string, string>
  /** Field kinds as the schema declares them. */
  schemaKinds: Map<string, string>
  /** Input slot name to the field id that feeds it. */
  slotToField: Map<string, string>
}

/** Reduce one node's `isDangerous` body into the gate grammar, named in the definition's field ids. */
export function analyzeDangerClosure(
  facts: SchemaFacts,
  shape: DefinitionShape,
): { form: GateForm | null; reason: string | null; line: number; text: string } {
  const root = parse("typescript", facts.source).root()
  const found = closureNodes(root, "isDangerous")
  if (found.length === 0) return { form: null, reason: "the node declares no isDangerous", line: 0, text: "" }
  const entry = found[0] as SgNode
  if (found.length > 1) return { form: null, reason: `the file declares ${found.length} isDangerous members`, line: lineOf(entry), text: entry.text().slice(0, 400) }

  const target = entry.kind() === "identifier" ? resolveNamed(root, entry.text()) : entry
  if (!target) return { form: null, reason: `the body is the helper "${entry.text()}", which this file does not define`, line: lineOf(entry), text: entry.text() }
  const parts = closureParts(target)
  if (!parts.body) return { form: null, reason: parts.note ?? "no body to read", line: lineOf(target), text: target.text().slice(0, 400) }
  // A closure with no parameter can only state a constant (`() => false`, soundw/logx/linedup); with an empty
  // parameter name every field read fails to resolve, which is the honest outcome for a captured variable.
  const ctx: ClosureContext = {
    param: parts.param ?? "",
    fieldOf: (slot) => shape.slotToField.get(slot) ?? (shape.fieldKinds.has(slot) ? slot : null),
    isBoolean: (fieldId) => shape.fieldKinds.get(fieldId) === "boolean" && shape.schemaKinds.get(fieldId) === "boolean",
  }
  const reduction = expressionToReduction(parts.body, ctx)
  if (!reduction.ok) return { form: null, reason: reduction.reason, line: lineOf(target), text: target.text().slice(0, 400) }
  const normalized = normalizeGateForm(reduction.form)
  if (!normalized.ok) return { form: null, reason: normalized.reason, line: lineOf(target), text: target.text().slice(0, 400) }
  return { form: normalized.form, reason: null, line: lineOf(target), text: target.text().slice(0, 400) }
}
