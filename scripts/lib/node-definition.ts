/**
 * The node definition language (ADR-0069), as data.
 *
 * This is the TypeScript mirror of `crates/xiranite-plugin-api/src/node_definition.rs`. It exists so the
 * gate can reject a definition file that the Rust types cannot represent — the failure mode ADR-0068 was
 * written for is eight independently invented names for five capabilities, and here that means a condition,
 * rule or gate kind that only the TS side knows about.
 *
 * Two directions are checked, not just one:
 * - the *vocabulary* must equal the Rust source's (so TS cannot grow a predicate Rust lacks);
 * - each *instance* must be self-consistent (the same cross-references `NodeDefinition::validate()` enforces).
 */
import { readFile } from "node:fs/promises"

/** `FieldKind::ALL` in Rust, in the same order. */
export const NODE_FIELD_KINDS = ["text", "multiline", "path-list", "number", "select", "boolean"] as const
/** `Condition` variants. */
export const CONDITION_KINDS = ["always", "actionIs", "fieldEquals", "fieldFilled", "fieldTrue", "all", "any", "not"] as const
/** `Rule` variants. */
export const RULE_KINDS = ["required", "nonBlank", "integerAtLeast", "integerInRange", "oneOfDeclaredOptions", "atLeastLines", "custom"] as const
/** `DangerGate` variants. */
export const DANGER_KINDS = ["none", "actionIn", "fieldFlag", "all", "pluginExport"] as const
/** `Transform` variants. */
export const TRANSFORMS = ["identity", "trim", "lines", "delimited", "trimOrOmit", "asInteger", "asBoolean"] as const
/** `DEFINITION_VERSION_V1`. */
export const DEFINITION_VERSION_V1 = 1

const LOCALIZED_KEYS = ["zh", "en"]

