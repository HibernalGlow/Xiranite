/**
 * Parity gate between a node's `interaction.ts` and the definition written to replace it (ADR-0069).
 *
 * ADR-0069 makes a falsifiable promise: a ported node keeps every action reachable and does not change the
 * danger semantics, while flag spellings may move. Nothing measured that promise: `audit:node-definitions`
 * says a definition exists and is well-formed, `audit:node-help-text` says its copy came from `help.ts`, and
 * neither asks whether the definition still says what the node's own terminal schema says. A definition that
 * quietly drops the `undo` action, or flips `dryRun === false` into `dryRun === true`, is well-formed data and
 * passes both.
 *
 * Three comparisons, each with the honesty rule attached:
 *
 * 1. **Actions** — the action selector's option values against `actions[].id`. In the schema but not in the
 *    definition is a missing capability and fails; in the definition but not in the schema is a node that
 *    gained an action and is only disclosed.
 * 2. **Fields** — every `fields[].id` must exist in the definition, and its `initialValues` default must equal
 *    `fields[].default` after normalising numbers and booleans to text. A dropped field or a silently changed
 *    default fails.
 * 3. **Danger** — `isDangerous`/`dangerPrompt` are closures. Their bodies are reduced to the gate grammar
 *    (see `lib/node-gate-form.ts`) and compared as structure; a body that does not reduce is **never** scored
 *    but lands in `needsManualReview` with `file:line` and the source text. `DangerGate::PluginExport` is the
 *    ADR's own escape hatch, and it is manual review too, because the export's body is not this file. A
 *    `dangerPrompt` is compared as copy only when the closure ignores its argument; a prompt that reads the
 *    input and is flattened into static text in the definition is a human decision, not a match.
 *
 * Structure, not string matching (ADR-0067): the vocabulary is the imported schema object, because that is
 * what the terminal actually renders; the syntax tree supplies closure text and lines. A node whose schema
 * module cannot be imported is reported as UNLOADABLE rather than skipped silently, and an empty scan throws.
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  definitionGateForm,
  formKey,
  gateFormText,
  isObject,
  scalarText,
  type Json,
} from "./lib/node-gate-form.ts"
import {
  analyzeDangerClosure,
  loadSchemaFacts,
  type DefinitionShape,
  type SchemaFacts,
} from "./lib/node-interaction-source.ts"

// ------------------------------------------------------------------ one node's verdict

export interface ManualReviewItem {
  nodeId: string
  /** `isDangerous` or `dangerPrompt`. */
  subject: string
  file: string
  line: number
  reason: string
  source: string
}

export interface NodeParity {
  nodeId: string
  interactionFile: string
  definitionPath: string
  definitionSource: "published" | "draft"
  /** Set when the node has nothing to compare (no schema in the file, or the module would not load). */
  failure: string | null
  actionFieldId: string | null
  actionFieldFrom: string
  schemaActions: string[]
  definitionActions: string[]
  missingActions: string[]
  addedActions: string[]
  schemaFields: string[]
  definitionFields: string[]
  missingFields: string[]
  addedFields: string[]
  /** Fields on both sides whose default was comparable as text. */
  defaultsCompared: number
  defaultProblems: string[]
  gateVerdict: "matched" | "mismatched" | "review" | "absent"
  gateSchema: string | null
  gateDefinition: string | null
  gateReason: string | null
  promptVerdict: "matched" | "mismatched" | "review" | "absent" | "declared-by-export"
  promptDetail: string | null
  manualReview: ManualReviewItem[]
  problems: string[]
  disclosed: string[]
}

const idsOf = (definition: Json, list: "actions" | "fields"): string[] =>
  (Array.isArray(definition[list]) ? definition[list] : [])
    .filter((entry): entry is Json => isObject(entry) && typeof entry.id === "string")
    .map((entry) => String(entry.id))

function definitionProjection(definition: Json): { defaults: Map<string, string | null>; kinds: Map<string, string>; slots: Map<string, string> } {
  const defaults = new Map<string, string | null>()
  const kinds = new Map<string, string>()
  for (const entry of Array.isArray(definition.fields) ? definition.fields : []) {
    if (!isObject(entry) || typeof entry.id !== "string") continue
    const hasDefault = "default" in entry && entry.default !== null && entry.default !== undefined
    defaults.set(entry.id, hasDefault ? scalarText(entry.default)?.text ?? null : null)
    kinds.set(entry.id, typeof entry.kind === "string" ? entry.kind : "")
  }
  const slots = new Map<string, string>()
  for (const entry of Array.isArray(definition.inputBindings) ? definition.inputBindings : []) {
    if (isObject(entry) && typeof entry.slot === "string" && typeof entry.fieldId === "string") slots.set(entry.slot, entry.fieldId)
  }
  return { defaults, kinds, slots }
}

