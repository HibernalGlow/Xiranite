/**
 * Gate for ADR-0069's rule that a node's help dictionary is the one vocabulary.
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
}

export interface HelpTextOptions {
  definitionsRoot: string
  pluginsRoot: string
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
  if (help === null) return { nodeId, definitionPath, problems: [], missingDictionary: true, nonEnglishBase: false }

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
  return {
    nodeId,
    definitionPath,
    problems,
    missingDictionary: false,
    nonEnglishBase: !/^[\x20-\x7E]*$/.test(help.short),
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
  return next
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
  const plugins = await readdir(options.pluginsRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of plugins.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(options.pluginsRoot, entry.name, "definition.json")
    if (await readFile(path, "utf8").catch(() => null) === null) continue
    locations.push({ nodeId: entry.name, path })
  }
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
    pluginsRoot: join(process.cwd(), "plugins"),
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
    + `${reports.length - drifted.length - missing.length} sourced from the dictionary`
    + `${nonEnglish.length > 0 ? `; ${nonEnglish.length} dictionary(ies) put non-English text in the base fields (disclosed, not a failure)` : ""}.`,
  )
  if (drifted.length > 0 || unbaselinedMissing.length > 0) {
    throw new Error(`audit:node-help-text found ${drifted.length} drifted definition file(s) and ${unbaselinedMissing.length} new node(s) without a dictionary.`)
  }
}
