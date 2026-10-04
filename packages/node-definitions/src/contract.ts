/**
 * The node definition language (ADR-0069), as data.
 *
 * Source of truth on the TypeScript side for what a definition may say. Two kinds of consumer import it:
 * the development gates (`scripts/audit-plugin-manifests.ts`, `scripts/audit-node-definitions.ts`) and the
 * product layer (`packages/node-definitions` form bridge) that lets the Web UI render a node form from a
 * definition instead of from per-node closures.
 *
 * The Rust mirror is `crates/xiranite-plugin-api/src/node_definition.rs`, and `contract.test.ts` asserts
 * the two vocabularies are identical, so neither side can grow a predicate the other cannot represent —
 * the fork ADR-0068 exists to prevent (five capabilities, eight invented names).
 *
 * No DOM, no React, no `node:fs` here: the same evaluation has to run in the browser bundle and in `bun test`.
 */

/** `FieldKind::ALL` in Rust, in the same order. */
export const NODE_FIELD_KINDS = ["text", "multiline", "path-list", "number", "select", "boolean"] as const
/** `Condition` variants: one predicate, or a flat all/any over predicates. */
export const CONDITION_KINDS = ["single", "all", "any", "anyAll"] as const
/** `Test` variants — the leaves a predicate tests. Negation is a flag, not a nesting level, because a
 * WIT variant cannot contain itself (ADR-0068). */
export const TEST_KINDS = ["always", "never", "actionIs", "fieldEquals", "fieldFilled", "fieldTrue", "numberAtLeast"] as const
/** `ValueSource` variants. */
export const VALUE_SOURCE_KINDS = ["field", "literal", "actionLabel", "firstNonEmpty"] as const
/** `Rule` variants. */
export const RULE_KINDS = ["required", "nonBlank", "integerAtLeast", "integerInRange", "numberAtLeast", "numberInRange", "oneOfDeclaredOptions", "atLeastLines", "custom"] as const
/** `DangerGate` variants. */
export const DANGER_KINDS = ["none", "actionIn", "fieldFlag", "all", "any", "pluginExport"] as const
/** `Transform` variants. */
export const TRANSFORMS = ["identity", "trim", "lines", "delimited", "trimOrOmit", "asInteger", "asBoolean"] as const
/** `DEFINITION_VERSION_V1`. */
export const DEFINITION_VERSION_V1 = 1

const LOCALIZED_KEYS = ["zh", "en"]
/**
 * The help workflow keys a `definition.help` entry may carry: the surface keys of `NodeHelpWorkflow`
 * (`ui`, `cli`, `tips`), each holding one localized list. These are the wire spellings the node's
 * `help.ts` uses; the Rust variants are `HelpSurface::{WorkspaceUi, CommandLine, Tips}`.
 */
export const HELP_SURFACES = ["ui", "cli", "tips"] as const

/** A parsed definition document, structurally: the validators read it, they do not trust it. */
export type DefinitionDocument = Record<string, unknown>

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

/** Validate one `{test, negated}` predicate and collect the fields it reads. */
function predicateFields(predicate: unknown, into: Set<string>, problems: string[], owner: string): void {
  // A bare `{type:"always"}` where a predicate belongs is the common authoring slip, so it is diagnosed
  // before the field checks; a predicate that is present but forgets `negated` is a separate mistake.
  if (!isObject(predicate) || !("test" in predicate)) {
    problems.push(`${owner} must be a predicate object: {test, negated}`)
    return
  }
  if (typeof predicate.negated !== "boolean") problems.push(`${owner}.negated must be a boolean`)
  const test = predicate.test
  if (!isObject(test)) {
    problems.push(`${owner}.test must be a test object`)
    return
  }
  const kindName = test.type
  if (typeof kindName !== "string" || !(TEST_KINDS as readonly string[]).includes(kindName)) {
    problems.push(`${owner}.test type ${JSON.stringify(kindName)} is not in the Rust Test enum (${TEST_KINDS.join(", ")})`)
    return
  }
  switch (kindName) {
    case "always":
      return
    case "actionIs":
      if (typeof test.actionField === "string") into.add(test.actionField)
      else problems.push(`${owner}: actionIs needs actionField`)
      if (!Array.isArray(test.allowed)) problems.push(`${owner}: actionIs needs an allowed list`)
      return
    case "fieldEquals":
      if (typeof test.fieldId === "string") into.add(test.fieldId)
      else problems.push(`${owner}: fieldEquals needs fieldId`)
      checkScalar(test.value, `${owner}.test.value`, problems)
      return
    case "fieldFilled":
    case "fieldTrue":
      if (typeof test.fieldId === "string") into.add(test.fieldId)
      else problems.push(`${owner}: ${kindName} needs fieldId`)
      return
    case "numberAtLeast":
      if (typeof test.fieldId === "string") into.add(test.fieldId)
      else problems.push(`${owner}: numberAtLeast needs fieldId`)
      if (typeof test.minimum !== "number") problems.push(`${owner}: numberAtLeast needs minimum`)
      return
  }
}

