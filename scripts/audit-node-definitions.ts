/**
 * Coverage gate for the node definition contract (ADR-0069).
 *
 * The three faces read one vocabulary, so "how far along is the migration" is answerable only by
 * counting definitions against the retained node set — and the same count has to report what the
 * declarative language could not express, because those `custom` rules and `defaultExport` names are the
 * backlog of plugin exports every face will have to call.
 *
 * Two locations are read on purpose:
 * - `plugins/<id>/definition.json` — published with a ported plugin; invalid is a hard failure;
 * - `artifacts/node-definitions/<id>.json` — a draft transcribed from the node's own `interaction.ts`
 *   before its plugin exists; invalid is reported but does not fail the gate.
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { parseAndValidateDefinition, type DefinitionReport } from "./lib/node-definition.ts"

export interface DefinitionEntry {
  nodeId: string
  source: "published" | "draft" | "missing"
  path?: string
  actions: number
  fields: number
  /** `Rule::Custom` export names: node logic that must live in the plugin. */
  customRules: string[]
  /** `InputBinding::defaultExport` and `DangerGate::PluginExport` names. */
  pluginExports: string[]
  problems: string[]
}

export interface CoverageReport {
  nodes: string[]
  entries: DefinitionEntry[]
  published: number
  drafted: number
  missing: number
  invalidPublished: number
  customRuleCount: number
  pluginExportCount: number
}

const countShape = (raw: string): Pick<DefinitionEntry, "actions" | "fields" | "customRules" | "pluginExports"> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { actions: 0, fields: 0, customRules: [], pluginExports: [] }
  }
  if (typeof parsed !== "object" || parsed === null) return { actions: 0, fields: 0, customRules: [], pluginExports: [] }
  const record = parsed as Record<string, unknown>
  const actions = Array.isArray(record.actions) ? record.actions.length : 0
  const fields = Array.isArray(record.fields) ? record.fields.length : 0
  const customRules: string[] = []
  const pluginExports: string[] = []
  for (const field of Array.isArray(record.fields) ? (record.fields as Record<string, unknown>[]) : []) {
    for (const guarded of Array.isArray(field.rules) ? (field.rules as Record<string, unknown>[]) : []) {
      const rule = (guarded.rule ?? guarded) as Record<string, unknown>
      if (rule.type === "custom" && typeof rule.exportName === "string") customRules.push(rule.exportName)
    }
    for (const binding of Array.isArray(record.inputBindings) ? (record.inputBindings as Record<string, unknown>[]) : []) {
      if (typeof binding.defaultExport === "string") pluginExports.push(binding.defaultExport)
    }
  }
  const danger = record.danger as Record<string, unknown> | undefined
  if (danger?.type === "pluginExport" && typeof danger.exportName === "string") pluginExports.push(danger.exportName)
  return { actions, fields, customRules, pluginExports: [...new Set(pluginExports)] }
}

/** List the nodes that still exist under `packages/nodes`. */
export async function retainedNodes(nodesRoot: string): Promise<string[]> {
  const entries = await readdir(nodesRoot, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((left, right) => left.localeCompare(right))
}

async function readDefinition(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null)
}

export async function auditNodeDefinitions(options: {
  nodesRoot: string
  pluginsRoot: string
  draftsRoot: string
}): Promise<CoverageReport> {
  const nodes = await retainedNodes(options.nodesRoot)
  const entries: DefinitionEntry[] = []

  for (const nodeId of nodes) {
    const publishedPath = join(options.pluginsRoot, nodeId, "definition.json")
    const draftPath = join(options.draftsRoot, `${nodeId}.json`)
    const publishedRaw = await readDefinition(publishedPath)
    const draftRaw = publishedRaw === null ? await readDefinition(draftPath) : null
    const raw = publishedRaw ?? draftRaw
    const source: DefinitionEntry["source"] = publishedRaw !== null ? "published" : draftRaw !== null ? "draft" : "missing"
    const path = publishedRaw !== null ? publishedPath : draftRaw !== null ? draftPath : undefined
    const report: DefinitionReport = raw === null ? { problems: ["no definition in plugins/ or artifacts/"] } : parseAndValidateDefinition(raw)
    const shape = raw === null ? { actions: 0, fields: 0, customRules: [], pluginExports: [] } : countShape(raw)
    const keep = source === "missing" ? [] : report.problems
    entries.push({ nodeId, source, path, ...shape, problems: keep })
  }

  return {
    nodes,
    entries,
    published: entries.filter((entry) => entry.source === "published").length,
    drafted: entries.filter((entry) => entry.source === "draft").length,
    missing: entries.filter((entry) => entry.source === "missing").length,
    invalidPublished: entries.filter((entry) => entry.source === "published" && entry.problems.length > 0).length,
    customRuleCount: entries.reduce((total, entry) => total + entry.customRules.length, 0),
    pluginExportCount: entries.reduce((total, entry) => total + entry.pluginExports.length, 0),
  }
}

/** Refuse an empty scan: the same mistake made the HTTP-surface analyzer report zero routes as success. */
export function assertNonEmptyScan(report: CoverageReport, nodesRoot: string): void {
  if (report.nodes.length === 0) {
    throw new Error(`audit:node-definitions found no nodes under ${nodesRoot} — the scan path is wrong, not the coverage.`)
  }
}

if (import.meta.main) {
  const report = await auditNodeDefinitions({
    nodesRoot: join(process.cwd(), "packages/nodes"),
    pluginsRoot: join(process.cwd(), "plugins"),
    draftsRoot: join(process.cwd(), "artifacts/node-definitions"),
  })

  assertNonEmptyScan(report, join(process.cwd(), "packages/nodes"))

  for (const entry of report.entries) {
    if (entry.problems.length > 0) {
      for (const problem of entry.problems) console.error(`FAIL ${entry.nodeId} (${entry.source}): ${problem}`)
    }
  }
  console.log(
    `Node definitions: ${report.published} published + ${report.drafted} drafted of ${report.nodes.length} retained nodes`
      + ` (${report.missing} missing). Vocabulary backlog: ${report.customRuleCount} custom rules, ${report.pluginExportCount} plugin exports.`
      + ` Invalid published: ${report.invalidPublished}.`,
  )
  if (report.invalidPublished > 0) throw new Error(`audit:node-definitions: ${report.invalidPublished} published definition(s) are invalid.`)
}
