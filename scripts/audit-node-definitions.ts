/**
 * Coverage gate for the node definition contract (ADR-0069).
 *
 * The three faces read one vocabulary, so "how far along is the migration" is answerable only by
 * counting definitions against the retained node set — and the same count has to report what the
 * declarative language could not express, because those `custom` rules and `defaultExport` names are the
 * backlog of plugin exports every face will have to call.
 *
 * `node-definitions/<id>.json` is the only definition home: the Extism `plugins/` tree it was staged
 * against was deleted on 2026-10-05 (ADR-0073 retired wasm, ADR-0074 left one TS core per node). A
 * definition that does not validate is therefore a hard failure here, not a note — keeping the old
 * "draft: reported but never blocks" tier would have silently un-powered the only gate that reads
 * this set, since nothing could ever again be counted as published.
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { parseAndValidateDefinition, type DefinitionReport } from "./lib/node-definition.ts"

export interface DefinitionEntry {
  nodeId: string
  source: "published" | "missing"
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
  definitionsRoot: string
}): Promise<CoverageReport> {
  const nodes = await retainedNodes(options.nodesRoot)
  const entries: DefinitionEntry[] = []

  for (const nodeId of nodes) {
    const path = join(options.definitionsRoot, `${nodeId}.json`)
    const raw = await readDefinition(path)
    const source: DefinitionEntry["source"] = raw === null ? "missing" : "published"
    const report: DefinitionReport = raw === null ? { problems: [`no definition at ${path}`] } : parseAndValidateDefinition(raw)
    const shape = raw === null ? { actions: 0, fields: 0, customRules: [], pluginExports: [] } : countShape(raw)
    const keep = source === "missing" ? [] : report.problems
    entries.push({ nodeId, source, path: source === "missing" ? undefined : path, ...shape, problems: keep })
  }

  return {
    nodes,
    entries,
    published: entries.filter((entry) => entry.source === "published").length,
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
    definitionsRoot: join(process.cwd(), "node-definitions"),
  })

  assertNonEmptyScan(report, join(process.cwd(), "packages/nodes"))

  for (const entry of report.entries) {
    if (entry.problems.length > 0) {
      for (const problem of entry.problems) console.error(`FAIL ${entry.nodeId} (${entry.source}): ${problem}`)
    }
  }
  console.log(
    `Node definitions: ${report.published} published of ${report.nodes.length} retained nodes`
      + ` (${report.missing} missing). Vocabulary backlog: ${report.customRuleCount} custom rules, ${report.pluginExportCount} plugin exports.`
      + ` Invalid published: ${report.invalidPublished}.`,
  )
  if (report.invalidPublished > 0) throw new Error(`audit:node-definitions: ${report.invalidPublished} published definition(s) are invalid.`)
}