/** Field ids a condition reads, so references can be resolved against the declaration. */
function conditionFields(condition: unknown, into: Set<string>, problems: string[], owner: string): void {
  if (!isObject(condition)) {
    problems.push(`${owner} must be a condition object`)
    return
  }
  const kindName = condition.type
  if (typeof kindName !== "string" || !(CONDITION_KINDS as readonly string[]).includes(kindName)) {
    problems.push(`${owner} has condition type ${JSON.stringify(kindName)}, which is not in the Rust Condition enum (${CONDITION_KINDS.join(", ")})`)
    return
  }
  if (kindName === "single") {
    predicateFields(condition.predicate, into, problems, `${owner}.predicate`)
    return
  }
  if (kindName === "anyAll") {
    clausesFields(condition.clauses, into, problems, owner)
    return
  }
  const predicates = Array.isArray(condition.predicates) ? (condition.predicates as unknown[]) : null
  if (predicates === null) {
    problems.push(`${owner}.predicates must be a list of predicates`)
    return
  }
  // An empty compound reads as well-formed data but means "always" for `all` and "never" for `any`,
  // which is how a transcription silently hides or reveals every field.
  if (predicates.length === 0) problems.push(`${owner}: ${kindName} needs at least one predicate`)
  predicates.forEach((predicate, index) => {
    predicateFields(predicate, into, problems, `${owner}.predicates[${index}]`)
  })
}

/** Fields read by an `anyAll` condition: an OR of ANDs, flat lists rather than nested variants. */
function clausesFields(clauses: unknown, into: Set<string>, problems: string[], owner: string): void {
  if (!Array.isArray(clauses)) {
    problems.push(`${owner}.clauses must be a list of predicate lists`)
    return
  }
  if (clauses.length === 0) problems.push(`${owner}: anyAll needs at least one clause`)
  clauses.forEach((clause, clauseIndex) => {
    if (!Array.isArray(clause)) {
      problems.push(`${owner}.clauses[${clauseIndex}] must be a list of predicates`)
      return
    }
    if (clause.length === 0) problems.push(`${owner}.clauses[${clauseIndex}] is empty`)
    clause.forEach((predicate, index) => {
      predicateFields(predicate, into, problems, `${owner}.clauses[${clauseIndex}][${index}]`)
    })
  })
}

/** Fields a `ValueSource` reads; WIT-expressible, so no nesting beyond a field list plus one literal. */
function valueSourceFields(value: unknown, into: Set<string>, problems: string[], owner: string): void {
  if (!isObject(value)) {
    problems.push(`${owner} must be a value source object`)
    return
  }
  const kindName = value.type
  if (typeof kindName !== "string" || !(VALUE_SOURCE_KINDS as readonly string[]).includes(kindName)) {
    problems.push(`${owner}.type ${JSON.stringify(kindName)} is not in the Rust ValueSource enum (${VALUE_SOURCE_KINDS.join(", ")})`)
    return
  }
  if (kindName === "field") {
    if (typeof value.fieldId === "string") into.add(value.fieldId)
    else problems.push(`${owner}: field needs fieldId`)
  }
  if (kindName === "literal") checkLocalized(value.value, `${owner}.value`, problems)
  if (kindName === "firstNonEmpty") {
    for (const fieldId of Array.isArray(value.fieldIds) ? (value.fieldIds as unknown[]) : []) {
      if (typeof fieldId !== "string") problems.push(`${owner}.fieldIds entries must be strings`)
      else into.add(fieldId)
    }
    if (!Array.isArray(value.fieldIds)) problems.push(`${owner}.fieldIds must be a list`)
    checkLocalized(value.fallbackText, `${owner}.fallbackText`, problems)
  }
}

