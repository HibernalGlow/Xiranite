/**
 * Gate for ADR-0069's rule that a node's help dictionary is the one vocabulary, and the
 * publisher of `definition.help` — the block the Rust faces read to print `--help` and the TUI help card.
 *
 * `packages/nodes/<id>/src/help.ts` is node-authored content feeding the terminal `--help` and the in-app
 * help card, and the rewritten CLI/TUI/GUI faces must render it rather than reword it. Measured before this
 * gate existed: of 41 definition files, 0 carried text equal to the dictionary it was transcribed from
 * (14 titles, 38 English descriptions, 36 Chinese descriptions had drifted). A definition still carries the
 * strings, because a published plugin must be readable without the TypeScript workspace — so the strings are
 * duplicated on purpose and this gate is what makes that duplication safe: every value must be one the
 * dictionary produces for that locale, resolved with the contract's own `localizeNodeHelp`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { localizeNodeHelp, type NodeHelp } from "../packages/contract/src/index.ts"

export interface LocalizedText {
  zh: string
  en: string
}

export interface HelpTextProblem {
  nodeId: string
  field: "title" | "description"
  locale: keyof LocalizedText
  found: string
  accepted: string[]
}

export interface NodeHelpTextReport {
  nodeId: string
  definitionPath: string
  problems: HelpTextProblem[]
  /** The node ships no `NodeHelp` module, so nothing can back its definition text. */
  missingDictionary: boolean
  /** help.ts puts non-ASCII text in the base (English) fields, so the `en` side of the definition is not English. */
  nonEnglishBase: boolean
  /** `definition.help` lines that no longer match the dictionary, by JSON path. */
  helpDrift: string[]
  /** The node publishes a dictionary but its definition carries no `help` block. */
  missingHelpBlock: boolean
  /** Partial translations the derived block had to mirror into the other language. */
  disclosures: HelpDisclosure[]
}

/** A `{zh: string[], en: string[]}` list as it is published inside `definition.help`. */
export interface LocalizedList {
  zh: string[]
  en: string[]
}

/**
 * Something about a published help entry worth reading rather than failing on: either the dictionary translates
 * only part of its prose (so a side was filled from the English base), or the two languages genuinely list a
 * different number of steps. Both stay verbatim quotes of what the node authored.
 */
export interface HelpDisclosure {
  path: string
  reason: "no Chinese side" | "sides list a different number of steps" | "sides list a different number of entries"
}

export interface HelpTextOptions {
  definitionsRoot: string
  nodesRoot: string
  baselinePath: string
}

/**
 * The text a node's help dictionary publishes per locale. `short` and `description` are both accepted for the
 * description side: they are equal for most nodes, and a definition may legitimately quote either.
 */
export function acceptedHelpText(help: NodeHelp): { title: LocalizedText; description: { zh: string[]; en: string[] } } {
  const english = localizeNodeHelp(help, "en")
  const chinese = localizeNodeHelp(help, "zh")
  const descriptions = (view: NodeHelp): string[] => [...new Set([view.short, view.description].filter((text): text is string => typeof text === "string" && text.trim() !== ""))]
  return {
    title: { en: english.title, zh: chinese.title },
    description: { en: descriptions(english), zh: descriptions(chinese) },
  }
}

export function checkNodeHelpText(nodeId: string, definitionPath: string, definition: Record<string, unknown>, help: NodeHelp | null): NodeHelpTextReport {
  if (help === null) {
    return { nodeId, definitionPath, problems: [], missingDictionary: true, nonEnglishBase: false, helpDrift: [], missingHelpBlock: false, disclosures: [] }
  }

  const expected = acceptedHelpText(help)
  const problems: HelpTextProblem[] = []
  for (const locale of ["zh", "en"] as const) {
    const title = (definition.title ?? {}) as Partial<LocalizedText>
    if (typeof title[locale] !== "string" || title[locale] !== expected.title[locale]) {
      problems.push({ nodeId, field: "title", locale, found: String(title[locale] ?? ""), accepted: [expected.title[locale]] })
    }
    const description = (definition.description ?? {}) as Partial<LocalizedText>
    if (typeof description[locale] !== "string" || !expected.description[locale].includes(description[locale])) {
      problems.push({ nodeId, field: "description", locale, found: String(description[locale] ?? ""), accepted: expected.description[locale] })
    }
  }
  const derived = deriveHelpBlock(help)
  const published = definition.help
  const missingHelpBlock = published === undefined || published === null
  const helpDrift = missingHelpBlock ? [] : describeHelpDrift(published, derived.block)

  return {
    nodeId,
    definitionPath,
    problems,
    missingDictionary: false,
    nonEnglishBase: !/^[\x20-\x7E]*$/.test(help.short),
    helpDrift,
    missingHelpBlock,
    disclosures: derived.disclosures,
  }
}