/** Compare one node's terminal schema against one definition document. */
export function compareSchemaToDefinition(
  nodeId: string,
  facts: SchemaFacts,
  definition: Json | null,
  definitionPath: string,
  definitionSource: "published" | "draft",
): NodeParity {
  const parity: NodeParity = {
    nodeId,
    interactionFile: facts.interactionFile,
    definitionPath,
    definitionSource,
    failure: facts.failure,
    actionFieldId: facts.actionFieldId,
    actionFieldFrom: facts.actionFieldFrom,
    schemaActions: facts.actions,
    definitionActions: [],
    missingActions: [],
    addedActions: [],
    schemaFields: facts.fields.map((field) => field.id),
    definitionFields: [],
    missingFields: [],
    addedFields: [],
    defaultsCompared: 0,
    defaultProblems: [],
    gateVerdict: "absent",
    gateSchema: null,
    gateDefinition: null,
    gateReason: null,
    promptVerdict: "absent",
    promptDetail: null,
    manualReview: [],
    problems: [],
    disclosed: [],
  }

  if (facts.failure) {
    parity.problems.push(`UNLOADABLE: ${facts.failure} (${facts.interactionFile}).`)
    return parity
  }
  if (!definition) {
    parity.failure = "definition could not be read"
    parity.problems.push(`UNREADABLE DEFINITION: ${definitionPath} is not readable JSON, so nothing was compared.`)
    return parity
  }

  const projected = definitionProjection(definition)
  const definitionActions = idsOf(definition, "actions")
  const definitionFields = idsOf(definition, "fields")
  parity.definitionActions = definitionActions
  parity.definitionFields = definitionFields
  const shape: DefinitionShape = {
    fieldKinds: projected.kinds,
    schemaKinds: new Map(facts.fields.map((field) => [field.id, field.kind])),
    slotToField: projected.slots,
  }

  // 1. actions
  const schemaActionSet = new Set(facts.actions)
  const definitionActionSet = new Set(definitionActions)
  parity.missingActions = facts.actions.filter((id) => !definitionActionSet.has(id))
  parity.addedActions = definitionActions.filter((id) => !schemaActionSet.has(id))
  for (const id of parity.missingActions) {
    parity.problems.push(`MISSING ACTION "${id}" is offered by ${facts.interactionFile} but the definition declares no such action.`)
  }
  for (const id of parity.addedActions) parity.disclosed.push(`action "${id}" is in the definition but not in the schema (a node may gain an action)`)
  if (!facts.actionFieldId && definitionActions.length > 0) {
    parity.disclosed.push(`the schema has no action selector, so its ${definitionActions.length} declared action(s) are not reachable through it`)
  }

  // 2. fields and defaults
  for (const field of facts.fields) {
    if (!definitionFields.includes(field.id)) {
      parity.missingFields.push(field.id)
      parity.problems.push(`MISSING FIELD "${field.id}" is a field of ${facts.interactionFile} that the definition dropped.`)
      continue
    }
    const declared = projected.defaults.get(field.id) ?? null
    if (field.defaultText === null) {
      if (declared !== null) parity.disclosed.push(`field "${field.id}" has a default in the definition the schema does not start it with`)
      continue
    }
    parity.defaultsCompared += 1
    if (declared === null) {
      // An absent default only matters when the node actually prefills something: `""` is what a text field
      // without a default means anyway, so that equivalence is disclosed rather than failed.
      if (field.defaultText !== "") {
        parity.defaultProblems.push(`DEFAULT UNDECLARED for "${field.id}": the schema starts it at ${JSON.stringify(field.defaultText)} and the definition declares no default.`)
      } else {
        parity.disclosed.push(`field "${field.id}" declares no default, which matches the schema's empty starting value`)
      }
      continue
    }
    if (declared !== field.defaultText) {
      parity.defaultProblems.push(`DEFAULT CHANGED for "${field.id}": the schema starts it at ${JSON.stringify(field.defaultText)} but the definition says ${JSON.stringify(declared)}.`)
    }
  }
  parity.problems.push(...parity.defaultProblems)
  for (const id of definitionFields) {
    if (!parity.schemaFields.includes(id)) {
      parity.addedFields.push(id)
      parity.disclosed.push(`field "${id}" is in the definition but not in the schema`)
    }
  }

  // 3. the gate
  const definitionGate = definitionGateForm(definition)
  parity.gateDefinition = definitionGate.form ? gateFormText(definitionGate.form) : null
  const analysed = analyzeDangerClosure(facts, shape)
  parity.gateSchema = analysed.form ? gateFormText(analysed.form) : null

  if (analysed.reason === "the node declares no isDangerous") {
    if (!definitionGate.form || definitionGate.form.length === 0) {
      parity.gateVerdict = "matched"
    } else {
      parity.gateVerdict = "review"
      parity.gateReason = "the schema declares no isDangerous, so nothing backs the definition's gate"
      parity.manualReview.push({
        nodeId,
        subject: "isDangerous",
        file: facts.interactionFile,
        line: 0,
        reason: parity.gateReason,
        source: definitionGate.reason ?? gateFormText(definitionGate.form),
      })
    }
  } else if (!analysed.form) {
    parity.gateVerdict = "review"
    parity.gateReason = analysed.reason
    parity.manualReview.push({
      nodeId,
      subject: "isDangerous",
      file: facts.interactionFile,
      line: analysed.line,
      reason: analysed.reason ?? "the body did not reduce to the gate grammar",
      source: analysed.text,
    })
  } else if (!definitionGate.form) {
    parity.gateVerdict = "review"
    parity.gateReason = definitionGate.reason
    parity.manualReview.push({
      nodeId,
      subject: "isDangerous",
      file: facts.interactionFile,
      line: analysed.line,
      reason: definitionGate.reason ?? "the definition gate could not be read",
      source: analysed.text,
    })
  } else if (formKey(analysed.form) === formKey(definitionGate.form)) {
    parity.gateVerdict = "matched"
  } else {
    parity.gateVerdict = "mismatched"
    parity.problems.push(
      `DANGER GATE MISMATCH: ${facts.interactionFile}:${analysed.line} asks when ${gateFormText(analysed.form)}, `
        + `but the definition declares ${gateFormText(definitionGate.form)}.`,
    )
  }

  // 3b. the prompt
  comparePrompt(parity, facts, definition)
  return parity
}