const HELP_KEYS = ["whenToUse", "workflows", "commands", "safety"]
const HELP_WORKFLOW_KEYS = ["title", "summary", ...HELP_SURFACES]
const HELP_COMMAND_KEYS = ["title", "command", "description", "examples"]
const HELP_EXAMPLE_KEYS = ["label", "command", "description"]
const HELP_SAFETY_KEYS = ["defaultMode", "destructive", "notes"]

/** A `{zh: string[], en: string[]}` pair: the localized form of a help list. */
function checkLocalizedList(value: unknown, owner: string, problems: string[]): void {
  if (!isObject(value)) {
    problems.push(`${owner} must be a localized list object with zh and en`)
    return
  }
  const keys = Object.keys(value).sort()
  if (keys.join(",") !== "en,zh") {
    problems.push(`${owner} must carry exactly {zh, en} lists, got {${keys.join(", ")}}`)
    return
  }
  for (const language of LOCALIZED_KEYS) {
    const lines = value[language]
    if (!Array.isArray(lines)) {
      problems.push(`${owner}.${language} must be a list of strings`)
      continue
    }
    lines.forEach((line, index) => {
      if (typeof line !== "string") problems.push(`${owner}.${language}[${index}] must be a string`)
      else if (line.trim() === "") problems.push(`${owner}.${language}[${index}] is blank`)
    })
  }
}

function rejectExtraKeys(value: Json, allowed: readonly string[], owner: string, problems: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) problems.push(`${owner} carries unknown key "${key}"`)
  }
}

/**
 * Validate the optional `help` block — the node's own usage documentation, published as data so a terminal
 * can print `--help` without the TypeScript workspace (ADR-0069: help text does not drift).
 *
 * Absent is legal and means the node publishes no `help.ts` yet; `audit:node-help-text` fails the build when
 * a node that does have a dictionary ships a definition without the block, so the optionality is disclosed
 * debt rather than an open door.
 */