export interface DefinitionReport {
  problems: string[]
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A `LocalizedText { zh, en }`: both keys present, neither blank. */
function checkLocalized(value: unknown, owner: string, problems: string[]): void {
  if (!isObject(value)) {
    problems.push(`${owner} must be a localized text object with zh and en`)
    return
  }
  const keys = Object.keys(value).sort()
  if (keys.join(",") !== LOCALIZED_KEYS.slice().sort().join(",")) {
    problems.push(`${owner} must carry exactly {zh, en}, got {${keys.join(", ")}}`)
    return
  }
  for (const language of LOCALIZED_KEYS) {
    const text = value[language]
    if (typeof text !== "string") problems.push(`${owner}.${language} must be a string`)
    else if (text.trim() === "") problems.push(`${owner}.${language} is blank (nodes author both languages inline; a definition may not delete one)`)
  }
}

/** A `Scalar`: exactly one of text / number / boolean. */
function checkScalar(value: unknown, owner: string, problems: string[]): void {
  if (!isObject(value)) {
    problems.push(`${owner} must be a scalar object like {"text": "scan"}`)
    return
  }
  const keys = Object.keys(value)
  if (keys.length !== 1 || !["text", "number", "boolean"].includes(keys[0] ?? "")) {
    problems.push(`${owner} must be exactly one of text/number/boolean, got {${keys.join(", ")}}`)
    return
  }
  const inner = value[keys[0] ?? ""]
  if (keys[0] === "text" && typeof inner !== "string") problems.push(`${owner}.text must be a string`)
  if (keys[0] === "number" && typeof inner !== "number") problems.push(`${owner}.number must be a number`)
  if (keys[0] === "boolean" && typeof inner !== "boolean") problems.push(`${owner}.boolean must be a boolean`)
}

function scalarKey(value: unknown): string {
  if (!isObject(value)) return String(value)
  const only = Object.values(value)[0]
  return typeof only === "string" ? only : String(only)
}

/** Field ids a condition reads, so references can be resolved against the declaration. */
function conditionFields(condition: unknown, into: Set<string>, problems: string[], owner: string): void {
  if (!isObject(condition)) {
    problems.push(`${owner} must be a condition object`)
    return
  }
  const kind = condition.type
  if (typeof kind !== "string" || !(CONDITION_KINDS as readonly string[]).includes(kind)) {
    problems.push(`${owner} has condition type ${JSON.stringify(kind)}, which is not in the Rust Condition enum (${CONDITION_KINDS.join(", ")})`)
    return
  }
  switch (kind) {
    case "always":
      return
    case "actionIs":
      if (typeof condition.actionField === "string") into.add(condition.actionField)
      else problems.push(`${owner}: actionIs needs actionField`)
      if (!Array.isArray(condition.allowed)) problems.push(`${owner}: actionIs needs an allowed list`)
      return
    case "fieldEquals":
    case "fieldFilled":
    case "fieldTrue":
      if (typeof condition.fieldId === "string") into.add(condition.fieldId)
      else problems.push(`${owner}: ${kind} needs fieldId`)
      if (kind === "fieldEquals") checkScalar(condition.value, `${owner}.value`, problems)
      return
    case "all":
    case "any":
      (Array.isArray(condition.conditions) ? condition.conditions : []).forEach((inner, index) => {
        conditionFields(inner, into, problems, `${owner}.conditions[${index}]`)
      })
      if (!Array.isArray(condition.conditions)) problems.push(`${owner}: ${kind} needs a conditions list`)
      return
    case "not":
      conditionFields(condition.condition, into, problems, `${owner}.condition`)
      return
  }
}

/** Validate one definition against the Rust vocabulary and its own internal references. */
export function validateNodeDefinition(raw: unknown): DefinitionReport {
  const problems: string[] = []
  if (!isObject(raw)) return { problems: ["definition must be a JSON object"] }

  if (raw.definitionVersion !== DEFINITION_VERSION_V1) {
    problems.push(`definitionVersion must be ${DEFINITION_VERSION_V1}, got ${JSON.stringify(raw.definitionVersion)}`)
  }
  if (typeof raw.nodeId !== "string" || raw.nodeId.trim() === "") problems.push("nodeId must be a non-empty string")
  checkLocalized(raw.title, "title", problems)
  checkLocalized(raw.description, "description", problems)

  const actions = Array.isArray(raw.actions) ? raw.actions : []
  if (actions.length === 0) problems.push("actions must not be empty (a node with nothing to run is a build mistake, not an empty menu)")
  const actionIds = new Set<string>()
  actions.forEach((entry, index) => {
    if (!isObject(entry)) {
      problems.push(`actions[${index}] must be an object`)
      return
    }
    if (typeof entry.id !== "string" || entry.id.trim() === "") problems.push(`actions[${index}].id must be non-empty`)
    else if (actionIds.has(entry.id)) problems.push(`duplicate action id "${entry.id}"`)
    else actionIds.add(entry.id)
    checkLocalized(entry.label, `actions[${index}].label`, problems)
    if (typeof entry.helpKey !== "string" || entry.helpKey.trim() === "") problems.push(`actions[${index}].helpKey must reference the node's help dictionary`)
  })

  const fields = Array.isArray(raw.fields) ? raw.fields : []
  const declared = new Set<string>()
  const selectors: Array<{ id: string; optionIds: Set<string> }> = []
  fields.forEach((entry, index) => {
    const where = `fields[${index}]`
    if (!isObject(entry)) {
      problems.push(`${where} must be an object`)
      return
    }
    const id = typeof entry.id === "string" ? entry.id : ""
    if (!id) problems.push(`${where}.id must be a non-empty string`)
    else if (declared.has(id)) problems.push(`duplicate field id "${id}"`)
    else declared.add(id)

    const kind = entry.kind
    if (typeof kind !== "string" || !(NODE_FIELD_KINDS as readonly string[]).includes(kind)) {
      problems.push(`${where}.kind ${JSON.stringify(kind)} is not one of ${NODE_FIELD_KINDS.join(", ")}`)
    }
    checkLocalized(entry.label, `${where}.label`, problems)
    if ("description" in entry && entry.description !== null && entry.description !== undefined) checkLocalized(entry.description, `${where}.description`, problems)
    if ("placeholder" in entry && entry.placeholder !== null && entry.placeholder !== undefined) checkLocalized(entry.placeholder, `${where}.placeholder`, problems)

    const options = Array.isArray(entry.options) ? entry.options : []
    options.forEach((option, optionIndex) => {
      if (!isObject(option)) {
        problems.push(`${where}.options[${optionIndex}] must be an object`)
        return
      }
      checkScalar(option.value, `${where}.options[${optionIndex}].value`, problems)
      checkLocalized(option.label, `${where}.options[${optionIndex}].label`, problems)
      if ("hint" in option && option.hint !== null && option.hint !== undefined) checkLocalized(option.hint, `${where}.options[${optionIndex}].hint`, problems)
    })
    if (kind === "select" && options.length === 0) problems.push(`${where}: a select field must offer options`)
    if (entry.isActionSelector === true) {
      selectors.push({ id, optionIds: new Set(options.map((option) => scalarKey(isObject(option) ? option.value : undefined))) })
    }

    const hasRange = isObject(entry.range)
    if (hasRange && kind !== "number") problems.push(`${where}: range belongs to number fields only`)
    if (hasRange) {
      const range = entry.range as Json
      if (typeof range.min === "number" && typeof range.max === "number" && range.min > range.max) {
        problems.push(`${where}: range.min ${range.min} exceeds range.max ${range.max}`)
      }
    }
    if ("default" in entry && entry.default !== null && entry.default !== undefined) {
      checkScalar(entry.default, `${where}.default`, problems)
      const onlyKey = isObject(entry.default) ? Object.keys(entry.default)[0] : undefined
      const expected = kind === "number" ? "number" : kind === "boolean" ? "boolean" : "text"
      if (onlyKey && onlyKey !== expected) problems.push(`${where}: default ${onlyKey} does not match kind ${kind}`)
    }

    conditionFields(entry.visible ?? { type: "always" }, new Set(), problems, `${where}.visible`)
    const visibleRefs = new Set<string>()
    conditionFields(entry.visible ?? { type: "always" }, visibleRefs, problems, `${where}.visible`)

    const rules = Array.isArray(entry.rules) ? entry.rules : []
    const ruleRefs = new Set<string>()
    rules.forEach((entry_rule, ruleIndex) => {
      const ruleWhere = `${where}.rules[${ruleIndex}]`
      if (!isObject(entry_rule)) {
        problems.push(`${ruleWhere} must be a guarded rule object: {rule, when?}`)
        return
      }
      // `GuardedRule` in Rust: the check and the condition that makes it apply travel together, so a
      // cross-field rule such as transq's "roots required unless action is status" stays declarable.
      const rule = isObject(entry_rule.rule) ? entry_rule.rule : undefined
      if (rule === undefined) problems.push(`${ruleWhere}.rule must be a rule object (fields.rules holds GuardedRule, not a bare rule)`)
      if ("when" in entry_rule && entry_rule.when !== null && entry_rule.when !== undefined) {
        conditionFields(entry_rule.when, ruleRefs, problems, `${ruleWhere}.when`)
      }
      const kindName = rule?.type
      if (typeof kindName !== "string" || !(RULE_KINDS as readonly string[]).includes(kindName)) {
        problems.push(`${ruleWhere} type ${JSON.stringify(kindName)} is not in the Rust Rule enum (${RULE_KINDS.join(", ")})`)
        return
      }
      if (kindName === "custom" && (typeof rule?.exportName !== "string" || rule.exportName.trim() === "")) {
        problems.push(`${ruleWhere}: a rule that cannot be declared must name the plugin export implementing it`)
      }
      if (kindName === "integerAtLeast" && typeof rule?.minimum !== "number") problems.push(`${ruleWhere}: integerAtLeast needs minimum`)
      if (kindName === "atLeastLines" && typeof rule?.minimum !== "number") problems.push(`${ruleWhere}: atLeastLines needs minimum`)
    })
    for (const reference of ruleRefs) {
      if (!declared.has(reference)) problems.push(`${where}.rules reads undeclared field "${reference}"`)
    }

    // Visibility may only read fields the definition declares, which needs the full set first; the
    // second pass below catches ids declared after this field too.
    for (const reference of visibleRefs) {
      if (!declared.has(reference)) problems.push(`${where}.visible reads undeclared field "${reference}"`)
    }
  })

  // Deferred pass: conditions may forward-reference, so re-check once every field is known.
  fields.forEach((entry, index) => {
    if (!isObject(entry)) return
    const refs = new Set<string>()
    conditionFields(entry.visible ?? { type: "always" }, refs, [], `fields[${index}].visible`)
    for (const reference of refs) {
      if (!declared.has(reference)) problems.push(`fields[${index}].visible reads undeclared field "${reference}"`)
    }
  })

  for (const selector of selectors) {
    if (selector.optionIds.size !== actionIds.size || [...actionIds].some((id) => !selector.optionIds.has(id))) {
      problems.push(`field "${selector.id}" is the action selector but its options are not exactly the declared actions`)
    }
  }

  const groups = Array.isArray(raw.groups) ? raw.groups : []
  groups.forEach((entry, index) => {
    const where = `groups[${index}]`
    if (!isObject(entry)) {
      problems.push(`${where} must be an object`)
      return
    }
    checkLocalized(entry.title, `${where}.title`, problems)
    if ("description" in entry && entry.description !== null && entry.description !== undefined) checkLocalized(entry.description, `${where}.description`, problems)
    const ids = Array.isArray(entry.fieldIds) ? entry.fieldIds : []
    if (Array.isArray(entry.fieldIds) === false) problems.push(`${where} needs fieldIds`)
    for (const id of ids) {
      if (typeof id !== "string") problems.push(`${where}.fieldIds entries must be strings`)
      else if (!declared.has(id)) problems.push(`${where} references undeclared field "${id}"`)
    }
  })

  const bindings = Array.isArray(raw.inputBindings) ? raw.inputBindings : []
  if (bindings.length === 0) problems.push("inputBindings must not be empty: without them the faces would each invent their own input shape")
  bindings.forEach((entry, index) => {
    const where = `inputBindings[${index}]`
    if (!isObject(entry)) {
      problems.push(`${where} must be an object`)
      return
    }
    if (typeof entry.fieldId !== "string" || !declared.has(entry.fieldId)) problems.push(`${where} references undeclared field ${JSON.stringify(entry.fieldId)}`)
    if (typeof entry.slot !== "string" || entry.slot.trim() === "") problems.push(`${where}.slot must name the input slot`)
    if (typeof entry.transform !== "string" || !(TRANSFORMS as readonly string[]).includes(entry.transform)) {
      problems.push(`${where}.transform ${JSON.stringify(entry.transform)} is not one of ${TRANSFORMS.join(", ")}`)
    }
    if ("defaultExport" in entry && entry.defaultExport !== null && entry.defaultExport !== undefined) {
      if (typeof entry.defaultExport !== "string" || entry.defaultExport.trim() === "") {
        problems.push(`${where}.defaultExport must name the plugin export computing the value`)
      }
    }
    for (const key of Object.keys(entry)) {
      if (!["fieldId", "slot", "transform", "defaultExport"].includes(key)) problems.push(`${where} carries unknown key "${key}"`)
    }
  })

  const danger = raw.danger
  if (!isObject(danger)) problems.push("danger must be a gate object (use {type: \"none\"} when nothing is dangerous)")
  else {
    const kindName = danger.type
    if (typeof kindName !== "string" || !(DANGER_KINDS as readonly string[]).includes(kindName)) {
      problems.push(`danger.type ${JSON.stringify(kindName)} is not in the Rust DangerGate enum (${DANGER_KINDS.join(", ")})`)
    } else if (kindName === "actionIn") {
      if (typeof danger.actionField === "string" && !declared.has(danger.actionField)) problems.push(`danger.actionField references undeclared field "${danger.actionField}"`)
      for (const action of Array.isArray(danger.dangerous) ? danger.dangerous : []) {
        if (typeof action !== "string" || !actionIds.has(action)) problems.push(`danger names dangerous action ${JSON.stringify(action)} which is not declared`)
      }
    } else if (kindName === "fieldFlag") {
      if (typeof danger.fieldId !== "string" || !declared.has(danger.fieldId)) problems.push("danger.fieldFlag must reference a declared field")
    } else if (kindName === "all") {
      const refs = new Set<string>()
      conditionFields({ type: "all", conditions: danger.conditions ?? [] }, refs, problems, "danger.conditions")
      for (const reference of refs) if (!declared.has(reference)) problems.push(`danger reads undeclared field "${reference}"`)
    } else if (kindName === "pluginExport") {
      if (typeof danger.exportName !== "string" || danger.exportName.trim() === "") problems.push("danger.pluginExport must name the plugin export")
    }
  }

  if (raw.dangerPrompt !== undefined && raw.dangerPrompt !== null) {
    if (!isObject(raw.dangerPrompt)) problems.push("dangerPrompt must be an object")
    else {
      checkLocalized(raw.dangerPrompt.title, "dangerPrompt.title", problems)
      checkLocalized(raw.dangerPrompt.body, "dangerPrompt.body", problems)
      checkLocalized(raw.dangerPrompt.confirmLabel, "dangerPrompt.confirmLabel", problems)
    }
    if (isObject(danger) && danger.type === "none") problems.push("dangerPrompt is set while danger is none: the prompt would never show")
  }

  for (const field of ["previewExport", "resultExport"] as const) {
    const value = raw[field]
    if (value !== undefined && value !== null && (typeof value !== "string" || value.trim() === "")) {
      problems.push(`${field} must name a plugin export or be omitted`)
    }
  }
  for (const field of ["reportsProgress", "publishesOutputPath"] as const) {
    if (typeof raw[field] !== "boolean") problems.push(`${field} must be a boolean`)
  }

  return { problems: [...new Set(problems)] }
}

/** Read the definition a plugin publishes; `null` when the file is absent. */
export async function readNodeDefinition(pluginsRoot: string, pluginId: string, fileName = "definition.json"): Promise<{ raw: string | null; path: string }> {
  const path = `${pluginsRoot}/${pluginId}/${fileName}`
  const raw = await readFile(path, "utf8").catch(() => null)
  return { raw, path }
}

/** Parse and validate a definition file. */
export function parseAndValidateDefinition(raw: string): DefinitionReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { problems: [`definition.json is not valid JSON (${error instanceof Error ? error.message : String(error)})`] }
  }
  return validateNodeDefinition(parsed)
}