/**
 * Presence is decidable; copy is decidable only when the closure ignores its argument; a definition that
 * carries static text for a node whose text depends on the action is a flattening a human has to confirm.
 */
function comparePrompt(parity: NodeParity, facts: SchemaFacts, definition: Json): void {
  const hasDeclared = isObject(definition.dangerPrompt)
  const hasExport = typeof definition.dangerPromptExport === "string" && definition.dangerPromptExport.trim() !== ""
  if (hasDeclared && hasExport) parity.disclosed.push("dangerPrompt and dangerPromptExport are both set, so a face cannot pick one")

  if (!facts.prompt) {
    parity.promptVerdict = "absent"
    if (hasDeclared) parity.disclosed.push("dangerPrompt copy is in the definition but the schema has no dangerPrompt to source it")
    if (hasExport) parity.disclosed.push(`dangerPromptExport "${definition.dangerPromptExport}" is set but the schema has no dangerPrompt`)
    return
  }
  if (!hasDeclared && !hasExport) {
    parity.promptVerdict = "mismatched"
    parity.problems.push(
      `DANGER PROMPT MISSING: ${facts.interactionFile}:${facts.prompt.line} builds a confirmation dialog, `
        + "but the definition carries neither dangerPrompt nor dangerPromptExport.",
    )
    return
  }
  if (hasExport && !hasDeclared) {
    parity.promptVerdict = "declared-by-export"
    parity.promptDetail =
      `the definition asks plugin export "${definition.dangerPromptExport}" for the copy`
      + (facts.prompt.paramDependent ? ", which is the right shape for a prompt that reads its argument" : ", although this prompt ignores its argument and could have been data")
    parity.disclosed.push(parity.promptDetail)
    return
  }
  if (facts.prompt.paramDependent) {
    parity.promptVerdict = "review"
    parity.manualReview.push({
      nodeId: parity.nodeId,
      subject: "dangerPrompt",
      file: facts.interactionFile,
      line: facts.prompt.line,
      reason: "the prompt text depends on the input, so a static dangerPrompt cannot be proven to match it",
      source: facts.prompt.text,
    })
    return
  }
  if (!facts.prompt.copy) {
    parity.promptVerdict = "review"
    parity.manualReview.push({
      nodeId: parity.nodeId,
      subject: "dangerPrompt",
      file: facts.interactionFile,
      line: facts.prompt.line,
      reason: facts.prompt.copyFailure ?? "the prompt copy could not be evaluated",
      source: facts.prompt.text,
    })
    return
  }

  const declared = definition.dangerPrompt as Json
  const drift: string[] = []
  for (const key of ["title", "body", "confirmLabel"] as const) {
    const localized = isObject(declared[key]) ? declared[key] : null
    if (!localized) {
      drift.push(`${key} is missing from the definition`)
      continue
    }
    for (const locale of ["zh", "en"] as const) {
      const wanted = facts.prompt.copy[locale][key]
      const found = localized[locale]
      if (typeof wanted !== "string") {
        drift.push(`${key}.${locale} is not a string in the schema`)
        continue
      }
      if (typeof found !== "string" || found !== wanted) drift.push(`${key}.${locale} = ${JSON.stringify(found)} but the node writes ${JSON.stringify(wanted)}`)
    }
  }
  if (drift.length > 0) {
    parity.promptVerdict = "mismatched"
    parity.problems.push(`DANGER PROMPT TEXT at ${facts.interactionFile}:${facts.prompt.line}: ${drift.join("; ")}.`)
    return
  }
  parity.promptVerdict = "matched"
}