function checkHelpBlock(help: unknown, problems: string[]): void {
  if (!isObject(help)) {
    problems.push("help must be an object with whenToUse/workflows/commands/safety")
    return
  }
  rejectExtraKeys(help, HELP_KEYS, "help", problems)
  if ("whenToUse" in help && help.whenToUse !== undefined) checkLocalizedList(help.whenToUse, "help.whenToUse", problems)

  const workflows = Array.isArray(help.workflows) ? (help.workflows as unknown[]) : null
  if (workflows === null) problems.push("help.workflows must be a list")
  else {
    workflows.forEach((entry, index) => {
      const where = `help.workflows[${index}]`
      if (!isObject(entry)) {
        problems.push(`${where} must be an object`)
        return
      }
      rejectExtraKeys(entry, HELP_WORKFLOW_KEYS, where, problems)
      checkLocalized(entry.title, `${where}.title`, problems)
      if (entry.summary !== undefined && entry.summary !== null) checkLocalized(entry.summary, `${where}.summary`, problems)
      const surfaces = HELP_SURFACES.filter((surface) => entry[surface] !== undefined && entry[surface] !== null)
      if (surfaces.length === 0) problems.push(`${where}: a workflow must carry steps under at least one of ${HELP_SURFACES.join("/")}`)
      for (const surface of surfaces) checkLocalizedList(entry[surface], `${where}.${surface}`, problems)
    })
  }

  const commands = Array.isArray(help.commands) ? (help.commands as unknown[]) : null
  if (commands === null) problems.push("help.commands must be a list")
  else {
    commands.forEach((entry, index) => {
      const where = `help.commands[${index}]`
      if (!isObject(entry)) {
        problems.push(`${where} must be an object`)
        return
      }
      rejectExtraKeys(entry, HELP_COMMAND_KEYS, where, problems)
      checkLocalized(entry.title, `${where}.title`, problems)
      if (typeof entry.command !== "string" || entry.command.trim() === "") problems.push(`${where}.command must be the literal command line`)
      if (entry.description !== undefined && entry.description !== null) checkLocalized(entry.description, `${where}.description`, problems)
      const examples = Array.isArray(entry.examples) ? (entry.examples as unknown[]) : null
      if (examples === null) problems.push(`${where}.examples must be a list`)
      else {
        examples.forEach((example, exampleIndex) => {
          const exampleWhere = `${where}.examples[${exampleIndex}]`
          if (!isObject(example)) {
            problems.push(`${exampleWhere} must be an object`)
            return
          }
          rejectExtraKeys(example, HELP_EXAMPLE_KEYS, exampleWhere, problems)
          if (typeof example.command !== "string" || example.command.trim() === "") problems.push(`${exampleWhere}.command must be the literal command line`)
          if (example.label !== undefined && example.label !== null) checkLocalized(example.label, `${exampleWhere}.label`, problems)
          if (example.description !== undefined && example.description !== null) checkLocalized(example.description, `${exampleWhere}.description`, problems)
        })
      }
    })
  }

  if (help.safety !== undefined && help.safety !== null) {
    const where = "help.safety"
    if (!isObject(help.safety)) {
      problems.push(`${where} must be an object`)
      return
    }
    rejectExtraKeys(help.safety, HELP_SAFETY_KEYS, where, problems)
    const safety = help.safety
    if (safety.defaultMode !== undefined && safety.defaultMode !== null) {
      if (typeof safety.defaultMode !== "string" || safety.defaultMode.trim() === "") problems.push(`${where}.defaultMode must name a mode`)
    }
    for (const key of ["destructive", "notes"] as const) {
      if (safety[key] !== undefined && safety[key] !== null) checkLocalizedList(safety[key], `${where}.${key}`, problems)
    }
    if (safety.destructive === undefined && safety.notes === undefined) problems.push(`${where}: a safety block with neither destructive nor notes says nothing`)
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
    if ("helpKey" in entry) problems.push(`actions[${index}].helpKey is not accepted vocabulary: the node's help dictionary publishes no per-action prose, so action help is its "label" (ADR-0069)`)
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
      if ("message" in entry_rule && entry_rule.message !== null && entry_rule.message !== undefined) {
        checkLocalized(entry_rule.message, `${ruleWhere}.message`, problems)
      }
      for (const key of Object.keys(entry_rule)) {
        if (!["rule", "when", "message"].includes(key)) problems.push(`${ruleWhere} carries unknown key "${key}"`)
      }
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
      if ((kindName === "integerAtLeast" || kindName === "numberAtLeast") && typeof rule?.minimum !== "number") {
        problems.push(`${ruleWhere}: ${kindName} needs minimum`)
      }
      if (kindName === "atLeastLines" && typeof rule?.minimum !== "number") problems.push(`${ruleWhere}: atLeastLines needs minimum`)
    })

    // Forward references are legal: a field may be gated on one declared later, so references are
    // reported only by the pass below, once the whole id set is known.
  })

  // Deferred pass: visibility and rule conditions may forward-reference, so both are checked only once
  // every field id is known.
  fields.forEach((entry, index) => {
    if (!isObject(entry)) return
    const where = `fields[${index}]`
    const refs = new Set<string>()
    if (entry.visible) conditionFields(entry.visible, refs, [], `${where}.visible`)
    for (const [ruleIndex, item] of (Array.isArray(entry.rules) ? (entry.rules as unknown[]) : []).entries()) {
      if (isObject(item) && item.when) {
        conditionFields(item.when, refs, [], `${where}.rules[${ruleIndex}].when`)
      }
    }
    for (const reference of refs) {
      if (!declared.has(reference)) problems.push(`${where} reads undeclared field "${reference}"`)
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
    } else if (kindName === "all" || kindName === "any") {
      const refs = new Set<string>()
      const predicates = Array.isArray(danger.predicates) ? danger.predicates : null
      if (predicates === null) problems.push("danger.predicates must be a list of predicates")
      else {
        predicates.forEach((predicate, index) => {
          predicateFields(predicate, refs, problems, `danger.predicates[${index}]`)
        })
      }
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
  if (raw.dangerPromptExport !== undefined && raw.dangerPromptExport !== null) {
    if (typeof raw.dangerPromptExport !== "string" || raw.dangerPromptExport.trim() === "") {
      problems.push("dangerPromptExport must name the plugin export computing the prompt")
    }
    if (raw.dangerPrompt !== undefined && raw.dangerPrompt !== null) {
      problems.push("dangerPrompt and dangerPromptExport both set: a face cannot pick one")
    }
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

  // `dashboard` and `resultTable` are optional, so a definition authored before them still validates.
  const extraProblems: string[] = []
  if (raw.dashboard !== undefined && raw.dashboard !== null) {
    if (!isObject(raw.dashboard)) extraProblems.push("dashboard must be an object")
    else {
      checkLocalized(raw.dashboard.title, "dashboard.title", extraProblems)
      if (raw.dashboard.description !== undefined && raw.dashboard.description !== null) {
        checkLocalized(raw.dashboard.description, "dashboard.description", extraProblems)
      }
      const sources: Array<[string, unknown]> = [["dashboard.primary", raw.dashboard.primary]]
      if (raw.dashboard.secondary !== undefined && raw.dashboard.secondary !== null) {
        sources.push(["dashboard.secondary", raw.dashboard.secondary])
      }
      const metrics = Array.isArray(raw.dashboard.metrics) ? (raw.dashboard.metrics as unknown[]) : null
      if (metrics === null) extraProblems.push("dashboard.metrics must be a list")
      for (const [index, metric] of (metrics ?? []).entries()) {
        if (!isObject(metric)) extraProblems.push(`dashboard.metrics[${index}] must be an object`)
        else {
          checkLocalized(metric.label, `dashboard.metrics[${index}].label`, extraProblems)
          sources.push([`dashboard.metrics[${index}].source`, metric.source])
        }
      }
      const read = new Set<string>()
      for (const [owner, source] of sources) valueSourceFields(source, read, extraProblems, owner)
      for (const fieldId of read) {
        if (!declared.has(fieldId)) extraProblems.push(`dashboard reads undeclared field "${fieldId}"`)
      }
    }
  }
  if (raw.resultTable !== undefined && raw.resultTable !== null) {
    if (!isObject(raw.resultTable)) extraProblems.push("resultTable must be an object")
    else {
      const columns = Array.isArray(raw.resultTable.columns) ? raw.resultTable.columns : null
      if (columns === null) extraProblems.push("resultTable.columns must be a list")
      else {
        if (columns.length === 0) extraProblems.push("resultTable declares no columns")
        const seen = new Set<string>()
        columns.forEach((column, index) => {
          if (!isObject(column)) {
            extraProblems.push(`resultTable.columns[${index}] must be an object`)
            return
          }
          if (typeof column.id !== "string" || column.id.trim() === "") extraProblems.push(`resultTable.columns[${index}].id must be non-empty`)
          else if (seen.has(column.id)) extraProblems.push(`duplicate result column id "${column.id}"`)
          else seen.add(column.id)
          checkLocalized(column.label, `resultTable.columns[${index}].label`, extraProblems)
        })
      }
      if (raw.resultTable.emptyMessage !== undefined && raw.resultTable.emptyMessage !== null) {
        checkLocalized(raw.resultTable.emptyMessage, "resultTable.emptyMessage", extraProblems)
      }
    }
  }
  // `help` is optional in the language but required by the gate for every node that publishes a dictionary.
  if (raw.help !== undefined && raw.help !== null) checkHelpBlock(raw.help, extraProblems)
  problems.push(...extraProblems)
  return { problems: [...new Set(problems)] }
}

/** Parse and validate a definition document the caller has already read. */
export function parseAndValidateDefinition(raw: string): DefinitionReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { problems: [`definition.json is not valid JSON (${error instanceof Error ? error.message : String(error)})`] }
  }
  return validateNodeDefinition(parsed)
}