/**
 * Drop every `actions[].helpKey`.
 *
 * The measured state was 174 of them across 41 definitions, each one literally `action.<id>` — a name derived
 * from the id it sits next to, pointing into a dictionary (`packages/nodes/<id>/src/help.ts`) that publishes no
 * per-action prose to resolve it against. Keeping it would have made the CLI and the TUI print help that does
 * not exist; the contract now rejects the key (ADR-0069), so this is the one-time strip the definitions need.
 */
export function withoutActionHelpKeys(definition: Record<string, unknown>): Record<string, unknown> {
  const actions = Array.isArray(definition.actions) ? definition.actions : []
  if (!actions.some((action) => isObject(action) && "helpKey" in action)) return definition
  return {
    ...definition,
    actions: actions.map((action) => {
      if (!isObject(action) || !("helpKey" in action)) return action
      const { helpKey: _dropped, ...rest } = action
      return rest
    }),
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Rewrite only the values the dictionary does not publish, so a deliberate `description`-side quote is not churned. */
export function withHelpTextSourced(definition: Record<string, unknown>, help: NodeHelp): Record<string, unknown> {
  const expected = acceptedHelpText(help)
  const derived = deriveHelpBlock(help)
  const next = structuredClone(definition) as Record<string, unknown>
  for (const locale of ["zh", "en"] as const) {
    const title = (next.title ?? {}) as Partial<LocalizedText>
    if (typeof title[locale] !== "string" || title[locale] !== expected.title[locale]) {
      next.title = { ...(next.title as object), [locale]: expected.title[locale] }
    }
    const description = (next.description ?? {}) as Partial<LocalizedText>
    if (typeof description[locale] !== "string" || !expected.description[locale].includes(description[locale])) {
      next.description = { ...(next.description as object), [locale]: expected.description[locale][0] ?? expected.title[locale] }
    }
  }
  // The whole block is replaced, not merged: a key the dictionary no longer publishes must leave the file.
  if (Object.keys(derived.block).length === 0) delete next.help
  else next.help = derived.block
  return next
}

const HELP_SURFACES = ["ui", "cli", "tips"] as const

const isFilled = (text: unknown): text is string => typeof text === "string" && text.trim() !== ""
const linesOf = (value: unknown): string[] => (Array.isArray(value) ? value : []).filter(isFilled)
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Both sides of a localized pair, mirroring whichever language the dictionary left blank. */
function localizedPair(zh: string | undefined, en: string | undefined, disclosures: HelpDisclosure[], path: string): LocalizedText | null {
  if (!isFilled(zh) && !isFilled(en)) return null
  if (!isFilled(en) || !isFilled(zh)) {
    disclosures.push({ path, reason: "no Chinese side" })
    const text = isFilled(en) ? en : (zh ?? "")
    return { zh: text, en: text }
  }
  return { zh: zh ?? "", en: en ?? "" }
}

/**
 * A list of steps, published as each language authored it.
 *
 * No padding and no truncation: the legacy terminal page prints `localizeNodeHelp(help, locale)`'s own array, so
 * a node whose Chinese side lists three examples where English lists two gets three in Chinese and two in English
 * — measured on classf, whose `zh-CN` commands list differs from its base. Padding to one shape would delete
 * node-authored prose, which is the one thing this block exists to prevent. A language that omits the key entirely
 * still comes back as the base text, because that is what `localizeNodeHelp` itself falls back to.
 */
function localizedList(zh: readonly string[] | undefined, en: readonly string[] | undefined, disclosures: HelpDisclosure[], path: string): LocalizedList | null {
  const chinese = linesOf(zh)
  const english = linesOf(en)
  if (chinese.length === 0 && english.length === 0) return null
  if (chinese.length !== english.length) disclosures.push({ path, reason: "sides list a different number of steps" })
  return { zh: chinese, en: english }
}

/**
 * The `definition.help` block a dictionary implies, with every string turned into a `{zh, en}` pair.
 *
 * The English side comes from the base fields and the Chinese side from `translations["zh-CN"]`, both read
 * through `localizeNodeHelp` so this resolves locales exactly the way the app's help card does. A node whose
 * dictionary translates only part of its prose still gets a complete block; the mirrored entries come back as
 * disclosures rather than failures, because the text stays a verbatim quote of what the node authored.
 */
export function deriveHelpBlock(help: NodeHelp): { block: Record<string, unknown>; disclosures: HelpDisclosure[] } {
  const english = localizeNodeHelp(help, "en")
  const chinese = localizeNodeHelp(help, "zh")
  // `localizeNodeHelp` falls back to the base fields key by key, so a field the translation omits comes back
  // as English text rather than `undefined`. Existence is read from the raw translation to know which
  // paragraphs the node never wrote in Chinese — that is what the disclosure has to name.
  const translated = help.translations?.["zh-CN"]
  const disclosures: HelpDisclosure[] = []
  const untranslated = (path: string): void => {
    disclosures.push({ path, reason: "no Chinese side" })
  }
  const block: Record<string, unknown> = {}

  if (translated?.whenToUse === undefined && linesOf(english.whenToUse).length > 0) untranslated("help.whenToUse")
  const whenToUse = localizedList(chinese.whenToUse, english.whenToUse, disclosures, "help.whenToUse")
  if (whenToUse !== null) block.whenToUse = whenToUse

  if ((chinese.workflows?.length ?? 0) !== (english.workflows?.length ?? 0)) {
    disclosures.push({ path: "help.workflows", reason: "sides list a different number of entries" })
  }
  const workflows = english.workflows.map((entry, index) => {
    const counterpart = chinese.workflows[index]
    const where = `help.workflows[${index}]`
    const workflow: Record<string, unknown> = {}
    const wholeEntryMissing = translated?.workflows?.[index] === undefined
    if (wholeEntryMissing) untranslated(where)
    const title = localizedPair(counterpart?.title, entry.title, wholeEntryMissing ? [] : disclosures, `${where}.title`)
    if (title !== null) workflow.title = title
    const summary = localizedPair(counterpart?.summary, entry.summary, wholeEntryMissing ? [] : disclosures, `${where}.summary`)
    if (summary !== null) workflow.summary = summary
    for (const surface of HELP_SURFACES) {
      const steps = localizedList(counterpart?.[surface], entry[surface], wholeEntryMissing ? [] : disclosures, `${where}.${surface}`)
      if (steps !== null) workflow[surface] = steps
    }
    return workflow
  })
  if (workflows.length > 0) block.workflows = workflows

  if ((chinese.commands?.length ?? 0) !== (english.commands?.length ?? 0)) {
    disclosures.push({ path: "help.commands", reason: "sides list a different number of entries" })
  }
  const commands = english.commands.map((entry, index) => {
    const counterpart = chinese.commands[index]
    const where = `help.commands[${index}]`
    const command: Record<string, unknown> = {}
    const wholeEntryMissing = translated?.commands?.[index] === undefined
    if (wholeEntryMissing) untranslated(where)
    const inside = wholeEntryMissing ? [] : disclosures
    const title = localizedPair(counterpart?.title, entry.title, inside, `${where}.title`)
    if (title !== null) command.title = title
    if (isFilled(entry.command)) command.command = entry.command
    const description = localizedPair(counterpart?.description, entry.description, inside, `${where}.description`)
    if (description !== null) command.description = description
    if ((counterpart?.examples.length ?? 0) !== entry.examples.length) {
      disclosures.push({ path: `${where}.examples`, reason: "sides list a different number of entries" })
    }
    command.examples = entry.examples.map((example, exampleIndex) => {
      const shown = counterpart?.examples[exampleIndex]
      const exampleWhere = `${where}.examples[${exampleIndex}]`
      const item: Record<string, unknown> = {}
      const label = localizedPair(shown?.label, example.label, inside, `${exampleWhere}.label`)
      if (label !== null) item.label = label
      if (isFilled(example.command)) item.command = example.command
      const note = localizedPair(shown?.description, example.description, inside, `${exampleWhere}.description`)
      if (note !== null) item.description = note
      return item
    })
    return command
  })
  if (commands.length > 0) block.commands = commands

  const safety: Record<string, unknown> = {}
  if (translated?.safety === undefined && (english.safety?.notes?.length ?? 0) + (english.safety?.destructive?.length ?? 0) > 0) {
    untranslated("help.safety")
  }
  const mode = english.safety?.defaultMode ?? chinese.safety?.defaultMode
  if (isFilled(mode)) safety.defaultMode = mode
  const destructive = localizedList(chinese.safety?.destructive, english.safety?.destructive, disclosures, "help.safety.destructive")
  if (destructive !== null) safety.destructive = destructive
  const notes = localizedList(chinese.safety?.notes, english.safety?.notes, disclosures, "help.safety.notes")
  if (notes !== null) safety.notes = notes
  if (Object.keys(safety).length > 0) block.safety = safety

  return { block, disclosures }
}

/** JSON paths where a published `help` block stopped matching the dictionary it was derived from. */
export function describeHelpDrift(published: unknown, derived: unknown, path = "help"): string[] {
  const problems: string[] = []
  if (Array.isArray(published) && Array.isArray(derived)) {
    if (published.length !== derived.length) {
      problems.push(`${path} carries ${published.length} entr${published.length === 1 ? "y" : "ies"} but the dictionary publishes ${derived.length}`)
    }
    for (const [index, item] of derived.entries()) problems.push(...describeHelpDrift(published[index], item, `${path}[${index}]`))
    return problems
  }
  if (isRecord(published) && isRecord(derived)) {
    for (const key of Object.keys(derived)) {
      if (!(key in published)) problems.push(`${path}.${key} is missing from the definition`)
      else problems.push(...describeHelpDrift(published[key], derived[key], `${path}.${key}`))
    }
    for (const key of Object.keys(published)) {
      if (!(key in derived)) problems.push(`${path}.${key} is not published by the dictionary`)
    }
    return problems
  }
  if (JSON.stringify(published) !== JSON.stringify(derived)) {
    problems.push(`${path} = ${JSON.stringify(published)} is not the dictionary's ${JSON.stringify(derived)}`)
  }
  return problems
}

interface DefinitionLocation {
  nodeId: string
  path: string
}

/**
 * Nodes whose help dictionary does not exist yet. Disclosed debt, like the UI-coupling baseline: the gate
 * fails on a *new* node without a dictionary instead of pretending the scan is clean.
 */
export async function readMissingDictionaryBaseline(baselinePath: string): Promise<string[]> {
  const raw = await readFile(baselinePath, "utf8").catch(() => null)
  if (raw === null) return []
  const parsed = JSON.parse(raw) as { nodesWithoutDictionary?: unknown }
  return Array.isArray(parsed.nodesWithoutDictionary) ? parsed.nodesWithoutDictionary.filter((id): id is string => typeof id === "string") : []
}

async function collectDefinitionLocations(options: HelpTextOptions): Promise<DefinitionLocation[]> {
  const locations: DefinitionLocation[] = []
  const drafts = await readdir(options.definitionsRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of drafts.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    locations.push({ nodeId: entry.name.slice(0, -".json".length), path: join(options.definitionsRoot, entry.name) })
  }
  // `node-definitions/` is the only definition home since the Extism `plugins/` tree was deleted on
  // 2026-10-05; its `definition.json` files were byte-identical duplicates of these.
  return locations
}

async function loadHelpDictionary(nodesRoot: string, nodeId: string): Promise<NodeHelp | null> {
  const module = await import(pathToFileURL(join(nodesRoot, nodeId, "src", "help.ts")).href).catch(() => null)
  const help = (module as { help?: NodeHelp } | null)?.help
  return help && typeof help.title === "string" ? help : null
}

export async function auditNodeHelpText(options: HelpTextOptions): Promise<NodeHelpTextReport[]> {
  const reports: NodeHelpTextReport[] = []
  for (const location of await collectDefinitionLocations(options)) {
    const raw = await readFile(location.path, "utf8").catch(() => null)
    if (raw === null) continue
    let definition: Record<string, unknown> | null = null
    try {
      definition = JSON.parse(raw) as Record<string, unknown>
    } catch {
      reports.push({
        nodeId: location.nodeId,
        definitionPath: location.path,
        problems: [{ nodeId: location.nodeId, field: "title", locale: "en", found: "", accepted: ["definition.json must be valid JSON"] }],
        missingDictionary: false,
        nonEnglishBase: false,
        helpDrift: [],
        missingHelpBlock: false,
        disclosures: [],
      })
      continue
    }
    const help = await loadHelpDictionary(options.nodesRoot, location.nodeId)
    reports.push(checkNodeHelpText(location.nodeId, location.path, definition, help))
  }
  return reports
}

export async function applyHelpText(options: HelpTextOptions): Promise<number> {
  let rewritten = 0
  for (const location of await collectDefinitionLocations(options)) {
    const raw = await readFile(location.path, "utf8").catch(() => null)
    if (raw === null) continue
    // Stripping `helpKey` is independent of the dictionary, so it runs even for a node without one.
    const stripped = withoutActionHelpKeys(JSON.parse(raw) as Record<string, unknown>)
    const help = await loadHelpDictionary(options.nodesRoot, location.nodeId)
    const next = help === null ? stripped : withHelpTextSourced(stripped, help)
    const serialized = `${JSON.stringify(next, null, 2)}\n`
    if (serialized !== raw) {
      await writeFile(location.path, serialized, "utf8")
      rewritten += 1
    }
  }
  return rewritten
}

if (import.meta.main) {
  const options: HelpTextOptions = {
    definitionsRoot: join(process.cwd(), "node-definitions"),
    nodesRoot: join(process.cwd(), "packages", "nodes"),
    baselinePath: join(process.cwd(), "docs", "node-help-text-baseline.json"),
  }
  if (process.argv.includes("--apply")) {
    console.log(`help text: rewrote ${await applyHelpText(options)} definition file(s) from the node dictionaries.`)
  }

  const baseline = await readMissingDictionaryBaseline(options.baselinePath)
  const reports = await auditNodeHelpText(options)
  if (reports.length === 0) {
    throw new Error("audit:node-help-text scanned node-definitions/ and plugins/ and found no definitions: an empty scan must not read as a passing gate.")
  }

  const drifted = reports.filter((report) => report.problems.length > 0)
  const missing = reports.filter((report) => report.missingDictionary)
  const unbaselinedMissing = missing.filter((report) => !baseline.includes(report.nodeId))
  const staleBaseline = baseline.filter((nodeId) => !missing.some((report) => report.nodeId === nodeId))

  for (const report of drifted) {
    for (const problem of report.problems) {
      console.error(`FAIL  ${report.nodeId}: ${problem.field}.${problem.locale} = ${JSON.stringify(problem.found)} is not published by the node's help dictionary (accepted: ${problem.accepted.map((text) => JSON.stringify(text)).join(" | ")}).`)
    }
  }
  const driftedHelp = reports.filter((report) => report.helpDrift.length > 0)
  const withoutBlock = reports.filter((report) => report.missingHelpBlock)
  for (const report of driftedHelp) {
    for (const problem of report.helpDrift) {
      console.error(`FAIL  ${report.nodeId}: ${problem}`)
    }
  }
  for (const report of withoutBlock) {
    console.error(`FAIL  ${report.nodeId}: packages/nodes/${report.nodeId}/src/help.ts publishes usage documentation but ${report.definitionPath} carries no "help" block, so no Rust face can print it (run: bun run audit:node-help-text -- --apply).`)
  }
  const mirrored = reports.reduce((total, report) => total + report.disclosures.length, 0)

  for (const report of missing) {
    const line = `no NodeHelp dictionary in packages/nodes/${report.nodeId}/src/help.ts, so its definition text is unbacked`
    if (baseline.includes(report.nodeId)) console.log(`DEBT  ${report.nodeId}: ${line} (baselined).`)
    else console.error(`FAIL  ${report.nodeId}: ${line}.`)
  }
  for (const nodeId of staleBaseline) console.log(`DEBT  ${nodeId}: baseline entry can go — the node publishes a help dictionary now.`)

  const nonEnglish = reports.filter((report) => report.nonEnglishBase)
  console.log(
    `Node help text: ${reports.length} definition(s) checked against packages/nodes/*; ${drifted.length} drifted, `
    + `${missing.length} without a dictionary (${unbaselinedMissing.length} of them new), `
    + `${reports.length - drifted.length - missing.length} sourced from the dictionary; `
    + `help block: ${reports.length - drifted.length - missing.length - withoutBlock.length - driftedHelp.length} verbatim, `
    + `${withoutBlock.length} missing, ${driftedHelp.length} drifted`
    + `${mirrored > 0 ? `; ${mirrored} help entr${mirrored === 1 ? "y" : "ies"} disclosed (a side taken from the English base, or the two languages listing a different number of steps or entries)` : ""}`
    + `${nonEnglish.length > 0 ? `; ${nonEnglish.length} dictionary(ies) put non-English text in the base fields (disclosed, not a failure)` : ""}.`,
  )
  if (drifted.length > 0 || unbaselinedMissing.length > 0 || withoutBlock.length > 0 || driftedHelp.length > 0) {
    throw new Error(
      `audit:node-help-text found ${drifted.length} drifted title/description file(s), ${withoutBlock.length} definition(s) `
      + `without a help block, ${driftedHelp.length} drifted help block(s), and ${unbaselinedMissing.length} new node(s) without a dictionary.`,
    )
  }
}