// ------------------------------------------------------------------ scan

export interface ParityOptions {
  nodesRoot: string
  pluginsRoot: string
  draftsRoot: string
}

export interface ParityReport {
  /** Node ids scanned: an `interaction.ts` and a definition both exist and the schema was read. */
  scanned: string[]
  entries: NodeParity[]
  /** Nodes with an `interaction.ts` but no definition yet — out of scope, disclosed. */
  withoutDefinition: string[]
  /** Nodes with a definition but no terminal schema to compare it with. */
  withoutSchema: string[]
  manualReview: ManualReviewItem[]
  counts: {
    actionsCompared: number
    fieldsCompared: number
    defaultsCompared: number
    gateMatched: number
    gateMismatched: number
    gateReview: number
    promptMatched: number
    promptMismatched: number
    promptReview: number
    promptByExport: number
    missingActions: number
    addedActions: number
    missingFields: number
    addedFields: number
    defaultProblems: number
    problems: number
    failingNodes: number
  }
}

/** Published wins over the draft, exactly as in `audit:node-definitions`. */
async function locateDefinition(nodeId: string, options: ParityOptions): Promise<{ path: string; source: "published" | "draft" } | null> {
  const published = join(options.pluginsRoot, nodeId, "definition.json")
  if (await Bun.file(published).exists()) return { path: published, source: "published" }
  const draft = join(options.draftsRoot, `${nodeId}.json`)
  if (await Bun.file(draft).exists()) return { path: draft, source: "draft" }
  return null
}

async function readDefinition(path: string): Promise<Json | null> {
  const raw = await readFile(path, "utf8").catch(() => null)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function auditInteractionParity(options: ParityOptions): Promise<ParityReport> {
  const nodes = (await readdir(options.nodesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  const entries: NodeParity[] = []
  const withoutDefinition: string[] = []
  const withoutSchema: string[] = []

  for (const nodeId of nodes) {
    const interactionFile = join(options.nodesRoot, nodeId, "src", "interaction.ts")
    const source = await readFile(interactionFile, "utf8").catch(() => null)
    if (source === null) {
      if (await locateDefinition(nodeId, options)) withoutSchema.push(nodeId)
      continue
    }
    const located = await locateDefinition(nodeId, options)
    if (!located) {
      withoutDefinition.push(nodeId)
      continue
    }
    const facts = await loadSchemaFacts(nodeId, interactionFile, source)
    if (facts.schemaless) {
      withoutSchema.push(nodeId)
      continue
    }
    const definition = await readDefinition(located.path)
    entries.push(compareSchemaToDefinition(nodeId, facts, definition, located.path, located.source))
  }

  const summed = (project: (entry: NodeParity) => number): number => entries.reduce((total, entry) => total + project(entry), 0)
  const counted = (predicate: (entry: NodeParity) => boolean): number => entries.filter(predicate).length

  return {
    scanned: entries.map((entry) => entry.nodeId),
    entries,
    withoutDefinition,
    withoutSchema,
    manualReview: entries.flatMap((entry) => entry.manualReview),
    counts: {
      actionsCompared: summed((entry) => new Set([...entry.schemaActions, ...entry.definitionActions]).size),
      fieldsCompared: summed((entry) => new Set([...entry.schemaFields, ...entry.definitionFields]).size),
      defaultsCompared: summed((entry) => entry.defaultsCompared),
      gateMatched: counted((entry) => entry.gateVerdict === "matched"),
      gateMismatched: counted((entry) => entry.gateVerdict === "mismatched"),
      gateReview: counted((entry) => entry.gateVerdict === "review"),
      promptMatched: counted((entry) => entry.promptVerdict === "matched"),
      promptMismatched: counted((entry) => entry.promptVerdict === "mismatched"),
      promptReview: counted((entry) => entry.promptVerdict === "review"),
      promptByExport: counted((entry) => entry.promptVerdict === "declared-by-export"),
      missingActions: summed((entry) => entry.missingActions.length),
      addedActions: summed((entry) => entry.addedActions.length),
      missingFields: summed((entry) => entry.missingFields.length),
      addedFields: summed((entry) => entry.addedFields.length),
      defaultProblems: summed((entry) => entry.defaultProblems.length),
      problems: summed((entry) => entry.problems.length),
      failingNodes: counted((entry) => entry.problems.length > 0),
    },
  }
}

/** Refuse an empty scan, the same mistake that made the HTTP-surface analyzer report zero routes as success. */
export function assertNonEmptyScan(report: ParityReport, nodesRoot: string): void {
  if (report.scanned.length === 0) {
    throw new Error(`audit:node-interaction-parity found no node with both an interaction.ts and a definition under ${nodesRoot} — the scan path is wrong, not the parity.`)
  }
}

if (import.meta.main) {
  const options: ParityOptions = {
    nodesRoot: join(process.cwd(), "packages/nodes"),
    pluginsRoot: join(process.cwd(), "plugins"),
    draftsRoot: join(process.cwd(), "node-definitions"),
  }
  const report = await auditInteractionParity(options)
  assertNonEmptyScan(report, options.nodesRoot)

  for (const entry of report.entries) {
    for (const problem of entry.problems) console.error(`FAIL  ${entry.nodeId}: ${problem}`)
  }
  for (const item of report.manualReview) {
    console.log(`REVIEW ${item.nodeId} ${item.subject} at ${item.file}:${item.line} — ${item.reason} — ${JSON.stringify(item.source.slice(0, 180))}`)
  }
  for (const entry of report.entries) {
    for (const line of entry.disclosed) console.log(`DEBT  ${entry.nodeId}: ${line}`)
    if (entry.gateReason && entry.gateVerdict === "review") console.log(`DEBT  ${entry.nodeId}: gate not compared — ${entry.gateReason}.`)
  }
  for (const nodeId of report.withoutDefinition) console.log(`DEBT  ${nodeId}: has packages/nodes/${nodeId}/src/interaction.ts but no definition yet, so nothing is compared.`)
  for (const nodeId of report.withoutSchema) console.log(`DEBT  ${nodeId}: has a definition but no readable terminal schema in its interaction.ts.`)

  if (process.argv.includes("--report")) {
    // The verdicts side by side, so a reviewer can see what each "matched" actually compared.
    for (const entry of report.entries) {
      console.log(
        `NODE  ${entry.nodeId} (${entry.definitionSource}) actions ${entry.schemaActions.length}→${entry.definitionActions.length} `
          + `fields ${entry.schemaFields.length}→${entry.definitionFields.length} `
          + `gate ${entry.gateVerdict} [schema: ${entry.gateSchema ?? "—"} | definition: ${entry.gateDefinition ?? "—"}] `
          + `prompt ${entry.promptVerdict}`,
      )
    }
  }

  const counts = report.counts
  console.log(
    `Interaction parity: ${report.scanned.length} node(s) scanned, ${counts.actionsCompared} action id(s) and ${counts.fieldsCompared} field id(s) compared `
      + `(${counts.defaultsCompared} defaults); gates ${counts.gateMatched} matched / ${counts.gateMismatched} mismatched / ${counts.gateReview} in review, `
      + `prompts ${counts.promptMatched} matched / ${counts.promptMismatched} mismatched / ${counts.promptReview} in review / ${counts.promptByExport} delegated to an export; `
      + `${counts.missingActions} missing action(s), ${counts.addedActions} added action(s), ${counts.missingFields} dropped field(s), ${counts.addedFields} extra field(s), `
      + `${counts.defaultProblems} default problem(s), ${report.manualReview.length} manual-review item(s), `
      + `${counts.problems} problem(s) in ${counts.failingNodes} node(s); ${report.withoutDefinition.length} node(s) still without a definition, ${report.withoutSchema.length} definition(s) without a schema.`,
  )
  if (counts.problems > 0) throw new Error(`audit:node-interaction-parity found ${counts.problems} parity problem(s) in ${counts.failingNodes} node(s).`)
}
